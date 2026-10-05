/**
 * Adapted macOS SBPL helpers for **delegated authorized-write** Codex runs.
 *
 * Reuses Bootstrap *mechanism* (outer sandbox-exec + Codex internal sandbox off)
 * but is NOT Bootstrap Analysis isolation and does NOT default-write personal
 * `~/.codex`. Provider state + temps must be isolated roots for a valid test.
 *
 * Nesting Codex `--sandbox` / `--approve-for-me` under outer sandbox-exec
 * breaks tool calls; outer wrap always forces
 * `--dangerously-bypass-approvals-and-sandbox` on the inner argv.
 */

import { access, realpath as defaultRealpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

export class DelegatedWriteOsSandboxError extends Error {
  constructor(message, { code = "delegated_write_os_sandbox_error", details = null } = {}) {
    super(message);
    this.name = "DelegatedWriteOsSandboxError";
    this.code = code;
    this.details = details;
  }
}

async function resolvedForms(path, deps) {
  const forms = new Set([path]);
  try {
    forms.add(await (deps.realpath ?? defaultRealpath)(path));
  } catch {
    // path may not exist yet — literal form still covers it
  }
  return [...forms];
}

function subpathRules(paths) {
  return paths.map((p) => `  (subpath "${p}")`).join("\n");
}

export function personalCodexHome(deps = {}) {
  return deps.personalCodexHome ?? join(deps.homedir?.() ?? homedir(), ".codex");
}

function isSameOrInside(candidate, root) {
  const c = resolve(candidate);
  const r = resolve(root);
  return c === r || c.startsWith(`${r}/`);
}

/**
 * Reject personal ~/.codex (and anything under it) as a writable provider home.
 * Isolated canary/provider state must live elsewhere.
 */
export function assertIsolatedProviderHome(providerHome, deps = {}) {
  if (typeof providerHome !== "string" || providerHome.trim() === "") {
    throw new DelegatedWriteOsSandboxError(
      "Isolated providerHome is required (non-empty path).",
      { code: "delegated_write_provider_home_required" }
    );
  }
  const personal = personalCodexHome(deps);
  if (isSameOrInside(providerHome, personal)) {
    throw new DelegatedWriteOsSandboxError(
      "providerHome must be isolated — writing personal ~/.codex is forbidden for delegated OS wrap.",
      {
        code: "delegated_write_personal_provider_home_forbidden",
        details: { providerHome, personalCodexHome: personal }
      }
    );
  }
  return resolve(providerHome);
}

export function assertIsolatedTempRoot(tempRoot) {
  if (typeof tempRoot !== "string" || tempRoot.trim() === "") {
    throw new DelegatedWriteOsSandboxError(
      "Isolated tempRoot is required (non-empty path).",
      { code: "delegated_write_temp_root_required" }
    );
  }
  return resolve(tempRoot);
}

/**
 * SBPL for delegated writes: r/w only under workspaceRoot + isolated
 * providerHome + isolated tempRoot. No broad /private/tmp allow; no personal
 * ~/.codex default.
 *
 * @param {{ workspaceRoot: string, providerHome: string, tempRoot: string }} args
 */
export async function buildDelegatedWriteSandboxProfile({
  workspaceRoot,
  providerHome,
  tempRoot,
  // legacy alias — still must pass isolation assert
  codexHome = null
}, deps = {}) {
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim() === "") {
    throw new DelegatedWriteOsSandboxError(
      "buildDelegatedWriteSandboxProfile requires a non-empty workspaceRoot",
      { code: "delegated_write_workspace_root_required" }
    );
  }

  const isolatedProvider = assertIsolatedProviderHome(providerHome ?? codexHome, deps);
  const isolatedTemp = assertIsolatedTempRoot(tempRoot);

  const workspaceForms = await resolvedForms(workspaceRoot, deps);
  const providerForms = await resolvedForms(isolatedProvider, deps);
  const tempForms = await resolvedForms(isolatedTemp, deps);
  const readableExtra = [
    "/usr", "/System", "/bin", "/sbin", "/private/var/db/dyld", "/Library", "/opt", "/private/etc"
  ];
  const writeRoots = [...workspaceForms, ...providerForms, ...tempForms];

  return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec)
(allow file-read-metadata (literal "/"))
(allow file-read-data (literal "/"))
(allow file-read*
${subpathRules([...writeRoots, ...readableExtra])}
  (literal "/dev/null")
  (literal "/dev/urandom")
  (literal "/dev/tty"))
