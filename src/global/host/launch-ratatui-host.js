import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSessionId } from "../conversation/session-registry.js";
import { resolvePrebuiltBinary } from "./kairo-ui-prebuilt.js";

export {
  KAIRO_UI_PREBUILT_TARGETS,
  normalizePrebuiltArch,
  prebuiltBinaryKey,
  prebuiltBinaryRelativePath,
  resolvePrebuiltBinary
} from "./kairo-ui-prebuilt.js";

const __hostModuleDir = dirname(fileURLToPath(import.meta.url));
/** Repo / package root that contains `crates/kairo-ui` and/or `dist/kairo-ui`. */
export const DEFAULT_PACKAGE_ROOT = resolve(__hostModuleDir, "../../..");
export const DEFAULT_KAIRO_UI_CRATE_DIR = join(DEFAULT_PACKAGE_ROOT, "crates", "kairo-ui");

/**
 * Choose the interactive UI host for daily work paths.
 * Precedence: `--legacy-cockpit` > `--pi` / `KAIRO_UI_HOST=pi` >
 * `--ratatui` / `KAIRO_UI_HOST=ratatui` > default `ratatui`.
 * @param {{ options?: { legacyCockpit?: boolean, piHost?: boolean, ratatui?: boolean }, env?: NodeJS.ProcessEnv }} args
 * @returns {"ratatui"|"pi"|"cockpit"}
 */
export function resolveUiHost({ options = {}, env = process.env } = {}) {
  if (options.legacyCockpit === true) return "cockpit";
  const fromEnv = typeof env?.KAIRO_UI_HOST === "string" ? env.KAIRO_UI_HOST.trim().toLowerCase() : "";
  if (options.piHost === true || fromEnv === "pi") return "pi";
  if (options.ratatui === true || fromEnv === "ratatui") return "ratatui";
  return "ratatui";
}

/**
 * Launch the ratatui terminal host (`kairo-ui`) with the JSONL bridge.
 *
 * Preference order:
 * 1. Shipped prebuilt under `dist/kairo-ui/<platform-arch>/kairo-ui` (clean install, no Cargo)
 * 2. Dev fallback: `cargo build --release` when the crate is present and the release binary
 *    is missing or older than crate sources
 *
 * @param {object} args
 */
