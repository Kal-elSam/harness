// Real OS-level filesystem confinement for the Cursor CLI (cursor-agent),
// used ONLY for Bootstrap Analysis, mirroring codex-sandbox.js exactly —
// general ASK never routes Cursor through this module.
//
// Empirically proven necessary AND sufficient, not assumed: Cursor's own
// `--sandbox enabled` (documented in `cursor-agent --help` as "Explicitly
// enable or disable sandbox mode") does NOT confine file reads to
// --workspace — a real absolute-path read outside the workspace
// succeeded and disclosed real content under `--sandbox enabled` alone.
// The same external sandbox-exec wrapper approach that closed this gap
// for Codex (codex-sandbox.js) was then independently canary-tested
// against the real cursor-agent CLI and DOES hold: wrapping `cursor-agent`
// in an external macOS sandbox-exec profile, with Cursor's own internal
// sandbox disabled (`--sandbox disabled`, so only the external wrapper
// enforces anything — avoids any risk of the kind of nested-sandbox
// conflict that broke every Codex tool call when both layers tried to
// sandbox at once), produces a real, held boundary: an in-bounds read
// succeeds, an out-of-bounds absolute-path read is denied
// ("Permission denied", not a model claim in prose).
//
// Two real gotchas found only by testing the ACTUAL cursor-agent binary
// (not assumed from Codex's profile):
//  1. cursor-agent's real binary lives under `~/.local` (a wrapper script
//     at ~/.local/bin/cursor-agent execs the real binary under
//     ~/.local/share/cursor-agent/versions/...) — that whole tree must be
//     readable+executable, or the CLI can't even launch.
//  2. cursor-agent's stored auth ("Authentication tokens stored
//     securely") lives in the macOS Keychain, not a plain file under its
//     config home — ~/Library/Keychains must be read+write accessible or
//     every real invocation fails with "Authentication required" even
//     though the session is genuinely logged in. The wrapper script also
//     writes to /dev/null, which needs explicit file-write access (unlike
//     Codex's profile, which never needed it).
//
// A workspace cursor-agent has never seen before triggers an interactive
// "Workspace Trust Required" prompt that blocks non-interactive use —
// `--trust` is required for automation, safe here because snapshotRoot is
// always Kairo's own freshly-generated temp directory, never an
// arbitrary user-chosen one (same category of bypass as Codex's
// --skip-git-repo-check for a snapshot that deliberately excludes .git).

