import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSessionId } from "../conversation/session-registry.js";

const __hostModuleDir = dirname(fileURLToPath(import.meta.url));
/** Repo / package root that contains `crates/kairo-ui`. */
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
 * Launch the experimental ratatui terminal host (`crates/kairo-ui`) with the JSONL bridge.
 * Prefer an existing release binary; otherwise `cargo build --release` once, then spawn.
 * @param {object} args
 */
export async function launchRatatuiHost({
  cwd,
  sessionId = null,
  interactive = true,
  env = process.env,
  platform = process.platform,
  spawnImpl = defaultSpawn,
  cargoBuildImpl = null,
  existsSyncImpl = existsSync,
  statImpl = statSync,
  packageRoot = DEFAULT_PACKAGE_ROOT,
  crateDir = join(packageRoot, "crates", "kairo-ui")
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

  const manifestPath = join(crateDir, "Cargo.toml");
  if (!existsSyncImpl(manifestPath)) {
    throw new Error(
      `Ratatui host crate is missing: "${manifestPath}" does not exist. ` +
        "Use --pi for the Pi shell, or use --legacy-cockpit for the previous cockpit."
    );
  }

  const binaryPath = resolveReleaseBinaryPath(crateDir, env);
  const runCargo =
    cargoBuildImpl ??
    ((args, opts) => spawnImpl("cargo", args, opts));

  if (!existsSyncImpl(binaryPath)) {
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

  const sidecarScript = join(packageRoot, "src", "global", "host", "kairo-ui-rpc-stdio.js");
  if (!existsSyncImpl(sidecarScript)) {
    throw new Error(
      `Ratatui sidecar is missing: "${sidecarScript}". ` +
        "Use --pi for the Pi shell."
    );
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
