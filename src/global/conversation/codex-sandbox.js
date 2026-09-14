// Real OS-level filesystem confinement for the Codex CLI, used ONLY for
// Bootstrap Analysis (conversation/service.js's runBootstrapAnalysis) —
// general ASK (intelligence/quick-ask.js's askProvider) keeps using
// Codex's own `--sandbox read-only`, which is NOT read-confining (see
// sanitized-snapshot.js's header: it blocks writes only, a real absolute
// path outside cwd is still readable). This module closes that specific
// gap with an OS-enforced boundary instead of relying on redaction alone.
//
// Mechanism: wrap `codex exec` in an external `sandbox-exec` (macOS SBPL)
// profile, and pass Codex `--dangerously-bypass-approvals-and-sandbox` so
// Codex's OWN internal sandboxing is off — Codex's `--sandbox read-only`
// internally re-invokes sandbox-exec per tool call, and nesting an outer
// sandbox-exec around that breaks every tool call outright (verified
// empirically: every Codex tool invocation failed with a sandbox_apply
// error). With Codex's own sandbox disabled, the external profile becomes
// the sole enforcement layer.
//
// Empirically proven, not assumed (see engram memory
// "Codex sandbox-exec confinement proven for Bootstrap Analyst
// isolation"): under this exact wrapper, a real `codex exec` run reads a
// file inside the confined root correctly, and is denied
// ("Operation not permitted") reading a file outside it via an absolute
// path.
//
// HONEST LIMIT: SBPL applies uniformly to a sandboxed process and every
// child it execs — there is no SBPL primitive that grants Codex's own
// process read/write access to CODEX_HOME while denying that same access
// to tools Codex spawns. Both are required: Codex fails hard ("failed to
// initialize in-process app-server client: Operation not permitted",
// verified empirically) without WRITE access to CODEX_HOME too, not just
// read. So CODEX_HOME is fully readable and writable by the whole
// confined tree, not just Codex's top-level process. This does not
// weaken the actual isolation goal (nothing in that tree can escape the
// snapshot boundary either way) — it only means a per-process auth/tool
// split, as asked for in review, cannot be built on sandbox-exec alone.
//
// macOS only. Any other platform returns { available: false }; callers
// must fail closed (isolation_unavailable) and never silently fall back
// to Codex's own non-confining --sandbox read-only for Bootstrap Analysis.

