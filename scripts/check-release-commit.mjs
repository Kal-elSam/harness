import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function assertCleanReleaseMessage(message) {
  if (/co-authored-by/i.test(message)) {
    throw new Error("Release commit message must not contain Co-authored-by or AI attribution.");
  }
}

function readHeadCommitMessage() {
  return execSync("git log -1 --format=%B", { encoding: "utf8" });
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === entry;
}

if (isMainModule()) {
  assertCleanReleaseMessage(readHeadCommitMessage());
  console.log("Release commit message OK");
}
