import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSessionId } from "../conversation/session-registry.js";
import { resolveHomeDir } from "../paths.js";

// Kairo runs its own Kairo-only Pi fork by path — never a "pi" resolved
// from PATH — because the standalone Pi launcher explicitly prepends its
// own package, skills, prompts, and themes, and Pi's --no-* flags cannot
// make Kairo's first screen quiet. See odd/tasks/kairo-pi-parity.md,
// "P02 repair — Kairo-only Pi fork".
export const KAIRO_PI_PACKAGE_NAME = "@kal-elsam/kairo-pi-coding-agent";
export const KAIRO_PI_PACKAGE_VERSION = "0.87.1-kairo.3";
export const MIN_NODE_VERSION = "22.19.0";

const __hostModuleDir = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the Kairo Pi extension (same as interactive `launchGentleShell`). */
export const DEFAULT_EXTENSION_DIR = join(__hostModuleDir, "extension");

/**
 * Pi CLI flags that load only Kairo's extension and disable ambient resources.
 * @param {string} extensionDir
 * @returns {string[]}
 */
export function buildKairoPiResourceArgs(extensionDir) {
  if (typeof extensionDir !== "string" || !extensionDir.startsWith("/")) {
    throw new Error("Kairo extension path must be absolute.");
  }
  return [
    "-e",
    extensionDir,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files"
  ];
}

// Write seam for prepareKairoPiHome only (mkdirSync/writeFileSync); reads
// still use the direct imports. Unit tests inject it to record write targets
// in-process. The whole-module guarantee, which also covers writes that
// bypass this seam, comes from test/helpers/launch-write-probe.mjs.
const defaultFsImpl = { mkdirSync, writeFileSync };

export function routeInteractiveHost({ command, options = {} }) {
  if (options.legacyCockpit) return "cockpit";
  if (command === "host") return "pi";
  if (command === "shell") return "shell";
  return null;
}

