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

/** Clear migration copy when retired product-UI opt-outs are requested. */
export const RETIRED_PRODUCT_UI_MESSAGE =
  "The Pi shell and legacy cockpit were retired. Use `kairo` / `kairo ui` / `kairo start` / `kairo resume` (ratatui). " +
  "Non-interactive CLI and `kairo setup` still work.";

/**
 * Fail closed on retired product-UI opt-outs — no hidden fallback.
 * @param {{ options?: { legacyCockpit?: boolean, piHost?: boolean }, env?: NodeJS.ProcessEnv }} args
 */
export function assertProductUiNotRetired({ options = {}, env = process.env } = {}) {
  if (options.legacyCockpit === true) {
    throw new Error(`--legacy-cockpit is no longer supported. ${RETIRED_PRODUCT_UI_MESSAGE}`);
  }
  if (options.piHost === true) {
    throw new Error(`--pi / --pi-host is no longer supported. ${RETIRED_PRODUCT_UI_MESSAGE}`);
  }
  const fromEnv = typeof env?.KAIRO_UI_HOST === "string" ? env.KAIRO_UI_HOST.trim().toLowerCase() : "";
  if (fromEnv === "pi") {
    throw new Error(`KAIRO_UI_HOST=pi is no longer supported. ${RETIRED_PRODUCT_UI_MESSAGE}`);
  }
  if (fromEnv !== "" && fromEnv !== "ratatui") {
    throw new Error(
      `KAIRO_UI_HOST=${JSON.stringify(env.KAIRO_UI_HOST)} is not supported. ` +
        RETIRED_PRODUCT_UI_MESSAGE
    );
  }
}

/**
 * Interactive product UI is ratatui only (U7).
 * Retired opt-outs (`--pi`, `--legacy-cockpit`, `KAIRO_UI_HOST=pi`) throw a migration error.
 * @param {{ options?: { legacyCockpit?: boolean, piHost?: boolean, ratatui?: boolean }, env?: NodeJS.ProcessEnv }} args
 * @returns {"ratatui"}
 */
export function resolveUiHost({ options = {}, env = process.env } = {}) {
  assertProductUiNotRetired({ options, env });
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
        "Use the non-interactive CLI (`kairo help --all`) or `kairo setup`."
    );
  }
  if (interactive === false) {
    throw new Error(
      "The Kairo ratatui host requires an interactive terminal (TTY). " +
        "Use the non-interactive CLI (`kairo help --all`) or `kairo setup`."
    );
  }
  assertDirectoryCwd(cwd, statImpl);
  if (sessionId != null && !isValidSessionId(sessionId)) {
    throw new Error(`Invalid session id "${sessionId}" — refusing to spawn.`);
  }

  const sidecarScript = join(packageRoot, "src", "global", "host", "kairo-ui-rpc-stdio.js");
  if (!existsSyncImpl(sidecarScript)) {
    throw new Error(
      `Ratatui sidecar is missing: "${sidecarScript}". Reinstall Kairo.`
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
          `"${manifestPath}" does not exist. Reinstall Kairo or build crates/kairo-ui.`
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
          `cargo build --release for kairo-ui exited ${buildResult.status}. Fix the Rust build.`
        );
      }
      if (!existsSyncImpl(binaryPath)) {
        throw new Error(
          `Ratatui host binary is still missing after cargo build: "${binaryPath}".`
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
    throw new Error(`kairo-ui exited ${result.status}.`);
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
