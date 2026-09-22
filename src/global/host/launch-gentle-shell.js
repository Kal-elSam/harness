import { spawn, spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { isValidSessionId } from "../conversation/session-registry.js";

export const MIN_PI_VERSION = "0.85.1";

export function routeInteractiveHost({ command, options = {} }) {
  if (options.legacyCockpit) return "cockpit";
  if (command === "host") return "gentle-shell";
  if (command === "shell") return "shell";
  return null;
}

export async function launchGentleShell({
  cwd,
  extensionDir,
  sessionId = null,
  env = process.env,
  spawnImpl = defaultSpawn,
  whichImpl = defaultWhich,
  probeImpl = defaultProbe,
  statImpl = statSync
} = {}) {
  assertDirectoryCwd(cwd, statImpl);
  if (sessionId != null && !isValidSessionId(sessionId)) {
    throw new Error(`Invalid session id "${sessionId}" — refusing to spawn.`);
  }
  if (typeof extensionDir !== "string" || !extensionDir.startsWith("/")) {
    throw new Error("Kairo extension path must be absolute.");
  }

  const binary = whichImpl("gentle-shell", env);
  if (typeof binary !== "string" || !binary.startsWith("/")) {
    throw new Error(
      'Gentle Shell CLI "gentle-shell" is not on PATH. Use --legacy-cockpit for the previous cockpit.'
    );
  }

  const piBinary = resolvePiBinary(env, whichImpl);
  const probed = probeImpl(piBinary, ["--version"], { env });
  const version = parseVersion(probed?.stdout ?? "");
  if (!version || compareSemver(version, MIN_PI_VERSION) < 0) {
    throw new Error(
      `Pi ${version ?? "unknown"} is below ${MIN_PI_VERSION}. Use --legacy-cockpit for the previous cockpit.`
    );
  }

  const args = ["--link", "-e", extensionDir, "--"];
  const result = await spawnImpl(binary, args, { cwd, env, shell: false, stdio: "inherit" });
  if (result && Number.isInteger(result.status) && result.status !== 0) {
    throw new Error(`gentle-shell exited ${result.status}. Use --legacy-cockpit for the previous cockpit.`);
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

function resolvePiBinary(env, whichImpl) {
  const override = env?.GENTLE_SHELL_PI;
  if (typeof override === "string" && override.startsWith("/")) return override;
  const fromPath = whichImpl("pi", env);
  return typeof fromPath === "string" && fromPath.startsWith("/") ? fromPath : "pi";
}

function parseVersion(output) {
  const match = String(output ?? "").match(/(\d+\.\d+\.\d+)/);
  return match?.[1] ?? null;
}

function compareSemver(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  return (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]);
}

function defaultWhich(command, env = process.env) {
  const result = spawnSync("which", [command], { encoding: "utf8", env, shell: false });
  const path = result.status === 0 ? result.stdout.trim() : "";
  return path.startsWith("/") ? path : null;
}

function defaultProbe(command, args, { env = process.env } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", env, shell: false });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function defaultSpawn(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.on("error", reject);
    child.on("close", (status) => resolve({ status: status ?? 1 }));
  });
}