export async function launchGentleShell({
  cwd,
  extensionDir,
  sessionId = null,
  interactive = true,
  env = process.env,
  spawnImpl = defaultSpawn,
  resolveEntryImpl = defaultResolveEntry,
  nodeVersion = process.versions.node,
  execPath = process.execPath,
  statImpl = statSync,
  fsImpl = defaultFsImpl
} = {}) {
  if (interactive === false) {
    throw new Error(
      "The Kairo workspace requires an interactive terminal (TTY). Use --legacy-cockpit for the previous cockpit."
    );
  }
  assertDirectoryCwd(cwd, statImpl);
  if (sessionId != null && !isValidSessionId(sessionId)) {
    throw new Error(`Invalid session id "${sessionId}" — refusing to spawn.`);
  }
  if (typeof extensionDir !== "string" || !extensionDir.startsWith("/")) {
    throw new Error("Kairo extension path must be absolute.");
  }
  assertNodeVersion(nodeVersion);

  // Do not launch through Gentle Shell. Its launcher explicitly prepends its
  // package, skills, prompts, and themes, so Pi's --no-* flags cannot make
  // Kairo's first screen quiet. Kairo uses its own Pi fork directly and
  // supplies only its own extension.
  const packageRoot = resolveKairoPiPackageRoot(resolveEntryImpl);
  const cliPath = join(packageRoot, "dist", "bundle", "cli.js");
  if (!existsSync(cliPath)) {
    throw new Error(
      `Kairo-only Pi fork bundle is missing: "${cliPath}" does not exist. ` +
      "Reinstall the Kairo-only Pi fork, or use --legacy-cockpit for the previous cockpit."
    );
  }

  const { dir: kairoPiHome, tuiMode } = prepareKairoPiHome(env, fsImpl);
  // Kairo owns its interactive surface. A Kairo-only Pi home and explicit
  // resource flags prevent ambient packages, skills, themes, context files,
  // changelogs, and diagnostics from becoming Kairo's first screen.
  // --tui-mode is the fork's own CLI flag (cli/args.ts) for its
  // fullscreen/regular InteractiveMode layout (H6); Kairo defaults it to
  // fullscreen (see prepareKairoPiHome) but honors a regular mode the user
  // already chose (persisted in the fork's own settings.json), so
  // "--legacy-cockpit" is never the only way back to a non-fullscreen view.
  const args = [cliPath, ...buildKairoPiResourceArgs(extensionDir), "--tui-mode", tuiMode];
  const hostEnv = {
    ...env,
    PI_CODING_AGENT_DIR: kairoPiHome,
    // Mirrors the --tui-mode flag above so the Kairo extension (which has
    // no other way to learn the fork's current layout mode — the fork's
    // ExtensionUIContext exposes no getter for it) can feature-detect
    // whether to feed the fullscreen sidebar/bottom-strip slots or keep
    // the regular-mode overview widget. See extension/index.js.
    KAIRO_TUI_MODE: tuiMode,
    // The fork's empty-session persistence is off by default; only this
    // child process opts in. Never set on process.env — any Pi subprocess
    // spawned from within this child inherits it from this object, not
    // from the ambient environment.
    KAIRO_PI_EMPTY_SESSIONS: "1",
    // The fork correctly ranks its own prerelease (e.g. 0.87.1-kairo.2)
    // below the real 0.87.1 release, so it always shows an "Update
    // Available" notice — never accurate for this Kairo-only fork, which
    // is not upgraded through `pi update`. The fork already honors this
    // flag (src/utils/version-check.ts). Same never-on-process.env rule
    // as KAIRO_PI_EMPTY_SESSIONS above.
    PI_SKIP_VERSION_CHECK: "1",
    ...(sessionId == null ? {} : { KAIRO_SESSION_ID: sessionId })
  };
  const result = await spawnImpl(execPath, args, { cwd, env: hostEnv, shell: false, stdio: "inherit" });
  if (result && Number.isInteger(result.status) && result.status !== 0) {
    throw new Error(`Pi exited ${result.status}. Use --legacy-cockpit for the previous cockpit.`);
  }
  return result ?? { status: 0 };
}

function assertDirectoryCwd(cwd, statImpl) {
  if (typeof cwd !== "string" || cwd.trim() === "") {
    throw new Error("Host launch requires a project cwd directory.");
  }
  let stats;
  try {
    stats = statImpl(cwd);
  } catch {
    throw new Error(`Host launch cwd "${cwd}" is not a directory.`);
  }
  if (typeof stats?.isDirectory !== "function" || !stats.isDirectory()) {
    throw new Error(`Host launch cwd "${cwd}" is not a directory.`);
  }
}

function assertNodeVersion(nodeVersion) {
  const version = typeof nodeVersion === "string" ? nodeVersion.trim() : "";
  if (!/^\d+\.\d+\.\d+/.test(version) || compareSemver(version, MIN_NODE_VERSION) < 0) {
    throw new Error(
      `The Kairo-only Pi fork requires Node >= ${MIN_NODE_VERSION} (found "${nodeVersion}"). ` +
      "Upgrade Node, or use --legacy-cockpit for the previous cockpit."
    );
  }
}

