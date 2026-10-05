/**
 * Adapted macOS SBPL helpers for delegated authorized-write Codex runs.
 *
 * Canonical roots validated before any grant. Not Bootstrap isolation; not
 * verified_effective. Outer wrap forces Codex internal sandbox off.
 */

import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { DelegatedWriteOsSandboxError } from "./codex-delegated-sandbox-errors.js";
import {
  assertIsolatedProviderHome,
  assertIsolatedTempRoot,
  personalCodexHome,
  validateCanonicalDelegatedWriteRoots
} from "./codex-delegated-sandbox-roots.js";

export { DelegatedWriteOsSandboxError } from "./codex-delegated-sandbox-errors.js";
export {
  assertIsolatedProviderHome,
  assertIsolatedTempRoot,
  isSameOrInside,
  personalCodexHome,
  resolveCanonicalRoot,
  validateCanonicalDelegatedWriteRoots
} from "./codex-delegated-sandbox-roots.js";

const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

function subpathRules(paths) {
  return paths.map((p) => `  (subpath "${p}")`).join("\n");
}

export async function buildDelegatedWriteSandboxProfile({
  workspaceRoot,
  providerHome,
  tempRoot,
  forbiddenExtra = [],
  codexHome = null
} = {}, deps = {}) {
  const roots = await validateCanonicalDelegatedWriteRoots({
    workspaceRoot,
    providerHome: providerHome ?? codexHome,
    tempRoot,
    forbiddenExtra
  }, deps);

  const readableExtra = [
    "/usr", "/System", "/bin", "/sbin", "/private/var/db/dyld", "/Library", "/opt", "/private/etc"
  ];
  const writeRoots = roots.allowedWritePaths;

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
 * Wrap existing Codex execution-adapter launch. Availability + canonical roots
 * first. Never falls back to unwrapped `codex` when OS sandbox is unavailable.
 */
export async function wrapCodexLaunchWithOsSandbox(launch, {
  profilePath,
  providerHome,
  tempRoot,
  workspaceRoot = null,
  forbiddenExtra = []
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

  const roots = await validateCanonicalDelegatedWriteRoots({
    workspaceRoot: workspaceRoot ?? launch.cwd,
    providerHome,
    tempRoot,
    forbiddenExtra
  }, deps);

  const baseEnv = launch.env ?? process.env;
  return {
    command: "sandbox-exec",
    args: ["-f", profilePath, "codex", ...rewriteCodexArgsForOuterOsSandbox(launch.args)],
    cwd: roots.workspaceRoot,
    env: {
      ...baseEnv,
      CODEX_HOME: roots.providerHome,
      TMPDIR: roots.tempRoot
    },
    roots
  };
}