export async function launchRatatuiHost({
  cwd,
  sessionId = null,
  interactive = true,
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  spawnImpl = defaultSpawn,
  cargoBuildImpl = null,
  existsSyncImpl = existsSync,
  statImpl = statSync,
  packageRoot = DEFAULT_PACKAGE_ROOT,
  crateDir = join(packageRoot, "crates", "kairo-ui"),
  resolvePrebuiltBinaryImpl = resolvePrebuiltBinary
} = {}) {
  if (platform === "win32") {
    throw new Error(
      "The ratatui host is not supported on Windows yet. " +
        "Use --pi (or KAIRO_UI_HOST=pi) for the Pi shell, " +
        "or use --legacy-cockpit for the previous cockpit."
    );
  }
  if (interactive === false) {
    throw new Error(
      "The Kairo ratatui host requires an interactive terminal (TTY). " +
        "Use --pi for the Pi shell, or use --legacy-cockpit for the previous cockpit."
    );
  }
  assertDirectoryCwd(cwd, statImpl);
  if (sessionId != null && !isValidSessionId(sessionId)) {
    throw new Error(`Invalid session id "${sessionId}" — refusing to spawn.`);
  }

  const sidecarScript = join(packageRoot, "src", "global", "host", "kairo-ui-rpc-stdio.js");
  if (!existsSyncImpl(sidecarScript)) {
    throw new Error(
      `Ratatui sidecar is missing: "${sidecarScript}". ` +
        "Use --pi for the Pi shell."
    );
  }

  const prebuiltPath = resolvePrebuiltBinaryImpl({
    platform,
    arch,
    packageRoot,
    existsSyncImpl
  });

  let binaryPath = prebuiltPath;
  if (binaryPath == null) {
    const manifestPath = join(crateDir, "Cargo.toml");
    if (!existsSyncImpl(manifestPath)) {
      throw new Error(
        `Ratatui host binary is missing for ${platform}/${arch} ` +
          `(expected prebuilt under dist/kairo-ui/) and crate is missing: ` +
          `"${manifestPath}" does not exist. ` +
          "Use --pi for the Pi shell, or use --legacy-cockpit for the previous cockpit."
      );
    }

    binaryPath = resolveReleaseBinaryPath(crateDir, env);
    const runCargo =
      cargoBuildImpl ??
      ((args, opts) => spawnImpl("cargo", args, opts));

    const needsBuild = releaseBinaryNeedsRebuild({
      binaryPath,
      crateDir,
      existsSyncImpl,
      statImpl
    });
    if (needsBuild) {
      const buildResult = await runCargo(
        ["build", "--release", "--manifest-path", manifestPath],
        { cwd: packageRoot, env, shell: false, stdio: "inherit" }
      );
      if (buildResult && Number.isInteger(buildResult.status) && buildResult.status !== 0) {
        throw new Error(
          `cargo build --release for kairo-ui exited ${buildResult.status}. ` +
            "Fix the Rust build, or use --pi for the Pi shell."
        );
      }
      if (!existsSyncImpl(binaryPath)) {
        throw new Error(
          `Ratatui host binary is still missing after cargo build: "${binaryPath}". ` +
            "Use --pi for the Pi shell."
        );
      }
    }
  }

  // Sidecar path must be absolute: spawn cwd is the *project*, not the package,
  // so walking up from cwd would miss kairo-ui-rpc-stdio.js outside the worktree.
  const hostEnv = {
    ...env,
    KAIRO_UI_RPC_SCRIPT: sidecarScript,
    KAIRO_UI_NODE: typeof env?.KAIRO_UI_NODE === "string" && env.KAIRO_UI_NODE.trim() !== ""
      ? env.KAIRO_UI_NODE
      : process.execPath,
    ...(sessionId == null ? {} : { KAIRO_SESSION_ID: sessionId })
  };
  // main.rs enables the sidecar with `--bridge` (or KAIRO_UI_BRIDGE=1) and
  // reads the project directory from process cwd — there is no --cwd flag.
  const result = await spawnImpl(binaryPath, ["--bridge"], {
    cwd,
    env: hostEnv,
    shell: false,
    stdio: "inherit"
  });
  if (result && Number.isInteger(result.status) && result.status !== 0) {
    throw new Error(
      `kairo-ui exited ${result.status}. Use --pi for the Pi shell, ` +
        "or use --legacy-cockpit for the previous cockpit."
    );
  }
  return result ?? { status: 0 };
}

/**
 * @param {string} crateDir
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
export function resolveReleaseBinaryPath(crateDir, env = process.env) {
  const targetRoot =
    typeof env?.CARGO_TARGET_DIR === "string" && env.CARGO_TARGET_DIR.trim() !== ""
      ? env.CARGO_TARGET_DIR.trim()
      : join(crateDir, "target");
  return join(targetRoot, "release", "kairo-ui");
}

/**
 * Cargo inputs that should trigger a release rebuild when newer than the binary.
 * @param {string} crateDir
 * @param {(path: string) => boolean} existsSyncImpl
 * @returns {string[]}
 */
export function kairoUiRebuildWatchPaths(crateDir, existsSyncImpl = existsSync) {
  const paths = [join(crateDir, "Cargo.toml"), join(crateDir, "Cargo.lock")];
  const srcRoot = join(crateDir, "src");
  if (existsSyncImpl(srcRoot)) {
    collectSourceFilesRecursive(srcRoot, paths);
  }
  return paths.filter((p) => existsSyncImpl(p));
}

/**
 * @param {string} binaryPath
 * @param {string} crateDir
 * @param {(path: string) => boolean} existsSyncImpl
 * @param {(path: string) => import("node:fs").Stats} statImpl
 * @returns {boolean}
 */
export function releaseBinaryNeedsRebuild({
  binaryPath,
  crateDir,
  existsSyncImpl = existsSync,
  statImpl = statSync
}) {
  if (!existsSyncImpl(binaryPath)) {
    return true;
  }
  let binaryMtimeMs;
  try {
    binaryMtimeMs = statImpl(binaryPath).mtimeMs;
  } catch {
    return true;
  }
  for (const inputPath of kairoUiRebuildWatchPaths(crateDir, existsSyncImpl)) {
    try {
      if (statImpl(inputPath).mtimeMs > binaryMtimeMs) {
        return true;
      }
    } catch {
      // unreadable path — skip
    }
  }
  return false;
}

/**
 * @param {string} dir
 * @param {string[]} out
 */
function collectSourceFilesRecursive(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFilesRecursive(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
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

function defaultSpawn(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, options);
    child.on("error", reject);
    child.on("close", (status) => resolvePromise({ status: status ?? 1 }));
  });
}