function resolveKairoPiPackageRoot(resolveEntryImpl) {
  let entryPath = null;
  let resolveError = null;
  try {
    entryPath = resolveEntryImpl();
  } catch (err) {
    resolveError = err;
  }
  if (typeof entryPath !== "string" || entryPath.trim() === "") {
    throw new Error(
      `Kairo-only Pi fork "${KAIRO_PI_PACKAGE_NAME}"@${KAIRO_PI_PACKAGE_VERSION} is not installed. ` +
      "Install it, or use --legacy-cockpit for the previous cockpit." +
      (resolveError ? ` (${resolveError.message})` : "")
    );
  }

  const found = findPackageRoot(dirname(entryPath));
  if (!found) {
    throw new Error(
      `Could not find the "${KAIRO_PI_PACKAGE_NAME}" package.json walking up from "${entryPath}". ` +
      "Install the Kairo-only Pi fork, or use --legacy-cockpit for the previous cockpit."
    );
  }
  if (found.pkg.version !== KAIRO_PI_PACKAGE_VERSION) {
    throw new Error(
      `Kairo-only Pi fork version mismatch: found "${found.pkg.version}" at "${found.dir}", ` +
      `expected "${KAIRO_PI_PACKAGE_VERSION}". Reinstall the exact version, or use --legacy-cockpit ` +
      "for the previous cockpit."
    );
  }
  return found.dir;
}

function findPackageRoot(startDir) {
  let dir = startDir;
  for (;;) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg && typeof pkg === "object" && pkg.name === KAIRO_PI_PACKAGE_NAME) {
          return { dir, pkg };
        }
      } catch {
        // Unreadable or malformed package.json at this level; keep walking up.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function defaultResolveEntry() {
  return fileURLToPath(import.meta.resolve(KAIRO_PI_PACKAGE_NAME));
}

/**
 * The Kairo-only Pi fork's settings.json path — the single source of truth
 * both `prepareKairoPiHome` (below) and the extension's live `getTuiMode`
 * (see extension/index.js's `readLiveKairoTuiMode`) read/write, so a mode
 * change made from inside a running Pi session (its settings selector calls
 * `SettingsManager.setTuiMode`, which persists here immediately) is visible
 * to the extension on its very next check — never a value only captured
 * once at launch time (env), which cannot observe a live in-session change.
 */
export function resolveKairoPiSettingsPath(env) {
  return join(resolveHomeDir(env), ".harness", "pi-agent", "settings.json");
}

// Kairo's own default TUI mode (H7): fullscreen unless the user already
// chose "regular" (persisted in the fork's settings.json — see
// SettingsManager.getTuiMode, which falls back to "regular" for any value
// other than exactly "fullscreen"). Never re-derived from the CLI flag
// itself, so a user who switches back to regular mode from inside Pi (its
// own runtime toggle calls SettingsManager.setTuiMode, which persists here)
// stays in regular mode on the next Kairo launch.
const DEFAULT_TUI_MODE = "fullscreen";

/**
 * Prepares the Kairo-only Pi fork's settings home, and returns the tuiMode
 * to launch with. Never overwrites an existing "regular" choice back to
 * "fullscreen" — only fills in the two settings when they are missing.
 * @returns {{dir: string, tuiMode: "fullscreen"|"regular"}}
 */
function prepareKairoPiHome(env, fsImpl) {
  const dir = join(resolveHomeDir(env), ".harness", "pi-agent");
  const settingsPath = resolveKairoPiSettingsPath(env);
  fsImpl.mkdirSync(dir, { recursive: true });

  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) settings = parsed;
    } catch {
      // The directory is Kairo-owned; preserve an unreadable/malformed file
      // rather than silently replacing it with a different configuration.
      // This launch still needs SOME tuiMode to pass on the CLI — fall
      // back to the default without persisting anything.
      return { dir, tuiMode: DEFAULT_TUI_MODE };
    }
  }
  const tuiMode = settings.tuiMode === "regular" ? "regular" : DEFAULT_TUI_MODE;
  const needsWrite = settings.quietStartup !== true || settings.tuiMode !== tuiMode;
  if (needsWrite) {
    fsImpl.writeFileSync(
      settingsPath,
      `${JSON.stringify({ ...settings, quietStartup: true, tuiMode }, null, 2)}\n`,
      "utf8"
    );
  }
  return { dir, tuiMode };
}

function compareSemver(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
}

function defaultSpawn(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.on("error", reject);
    child.on("close", (status) => resolve({ status: status ?? 1 }));
  });
}
