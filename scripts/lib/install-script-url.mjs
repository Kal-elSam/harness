import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_REPO = "Kal-elSam/harness";

export function resolveInstallScriptRef({ version, tag = null }) {
  if (version === "latest") {
    return "main";
  }

  if (tag) {
    return tag;
  }

  return `v${version}`;
}

export function resolveInstallScriptUrl({
  repo = DEFAULT_REPO,
  version,
  tag = null
}) {
  const ref = resolveInstallScriptRef({ version, tag });
  return `https://raw.githubusercontent.com/${repo}/${ref}/scripts/install.sh`;
}

export function parseInstallScriptUrlArgs(argv) {
  const args = [...argv];
  let version = "latest";
  let tag = null;
  let repo = DEFAULT_REPO;

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

    if (arg === "--tag") {
      tag = args[++index];
      continue;
    }

    if (arg.startsWith("--tag=")) {
      tag = arg.slice("--tag=".length);
      continue;
    }

    if (arg === "--repo") {
      repo = args[++index];
      continue;
    }

    if (arg.startsWith("--repo=")) {
      repo = arg.slice("--repo=".length);
      continue;
    }

    throw new Error(`Unknown option "${arg}".`);
  }

  return { version, tag, repo };
}

function isMainModule() {
  const entry = process.argv[1];

  if (!entry) {
    return false;
  }

  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(entry);
}

if (isMainModule()) {
  const { version, tag, repo } = parseInstallScriptUrlArgs(process.argv);
  console.log(resolveInstallScriptUrl({ repo, version, tag }));
}
