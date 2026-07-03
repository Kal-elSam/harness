import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseAttributionGuardArgs,
  runAttributionGuard
} from "./lib/attribution-guard.mjs";

export {
  assertCleanReleaseMessage,
  assertCleanReleaseMessages,
  parseAttributionGuardArgs,
  readCommitMessages,
  runAttributionGuard
} from "./lib/attribution-guard.mjs";

function defaultRunGit(command) {
  return execSync(command, { encoding: "utf8" });
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === entry;
}

if (isMainModule()) {
  const { range } = parseAttributionGuardArgs(process.argv);
  const result = runAttributionGuard({ range, runGit: defaultRunGit });
  const scope = range ?? "HEAD";

  console.log(`Release attribution guard OK (${result.checked} commit(s), range: ${scope})`);
}
