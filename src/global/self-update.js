import { spawn } from "node:child_process";
import { fetchPublishedVersion } from "./npm-registry.js";
import { formatCliCommand } from "./brand/cli.js";
import { commandHeader } from "./brand/index.js";

/**
 * @param {string} version
 * @returns {number[]}
 */
export function parseSemver(version) {
  const match = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1|null}
 */
export function compareSemver(a, b) {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {"npm"|"pnpm"|"yarn"|"bun"}
 */
export function detectInstallPackageManager(env = process.env) {
  const execPath = env.npm_execpath ?? "";
  const userAgent = env.npm_config_user_agent ?? "";
  if (execPath.includes("pnpm") || userAgent.startsWith("pnpm/")) return "pnpm";
  if (execPath.includes("yarn") || userAgent.startsWith("yarn/")) return "yarn";
  if (execPath.includes("bun") || userAgent.startsWith("bun/")) return "bun";
  return "npm";
}

/**
 * @param {string} packageName
 * @param {string} version
 * @param {"npm"|"pnpm"|"yarn"|"bun"} manager
 * @returns {{ command: string, args: string[], display: string }}
 */
export function buildGlobalInstallSpec(packageName, version, manager = "npm") {
  const spec = `${packageName}@${version}`;
  switch (manager) {
    case "pnpm":
      return {
        command: "pnpm",
        args: ["add", "-g", spec],
        display: `pnpm add -g ${spec}`
      };
    case "yarn":
      return {
        command: "yarn",
        args: ["global", "add", spec],
        display: `yarn global add ${spec}`
      };
    case "bun":
      return {
        command: "bun",
        args: ["add", "-g", spec],
        display: `bun add -g ${spec}`
      };
    default:
      return {
        command: "npm",
        args: ["install", "-g", spec],
        display: `npm install -g ${spec}`
      };
  }
}

/**
 * @param {object} options
 * @param {string} options.packageName
 * @param {string} options.cliVersion
 * @param {boolean} [options.yes]
 * @param {boolean} [options.json]
 * @param {typeof fetchPublishedVersion} [options.fetchVersion]
 * @param {typeof detectInstallPackageManager} [options.detectManager]
 * @param {(cmd: string, args: string[]) => Promise<{ status: number, stdout: string, stderr: string }>} [options.runCommand]
 */
export async function runSelfUpdate({
  packageName,
  cliVersion,
  yes = false,
  json = false,
  fetchVersion = fetchPublishedVersion,
  detectManager = detectInstallPackageManager,
  runCommand = defaultRunCommand
} = {}) {
  if (!packageName) throw new Error("packageName is required.");
  if (!cliVersion) throw new Error("cliVersion is required.");

  const latestVersion = await fetchVersion(packageName);
  const cmp = compareSemver(cliVersion, latestVersion);
  const manager = detectManager();
  const install = buildGlobalInstallSpec(packageName, latestVersion, manager);

  /** @type {"current"|"behind"|"ahead"|"unknown"} */
  let state = "unknown";
  if (cmp === 0) state = "current";
  else if (cmp === -1) state = "behind";
  else if (cmp === 1) state = "ahead";

  const report = {
    ok: true,
    state,
    installedVersion: cliVersion,
    latestVersion,
    packageName,
    manager,
    installCommand: install.display,
    applied: false,
    wrote: false
  };

  if (state === "current") {
    report.nextAction = "Already up to date.";
  } else if (state === "ahead") {
    report.nextAction = `Local ${cliVersion} is newer than npm ${latestVersion}.`;
  } else if (state === "behind") {
    report.nextAction = yes
      ? `Updating ${cliVersion} → ${latestVersion}…`
      : `Update available: ${cliVersion} → ${latestVersion}. Run "${formatCliCommand("update --yes")}" or: ${install.display}`;
  } else {
    report.nextAction = `Could not compare versions. Install manually: ${install.display}`;
  }

  if (json) {
    if (yes && state === "behind") {
      const result = await runCommand(install.command, install.args);
      report.applied = result.status === 0;
      report.wrote = result.status === 0;
      report.ok = result.status === 0;
      report.installStatus = result.status;
      report.stderr = result.stderr.trim() || undefined;
      report.nextAction = result.status === 0
        ? `Updated to ${latestVersion}.`
        : `Install failed (exit ${result.status}). Try: ${install.display}`;
    }
    console.log(JSON.stringify(report));
    return report;
  }

  console.log(commandHeader("update — Kairo Runtime"));
  console.log(`Installed: ${cliVersion}`);
  console.log(`Latest:    ${latestVersion}`);
  console.log(`Status:    ${state}`);

  if (state === "current") {
    console.log("\nAlready up to date.");
    return report;
  }

  if (state === "ahead") {
    console.log(`\n${report.nextAction}`);
    return report;
  }

  if (!yes) {
    console.log(`\nUpdate available: ${cliVersion} → ${latestVersion}`);
    console.log(`Run: ${formatCliCommand("update --yes")}`);
    console.log(`Or:  ${install.display}`);
    return report;
  }

  console.log(`\nInstalling ${install.display}…`);
  const result = await runCommand(install.command, install.args);
  report.applied = result.status === 0;
  report.wrote = result.status === 0;
  report.ok = result.status === 0;
  report.installStatus = result.status;
  if (result.stdout.trim()) console.log(result.stdout.trim());
  if (result.stderr.trim()) console.error(result.stderr.trim());
  if (result.status !== 0) {
    throw new Error(`Self-update failed (exit ${result.status}). Try: ${install.display}`);
  }
  console.log(`\nUpdated to ${latestVersion}. Run "${formatCliCommand("--version")}" to confirm.`);
  report.nextAction = `Updated to ${latestVersion}.`;
  return report;
}

function defaultRunCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: process.env
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ status: 1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      resolve({ status: code ?? 1, stdout, stderr });
    });
  });
}