(allow file-write*
${subpathRules(writeRoots)})
(allow sysctl-read)
(allow mach-lookup)
(allow signal (target self))
(allow network*)
(allow system-socket)
`;
}

export async function isDelegatedWriteOsSandboxSupported(deps = {}) {
  if ((deps.platform ?? process.platform) !== "darwin") return false;
  try {
    await (deps.access ?? access)(SANDBOX_EXEC_PATH, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Fail closed: OS sandbox must be available before any wrap/launch. */
export async function assertDelegatedWriteOsSandboxAvailable(deps = {}) {
  const available = await isDelegatedWriteOsSandboxSupported(deps);
  if (!available) {
    throw new DelegatedWriteOsSandboxError(
      "Delegated write OS sandbox unavailable — refusing launch (no silent fallback).",
      {
        code: "delegated_write_os_sandbox_unavailable",
        details: { platform: deps.platform ?? process.platform }
      }
    );
  }
  return true;
}

/**
 * Explicit allow/deny path plan for a future canary. Does not execute Codex.
 * Real execution requires authorizeRealCanary: true on runDelegatedWriteCanary.
 */
export function prepareDelegatedWriteCanaryPlan({
  workspaceRoot,
  providerHome,
  tempRoot,
  forbiddenExtra = []
} = {}, deps = {}) {
  const isolatedProvider = assertIsolatedProviderHome(providerHome, deps);
  const isolatedTemp = assertIsolatedTempRoot(tempRoot);
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim() === "") {
    throw new DelegatedWriteOsSandboxError(
      "Canary plan requires workspaceRoot.",
      { code: "delegated_write_workspace_root_required" }
    );
  }

  const personal = personalCodexHome(deps);
  const allowedWritePaths = [
    resolve(workspaceRoot),
    isolatedProvider,
    isolatedTemp
  ];
  const forbiddenWritePaths = [
    personal,
    join(personal, "config.toml"),
    resolve(workspaceRoot, "..", "outside-forbidden.txt"),
    "/etc/passwd",
    ...forbiddenExtra.map((p) => resolve(p))
  ];

  return Object.freeze({
    kind: "delegated_write_canary_plan",
    allowedWritePaths: Object.freeze([...allowedWritePaths]),
    forbiddenWritePaths: Object.freeze([...forbiddenWritePaths]),
    env: Object.freeze({
      CODEX_HOME: isolatedProvider,
      TMPDIR: isolatedTemp
    }),
    realRunAuthorized: false,
    note: "New real canary run requires explicit authorizeRealCanary: true"
  });
}

/**
 * Real canary gate — refuses without explicit authorization.
 * No live Codex spawn is implemented here yet; authorization still required
 * so callers cannot accidentally treat prep as execution.
 */
export async function runDelegatedWriteCanary({
  authorizeRealCanary = false,
  plan = null
} = {}, deps = {}) {
  if (authorizeRealCanary !== true) {
    throw new DelegatedWriteOsSandboxError(
      "Real delegated-write canary requires explicit authorizeRealCanary: true.",
      { code: "delegated_write_canary_authorization_required", details: { planKind: plan?.kind ?? null } }
    );
  }
  await assertDelegatedWriteOsSandboxAvailable(deps);
  throw new DelegatedWriteOsSandboxError(
    "Authorized real canary is prepared but not implemented in this increment — refuse silent fake pass.",
    { code: "delegated_write_canary_not_implemented", details: { planKind: plan?.kind ?? null } }
  );
}

export function rewriteCodexArgsForOuterOsSandbox(args = []) {
  const out = [];
  let hasBypass = false;
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--sandbox") {
      i += 1;
      continue;
    }
    if (token === "--approve-for-me") continue;
    if (token === "--dangerously-bypass-approvals-and-sandbox") {
      hasBypass = true;
      out.push(token);
      continue;
    }
    out.push(token);
  }
  if (!hasBypass) {
    const execIdx = out.indexOf("exec");
    const insertAt = execIdx >= 0 ? execIdx + 1 : 0;
    out.splice(insertAt, 0, "--dangerously-bypass-approvals-and-sandbox");
  }
  return out;
}

/**
 * Wrap an existing Codex execution-adapter launch with sandbox-exec.
 * Requires OS sandbox availability first. Sets isolated CODEX_HOME + TMPDIR.
 *
 * @param {{ command: string, args: string[], cwd: string, env?: object }} launch
 * @param {{ profilePath: string, providerHome: string, tempRoot: string }} opts
 */
export async function wrapCodexLaunchWithOsSandbox(launch, {
  profilePath,
  providerHome,
  tempRoot
} = {}, deps = {}) {
  await assertDelegatedWriteOsSandboxAvailable(deps);

  if (!launch || launch.command !== "codex") {
    throw new DelegatedWriteOsSandboxError(
      "wrapCodexLaunchWithOsSandbox expects a Codex execution launch",
      { code: "delegated_write_wrap_expects_codex" }
    );
  }
  if (typeof profilePath !== "string" || profilePath.trim() === "") {
    throw new DelegatedWriteOsSandboxError(
      "wrapCodexLaunchWithOsSandbox requires profilePath",
      { code: "delegated_write_profile_path_required" }
    );
  }

  const isolatedProvider = assertIsolatedProviderHome(providerHome, deps);
  const isolatedTemp = assertIsolatedTempRoot(tempRoot);
  const baseEnv = launch.env ?? process.env;

  return {
    command: "sandbox-exec",
    args: ["-f", profilePath, "codex", ...rewriteCodexArgsForOuterOsSandbox(launch.args)],
    cwd: launch.cwd,
    env: {
      ...baseEnv,
      CODEX_HOME: isolatedProvider,
      TMPDIR: isolatedTemp
    }
  };
}