import { spawn as defaultSpawn } from "node:child_process";
import { access, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";
const DEFAULT_TIMEOUT_MS = 180_000;

const SAFE_ENV_KEYS = Object.freeze([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
  "TMPDIR", "TERM", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS"
]);

function buildSandboxedCursorEnv(sourceEnv = process.env) {
  const env = Object.create(null);
  for (const key of SAFE_ENV_KEYS) {
    if (sourceEnv[key] != null && sourceEnv[key] !== "") env[key] = sourceEnv[key];
  }
  return env;
}

function unknown(error) {
  return { status: "error", answer: null, error: String(error) };
}

export async function isCursorSandboxSupported(deps = {}) {
  if ((deps.platform ?? process.platform) !== "darwin") return false;
  try {
    await (deps.access ?? access)(SANDBOX_EXEC_PATH, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function getCursorIsolationStatus(deps = {}) {
  const available = await isCursorSandboxSupported(deps);
  return {
    available,
    platform: deps.platform ?? process.platform,
    boundaryVerified: available,
    reason: available
      ? null
      : "OS-level read confinement for Cursor (sandbox-exec) is only implemented for macOS; Cursor is not eligible for isolated Bootstrap Analysis on this platform."
  };
}

async function resolvedForms(path, deps) {
  const forms = new Set([path]);
  try {
    forms.add(await (deps.realpath ?? realpath)(path));
  } catch {
    // fine — the literal form alone still covers it
  }
  return [...forms];
}

function subpathRules(paths) {
  return paths.map((p) => `  (subpath "${p}")`).join("\n");
}

export async function buildCursorSandboxProfile({
  snapshotRoot,
  cursorHome = join(homedir(), ".cursor"),
  cursorLocalHome = join(homedir(), ".local"),
  keychainsHome = join(homedir(), "Library", "Keychains")
}, deps = {}) {
  const snapshotForms = await resolvedForms(snapshotRoot, deps);
  const cursorHomeForms = await resolvedForms(cursorHome, deps);
  const cursorLocalForms = await resolvedForms(cursorLocalHome, deps);
  const keychainsForms = await resolvedForms(keychainsHome, deps);
  const readableExtra = [
    "/usr", "/System", "/bin", "/sbin", "/private/var/db/dyld", "/Library", "/opt", "/private/etc"
  ];
  return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec)
(allow file-read-metadata (subpath "/"))
(allow file-read-data (literal "/"))
(allow file-read*
${subpathRules([...snapshotForms, ...cursorHomeForms, ...cursorLocalForms, ...keychainsForms, ...readableExtra])}
  (literal "/dev/null")
  (literal "/dev/urandom")
  (literal "/dev/tty"))
(allow file-write*
  (literal "/dev/null")
${subpathRules([...snapshotForms, ...cursorHomeForms, ...keychainsForms, "/private/var/folders", "/private/tmp"])})
(allow file-read-metadata (subpath "/private/var/folders"))
(allow sysctl-read)
(allow mach-lookup)
(allow signal (target self))
(allow network*)
(allow system-socket)
`;
}

/**
 * Runs a real, OS-sandboxed Cursor Bootstrap Analysis question. The ONLY
 * intended caller is bootstrap-analyzer-adapters.js's Cursor adapter.
 * Fails closed with `status: "error", error: "isolation_unavailable"`
 * (never a silent fallback to Cursor's own non-confining --sandbox
 * enabled) when this platform has no verified boundary.
 * @param {object} args
 * @param {string} args.question
 * @param {string|null} [args.model] - omit (or pass null) for Cursor Auto
 * @param {string} args.snapshotRoot
 */
export async function runCursorSandboxedBootstrap({
  question, model = null, snapshotRoot,
  cursorHome = join(homedir(), ".cursor"), cursorLocalHome = join(homedir(), ".local"),
  keychainsHome = join(homedir(), "Library", "Keychains"),
  spawn = defaultSpawn, timeoutMs = DEFAULT_TIMEOUT_MS, sourceEnv = process.env, deps = {}
}) {
  const isolation = await getCursorIsolationStatus(deps);
  if (!isolation.available) {
    return { status: "error", answer: null, error: "isolation_unavailable", isolation };
  }

  let workDir;
  try {
    workDir = await (deps.mkdtemp ?? mkdtemp)(join(tmpdir(), "kairo-cursor-sandbox-"));
  } catch (error) {
    return { ...unknown(error?.message ?? error), isolation };
  }
  const profilePath = join(workDir, "bootstrap.sb");

  try {
    const profile = await buildCursorSandboxProfile({ snapshotRoot, cursorHome, cursorLocalHome, keychainsHome }, deps);
    await (deps.writeFile ?? writeFile)(profilePath, profile, "utf8");

    const args = [
      "-f", profilePath, "cursor-agent", "-p", question,
      "--output-format", "json", "--mode", "ask", "--sandbox", "disabled",
      "--workspace", snapshotRoot, "--trust"
    ];
    if (model) args.push("--model", model);

    const env = buildSandboxedCursorEnv(sourceEnv);
    const result = await new Promise((resolve) => {
      let child;
      try {
        child = spawn("sandbox-exec", args, { cwd: snapshotRoot, env, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        resolve(unknown(error?.message ?? error));
        return;
      }
      let stdout = "";
      let finished = false;
      const timer = setTimeout(() => finish(unknown("sandboxed cursor-agent -p timed out")), timeoutMs);
      function finish(res) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { child.kill?.(); } catch { /* best effort */ }
        resolve(res);
      }
      child.stdout?.on("data", (chunk) => { stdout += chunk; });
      child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
      child.once?.("close", () => {
        let parsed;
        try { parsed = JSON.parse(stdout); } catch { return finish(unknown("malformed JSON from sandboxed cursor-agent -p")); }
        const answer = parsed?.result ?? parsed?.text ?? parsed?.message ?? null;
        if (typeof answer !== "string") return finish(unknown("no result text in sandboxed cursor-agent -p response"));
        finish({ status: "answered", answer, error: null });
      });
    });
    return { ...result, isolation };
  } finally {
    await (deps.rm ?? rm)(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
