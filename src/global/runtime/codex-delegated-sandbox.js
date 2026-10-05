/**
 * Adapted macOS SBPL helpers for **delegated authorized-write** Codex runs.
 *
 * Reuses the Bootstrap *mechanism* (outer sandbox-exec + Codex internal
 * sandbox off) but is NOT Bootstrap Analysis isolation:
 * - root is an authorized workspace/worktree, not a disposable snapshot
 * - Bootstrap canaries must never be cited as delegated evidence
 * - wrapping the existing execution-adapter launch — no second executor
 *
 * Nesting Codex `--sandbox` / `--approve-for-me` under outer sandbox-exec
 * breaks tool calls; outer wrap always forces
 * `--dangerously-bypass-approvals-and-sandbox` on the inner argv.
 */

import { access, realpath as defaultRealpath } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

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

/**
 * SBPL for delegated writes: allow r/w under workspaceRoot + CODEX_HOME + temps;
 * deny default. Same shape concerns as Bootstrap (provider home must be writable)
 * but named and evidenced separately.
 *
 * @param {{ workspaceRoot: string, codexHome?: string }} args
 */
export async function buildDelegatedWriteSandboxProfile({
  workspaceRoot,
  codexHome = join(homedir(), ".codex")
}, deps = {}) {
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim() === "") {
    throw new Error("buildDelegatedWriteSandboxProfile requires a non-empty workspaceRoot");
  }

  const workspaceForms = await resolvedForms(workspaceRoot, deps);
  const codexHomeForms = await resolvedForms(codexHome, deps);
  const readableExtra = [
    "/usr", "/System", "/bin", "/sbin", "/private/var/db/dyld", "/Library", "/opt", "/private/etc"
  ];

  return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec)
(allow file-read-metadata (literal "/"))
(allow file-read-data (literal "/"))
(allow file-read*
${subpathRules([...workspaceForms, ...codexHomeForms, ...readableExtra])}
  (literal "/dev/null")
  (literal "/dev/urandom")
  (literal "/dev/tty"))
(allow file-write*
${subpathRules([...workspaceForms, ...codexHomeForms, "/private/var/folders", "/private/tmp"])})
(allow file-read-metadata (subpath "/private/var/folders"))
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

/**
 * Inner argv for outer OS wrap: drop provider sandbox / approve-for-me,
 * ensure full bypass so sandbox-exec is the sole enforcement layer.
 */
export function rewriteCodexArgsForOuterOsSandbox(args = []) {
  const out = [];
  let hasBypass = false;
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--sandbox") {
      i += 1; // skip mode
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
 * Does not invent a second executor — only changes command/argv.
 *
 * @param {{ command: string, args: string[], cwd: string, env?: object }} launch
 * @param {{ profilePath: string }} opts
 */
export function wrapCodexLaunchWithOsSandbox(launch, { profilePath }) {
  if (!launch || launch.command !== "codex") {
    throw new Error("wrapCodexLaunchWithOsSandbox expects a Codex execution launch");
  }
  if (typeof profilePath !== "string" || profilePath.trim() === "") {
    throw new Error("wrapCodexLaunchWithOsSandbox requires profilePath");
  }
  return {
    command: "sandbox-exec",
    args: ["-f", profilePath, "codex", ...rewriteCodexArgsForOuterOsSandbox(launch.args)],
    cwd: launch.cwd,
    env: launch.env
  };
}
