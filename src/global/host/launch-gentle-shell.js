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
export const KAIRO_PI_PACKAGE_VERSION = "0.87.1-kairo.1";
export const MIN_NODE_VERSION = "22.19.0";

// The only filesystem writes launchGentleShell performs (with the child
// spawn stubbed) are mkdirSync/writeFileSync inside prepareKairoPiHome.
// Injectable so tests can observe every write target instead of relying on
// mocking node:fs, whose named ESM imports are bound before any mock runs.
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

  const kairoPiHome = prepareKairoPiHome(env, fsImpl);
  // Kairo owns its interactive surface. A Kairo-only Pi home and explicit
  // resource flags prevent ambient packages, skills, themes, context files,
  // changelogs, and diagnostics from becoming Kairo's first screen.
  const args = [
    cliPath,
    "-e", extensionDir,
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files"
  ];
  const hostEnv = {
    ...env,
    PI_CODING_AGENT_DIR: kairoPiHome,
    // The fork's empty-session persistence is off by default; only this
    // child process opts in. Never set on process.env — any Pi subprocess
    // spawned from within this child inherits it from this object, not
    // from the ambient environment.
    KAIRO_PI_EMPTY_SESSIONS: "1",
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

function prepareKairoPiHome(env, fsImpl) {
  const dir = join(resolveHomeDir(env), ".harness", "pi-agent");
  const settingsPath = join(dir, "settings.json");
  fsImpl.mkdirSync(dir, { recursive: true });

  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) settings = parsed;
    } catch {
      // The directory is Kairo-owned; preserve an unreadable/malformed file
      // rather than silently replacing it with a different configuration.
      return dir;
    }
  }
  if (settings.quietStartup !== true) {
    fsImpl.writeFileSync(settingsPath, `${JSON.stringify({ ...settings, quietStartup: true }, null, 2)}\n`, "utf8");
  }
  return dir;
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