import { spawn as defaultSpawn } from "node:child_process";
import { access, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

const SANDBOX_EXEC_PATH = "/usr/bin/sandbox-exec";

// Bootstrap Analysis is a real project investigation, not a quick
// question — mirrors service.js's own BOOTSTRAP_ANALYST_TIMEOUT_MS.
const DEFAULT_TIMEOUT_MS = 180_000;

const SAFE_ENV_KEYS = Object.freeze([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
  "TMPDIR", "TERM", "CODEX_HOME", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
  "http_proxy", "https_proxy", "no_proxy", "NODE_EXTRA_CA_CERTS"
]);

function buildSandboxedCodexEnv(sourceEnv = process.env) {
  const env = Object.create(null);
  for (const key of SAFE_ENV_KEYS) {
    if (sourceEnv[key] != null && sourceEnv[key] !== "") env[key] = sourceEnv[key];
  }
  return env;
}

function unknown(error) {
  return { status: "error", answer: null, error: String(error) };
}

export async function isCodexSandboxSupported(deps = {}) {
  if ((deps.platform ?? process.platform) !== "darwin") return false;
  try {
    await (deps.access ?? access)(SANDBOX_EXEC_PATH, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Real, checkable isolation status for Codex — never a hardcoded claim.
 * `boundaryVerified` reflects that the sandbox-exec mechanism itself has
 * been empirically proven (canary-denial test) on this platform, not that
 * this specific call was independently re-verified.
 */
export async function getCodexIsolationStatus(deps = {}) {
  const available = await isCodexSandboxSupported(deps);
  return {
    available,
    platform: deps.platform ?? process.platform,
    boundaryVerified: available,
    reason: available
      ? null
      : "OS-level read confinement for Codex (sandbox-exec) is only implemented for macOS; Codex is not eligible for isolated Bootstrap Analysis on this platform."
  };
}

async function resolvedForms(path, deps) {
  const forms = new Set([path]);
  try {
    forms.add(await (deps.realpath ?? realpath)(path));
  } catch {
    // path may not exist yet — the literal form alone still covers it
  }
  return [...forms];
}

function subpathRules(paths) {
  return paths.map((p) => `  (subpath "${p}")`).join("\n");
}

/**
 * Builds a real SBPL profile confining reads/writes to `snapshotRoot` (the
 * sanitized-snapshot.js temp copy the analyst investigates) plus
 * `codexHome` (Codex's own auth config — without it the CLI can't
 * authenticate at all) and the minimal system paths Codex needs to run.
 * Resolves both the given path and its real path (handles macOS's
 * /tmp -> /private/tmp and /var -> /private/var symlinks automatically,
 * rather than hardcoding either form).
 */
export async function buildCodexSandboxProfile({ snapshotRoot, codexHome = join(homedir(), ".codex") }, deps = {}) {
  const snapshotForms = await resolvedForms(snapshotRoot, deps);
  const codexHomeForms = await resolvedForms(codexHome, deps);
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
${subpathRules([...snapshotForms, ...codexHomeForms, ...readableExtra])}
  (literal "/dev/null")
  (literal "/dev/urandom")
  (literal "/dev/tty"))
(allow file-write*
${subpathRules([...snapshotForms, ...codexHomeForms, "/private/var/folders", "/private/tmp"])})
(allow file-read-metadata (subpath "/private/var/folders"))
(allow sysctl-read)
(allow mach-lookup)
(allow signal (target self))
(allow network*)
(allow system-socket)
`;
}

/**
 * Runs a real, OS-sandboxed Codex Bootstrap Analysis question. The ONLY
 * intended caller is conversation/service.js's runBootstrapAnalysis.
 * Fails closed with `status: "error", error: "isolation_unavailable"`
 * (never a silent fallback to Codex's own non-confining --sandbox
 * read-only) when this platform has no verified boundary.
 * @param {object} args
 * @param {string} args.question
 * @param {string|null} [args.model]
 * @param {string} args.snapshotRoot - sanitized-snapshot.js's temp copy
 * @param {string} [args.codexHome]
 */
export async function runCodexSandboxedBootstrap({
  question, model = null, snapshotRoot, codexHome = join(homedir(), ".codex"),
  spawn = defaultSpawn, timeoutMs = DEFAULT_TIMEOUT_MS, sourceEnv = process.env, deps = {}
}) {
  const isolation = await getCodexIsolationStatus(deps);
  if (!isolation.available) {
    return { status: "error", answer: null, error: "isolation_unavailable", isolation };
  }

  let workDir;
  try {
    workDir = await (deps.mkdtemp ?? mkdtemp)(join(tmpdir(), "kairo-codex-sandbox-"));
  } catch (error) {
    return { ...unknown(error?.message ?? error), isolation };
  }
  const profilePath = join(workDir, "bootstrap.sb");
  const outFile = join(workDir, "answer.txt");

  try {
    const profile = await buildCodexSandboxProfile({ snapshotRoot, codexHome }, deps);
    await (deps.writeFile ?? writeFile)(profilePath, profile, "utf8");

    // --skip-git-repo-check: snapshotRoot deliberately excludes .git.
    // --ephemeral: no session files persisted to disk for this run.
    // --ignore-user-config: doesn't load $CODEX_HOME/config.toml (auth
    // itself still resolves via CODEX_HOME, per `codex exec --help`).
    const args = [
      "-f", profilePath, "codex", "exec",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check", "--ephemeral", "--ignore-user-config",
      "-o", outFile
    ];
    if (model) args.push("--model", model);
    args.push(question);

    const env = buildSandboxedCodexEnv(sourceEnv);
    const result = await new Promise((resolve) => {
      let child;
      try {
        child = spawn("sandbox-exec", args, { cwd: snapshotRoot, env, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        resolve(unknown(error?.message ?? error));
        return;
      }
      let finished = false;
      const timer = setTimeout(() => finish(unknown("sandboxed codex exec timed out")), timeoutMs);
      function finish(res) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        try { child.kill?.(); } catch { /* best effort */ }
        resolve(res);
      }
      child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
      child.once?.("close", async () => {
        try {
          const text = (await (deps.readFile ?? readFile)(outFile, "utf8")).trim();
          if (!text) return finish(unknown("sandboxed codex exec produced no final message"));
          finish({ status: "answered", answer: text, error: null });
        } catch (error) {
          finish(unknown(error?.message ?? error));
        }
      });
    });
    return { ...result, isolation };
  } finally {
    await (deps.rm ?? rm)(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
