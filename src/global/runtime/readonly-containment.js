// Effective containment for `read-only` delegated runs. A prompt or a plan
// mode alone is never containment: every read-only launch must pass a real,
// no-model write canary first, and fails closed with `isolation_unavailable`
// otherwise.
//
// Claude: tool allow-list (adapter) + macOS `sandbox-exec` profile denying all
// file writes under the real repository root (this module). sandbox-exec
// applies the profile and execs the target, so the tracked pid stays valid.
// Codex: `exec --sandbox read-only` (adapter) + a `codex sandbox -P :read-only`
// canary (this module); we do not wrap Codex in our own sandbox-exec.

import { spawnSync } from "node:child_process";
import { constants as fsConstants, realpathSync } from "node:fs";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";

export const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";
const CANARY_TIMEOUT_MS = 15_000;

export class ReadOnlyIsolationError extends Error {
  constructor(message, { details = null } = {}) {
    super(message);
    this.name = "ReadOnlyIsolationError";
    this.code = "isolation_unavailable";
    this.details = details;
  }
}

export function isReadOnlyPermissions(permissions = []) {
  return Array.isArray(permissions)
    && permissions.some((entry) => String(entry ?? "").trim().toLowerCase() === "read-only");
}

/** Deny every file write under the (already real) root; everything else stays allowed. */
export function buildReadOnlyWriteProfile(realRoot) {
  if (typeof realRoot !== "string" || !isAbsolute(realRoot) || /["\\\n\r\0]/.test(realRoot)) {
    throw new ReadOnlyIsolationError(
      "Read-only containment needs an absolute project root without quote, backslash or control characters.",
      { details: { reason: "unsafe_root" } }
    );
  }
  return `(version 1)(allow default)(deny file-write* (subpath "${realRoot}"))`;
}

export function resolveReadOnlyRoot(cwd, { realpathSync: rp = realpathSync } = {}) {
  try {
    return rp(cwd);
  } catch (cause) {
    throw new ReadOnlyIsolationError(`Cannot resolve the project root for read-only containment: ${cause?.message ?? cause}`, {
      details: { reason: "root_unresolvable" }
    });
  }
}

/** Wrap a launch so the target runs under the write-denying profile (command becomes sandbox-exec). */
export function wrapWithWriteSandbox(launch, { cwd, realpathSync: rp } = {}) {
  const root = resolveReadOnlyRoot(cwd ?? launch.cwd, { realpathSync: rp });
  return {
    ...launch,
    command: SANDBOX_EXEC_PATH,
    args: ["-p", buildReadOnlyWriteProfile(root), launch.command, ...launch.args]
  };
}

function defaultRun(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "ignore", timeout: CANARY_TIMEOUT_MS, env: options.env ?? process.env, cwd: options.cwd
  });
  return { status: result.status, error: result.error ?? null, signal: result.signal ?? null };
}

function refuse(message, reason) {
  throw new ReadOnlyIsolationError(message, { details: { reason } });
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function cleanupLeak(path, deps) {
  if (await (deps.exists ?? exists)(path)) {
    await (deps.rm ?? rm)(path, { force: true });
    return true;
  }
  return false;
}

/**
 * No-model preflight for Claude read-only: under the exact launch profile a
 * touch inside the root must fail without creating the file, and a touch in a
 * fresh temp dir outside the root must succeed.
 */
export async function verifyClaudeReadOnlySandbox({ cwd, ...deps } = {}) {
  if ((deps.platform ?? process.platform) !== "darwin") {
    refuse("Read-only Claude runs need macOS sandbox-exec; this platform has no verified write containment.", "unsupported_platform");
  }
  try { await (deps.accessExecutable ?? access)(SANDBOX_EXEC_PATH, fsConstants.X_OK); }
  catch { refuse(`${SANDBOX_EXEC_PATH} is not available; read-only Claude runs are refused.`, "sandbox_exec_missing"); }

  const run = deps.run ?? defaultRun;
  const root = resolveReadOnlyRoot(cwd, { realpathSync: deps.realpathSync });
  const profile = buildReadOnlyWriteProfile(root);
  const inside = join(root, `.kairo-readonly-canary-${randomBytes(6).toString("hex")}`);
  const insideResult = await run(SANDBOX_EXEC_PATH, ["-p", profile, "/usr/bin/touch", inside], { cwd: root });
  const leaked = await cleanupLeak(inside, deps);
  if (insideResult?.error) refuse("The write-containment canary could not run.", "canary_error");
  if (leaked || insideResult?.status === 0) refuse("The write-containment canary was able to write inside the project root.", "canary_wrote_inside");

  const outsideDir = await (deps.mkdtemp ?? mkdtemp)(join(await realpath(tmpdir()), "kairo-ro-canary-"));
  try {
    if (outsideDir === root || outsideDir.startsWith(root + sep)) refuse("Temp dir lies inside the project root; cannot prove containment.", "outside_inside_root");
    const outside = join(outsideDir, "ok");
    const outsideResult = await run(SANDBOX_EXEC_PATH, ["-p", profile, "/usr/bin/touch", outside], { cwd: root });
    if (outsideResult?.error || outsideResult?.status !== 0) {
      refuse("The write-containment profile also blocked writes outside the project root, so it is not behaving as intended.", "canary_blocks_everything");
    }
  } finally {
    await (deps.rm ?? rm)(outsideDir, { recursive: true, force: true });
  }
  return { verified: true, mechanism: "sandbox-exec", root };
}

/**
 * No-model preflight for Codex read-only: `codex sandbox -P :read-only` must
 * deny a write in the root (without creating it) and still run a harmless command.
 */
export async function verifyCodexReadOnlySandbox({ cwd, ...deps } = {}) {
  const run = deps.run ?? defaultRun;
  const root = resolveReadOnlyRoot(cwd, { realpathSync: deps.realpathSync });
  const canary = join(root, `.kairo-readonly-canary-${randomBytes(6).toString("hex")}`);
  const base = ["sandbox", "-P", ":read-only", "-C", root, "--"];
  const denied = await run("codex", [...base, "/usr/bin/touch", canary], { cwd: root });
  const leaked = await cleanupLeak(canary, deps);
  if (denied?.error) refuse("The Codex read-only canary could not run (`codex sandbox` unavailable).", "canary_error");
  if (leaked || denied?.status === 0) refuse("The Codex read-only canary was able to write inside the project root.", "canary_wrote_inside");
  const control = await run("codex", [...base, "/bin/echo", "ok"], { cwd: root });
  if (control?.error || control?.status !== 0) {
    refuse("The Codex read-only profile did not run a harmless command, so the denial is not proven.", "canary_blocks_everything");
  }
  return { verified: true, mechanism: "codex-sandbox-read-only", root };
}
