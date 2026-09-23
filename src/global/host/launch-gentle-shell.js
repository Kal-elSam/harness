import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isValidSessionId } from "../conversation/session-registry.js";
import { resolveHomeDir } from "../paths.js";

export const MIN_PI_VERSION = "0.85.1";

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
  whichImpl = defaultWhich,
  probeImpl = defaultProbe,
  statImpl = statSync
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

  // Do not launch through Gentle Shell. Its launcher explicitly prepends its
  // package, skills, prompts, and themes, so Pi's --no-* flags cannot make
  // Kairo's first screen quiet. Kairo uses Pi directly and supplies only its
  // own extension.
  const binary = whichImpl("pi", env);
  if (typeof binary !== "string" || !binary.startsWith("/")) {
    throw new Error(
      'Pi CLI "pi" is not on PATH. Install Pi or use --legacy-cockpit for the previous cockpit.'
    );
  }

  const probed = probeImpl(binary, ["--version"], { env });
  const version = parseVersion(probed?.stdout ?? "");
  if (!version || compareSemver(version, MIN_PI_VERSION) < 0) {
    throw new Error(
      `Pi ${version ?? "unknown"} is below ${MIN_PI_VERSION}. Use --legacy-cockpit for the previous cockpit.`
    );
  }

  const kairoPiHome = prepareKairoPiHome(env);
  // Kairo owns its interactive surface. A Kairo-only Pi home and explicit
  // resource flags prevent ambient packages, skills, themes, context files,
  // changelogs, and diagnostics from becoming Kairo's first screen.
  const args = [
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
    ...(sessionId == null ? {} : { KAIRO_SESSION_ID: sessionId })
  };
  const result = await spawnImpl(binary, args, { cwd, env: hostEnv, shell: false, stdio: "inherit" });
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

function prepareKairoPiHome(env) {
  const dir = join(resolveHomeDir(env), ".harness", "pi-agent");
  const settingsPath = join(dir, "settings.json");
  mkdirSync(dir, { recursive: true });

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
    writeFileSync(settingsPath, `${JSON.stringify({ ...settings, quietStartup: true }, null, 2)}\n`, "utf8");
  }
  return dir;
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
