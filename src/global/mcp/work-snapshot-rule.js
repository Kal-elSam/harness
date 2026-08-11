/**
 * Managed Cursor rule: instruct agents to publish kairo.work-snapshot/v1.
 */
import { mkdir, readFile, writeFile, rename, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

export const WORK_SNAPSHOT_RULE_FILENAME = "kairo-work-snapshot.mdc";

export function resolveCursorRulesDir(homeDir = homedir()) {
  return join(homeDir, ".cursor", "rules");
}

export function resolveWorkSnapshotRulePath(homeDir = homedir()) {
  return join(resolveCursorRulesDir(homeDir), WORK_SNAPSHOT_RULE_FILENAME);
}

export const WORK_SNAPSHOT_RULE_BODY = `# Kairo work snapshot

After each significant turn, publish the true work state with MCP \`kairo_publish_work_snapshot\`:

- Required: \`conversationId\`, \`provider\` (\`cursor\`), \`goal\`, \`now\`, \`next\`
- Optional: \`progress\` (≤3), \`blockers\`, \`delegations\` (only real ones)
- Workspace identity is derived by Kairo from the runtime — never send \`projectKey\`, paths, or \`cwd\`
- Never invent work. Never send prompts, transcripts, or tool dumps
- Reuse the same \`conversationId\` for later turns in this chat
`;

export function buildWorkSnapshotRuleFile() {
  return `---
description: Publish Kairo work snapshot after significant Cursor turns
alwaysApply: true
---

${WORK_SNAPSHOT_RULE_BODY}
`;
}

async function writeAtomicText(targetPath, text, deps = {}) {
  const write = deps.writeFileFn ?? writeFile;
  const renameFn = deps.renameFn ?? rename;
  const tempPath = join(
    dirname(targetPath),
    `.${WORK_SNAPSHOT_RULE_FILENAME}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  );
  await write(tempPath, text, "utf8");
  await renameFn(tempPath, targetPath);
}

/**
 * Plan or apply the managed work-snapshot rule under ~/.cursor/rules/.
 */
export async function ensureWorkSnapshotRule({
  homeDir = homedir(),
  apply = false,
  now = () => Date.now(),
  readFileFn = readFile,
  mkdirFn = mkdir,
  copyFileFn = copyFile,
  writeFileFn = writeFile,
  renameFn = rename
} = {}) {
  const path = resolveWorkSnapshotRulePath(homeDir);
  const desired = buildWorkSnapshotRuleFile();
  let existing = null;
  try {
    existing = await readFileFn(path, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const wouldWrite = existing !== desired;
  const backupPath = wouldWrite && existing != null
    ? `${path}.kairo-backup.${now()}`
    : null;

  if (!apply) {
    return { path, wouldWrite, wrote: false, backupPath: null };
  }

  await mkdirFn(dirname(path), { recursive: true });
  if (wouldWrite && existing != null) {
    await copyFileFn(path, backupPath);
  }
  if (wouldWrite) {
    await writeAtomicText(path, desired, { writeFileFn, renameFn });
  }
  return { path, wouldWrite, wrote: wouldWrite, backupPath };
}
