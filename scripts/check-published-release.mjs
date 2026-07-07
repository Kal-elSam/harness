import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function defaultRunGit(command) {
  return execSync(command, { encoding: "utf8" });
}

async function defaultFetchJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }

  return response.json();
}

export function parsePublishedReleaseArgs(argv) {
  const args = [...argv];
  let version = null;
  let packageName = "@kal-elsam/kairo-runtime";

  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--version") {
      version = args[++index];
      continue;
    }

    if (arg.startsWith("--version=")) {
      version = arg.slice("--version=".length);
      continue;
    }

    if (arg === "--package") {
      packageName = args[++index];
      continue;
    }

    if (arg.startsWith("--package=")) {
      packageName = arg.slice("--package=".length);
      continue;
    }

    throw new Error(`Unknown option "${arg}".`);
  }

  if (!version) {
    throw new Error("Missing required --version <x.y.z>.");
  }

  return { version, packageName };
}

export async function verifyPublishedRelease({
  version,
  packageName = "@kal-elsam/kairo-runtime",
  runGit = defaultRunGit,
  fetchJson = defaultFetchJson
}) {
  const tag = `v${version}`;
  const encodedPackage = encodeURIComponent(packageName);
  const meta = await fetchJson(`https://registry.npmjs.org/${encodedPackage}/${version}`);

  if (meta.version !== version) {
    throw new Error(`npm version mismatch: expected ${version}, got ${meta.version ?? "none"}`);
  }

  if (!meta.gitHead) {
    throw new Error(`npm package ${packageName}@${version} has no gitHead`);
  }

  const gitHead = meta.gitHead.trim();
  const tagSha = runGit(`git rev-parse ${tag}^{commit}`).trim();

  if (tagSha !== gitHead) {
    throw new Error(`Local tag ${tag} (${tagSha}) does not match npm gitHead (${gitHead})`);
  }

  const mainSha = runGit("git rev-parse origin/main").trim();

  if (mainSha !== gitHead) {
    try {
      runGit(`git merge-base --is-ancestor ${gitHead} origin/main`);
    } catch {
      throw new Error(
        `origin/main (${mainSha}) does not contain npm gitHead (${gitHead})`
      );
    }
  }

  const remoteTagLine = runGit(`git ls-remote --tags origin refs/tags/${tag}`).trim();

  if (!remoteTagLine.startsWith(gitHead)) {
    throw new Error(`Remote tag ${tag} on origin does not point to npm gitHead (${gitHead})`);
  }

  return {
    version,
    packageName,
    gitHead,
    tag,
    mainSha,
    tagSha,
    mainAhead: mainSha !== gitHead
  };
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === entry;
}

if (isMainModule()) {
  const { version, packageName } = parsePublishedReleaseArgs(process.argv);
  const result = await verifyPublishedRelease({ version, packageName });

  console.log("Published release provenance OK");
  console.log(`Package: ${result.packageName}@${result.version}`);
  console.log(`npm gitHead: ${result.gitHead}`);
  console.log(`Tag: ${result.tag}`);
  console.log(
    `origin/main: ${result.mainSha}${result.mainAhead ? " (contains release)" : ""}`
  );
}
