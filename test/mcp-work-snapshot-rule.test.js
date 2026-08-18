import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WORK_SNAPSHOT_RULE_BODY,
  buildWorkSnapshotRuleFile,
  ensureWorkSnapshotRule,
  resolveWorkSnapshotRulePath
} from "../src/global/mcp/work-snapshot-rule.js";

test("managed rule forbids agent-supplied workspace identity", () => {
  const body = buildWorkSnapshotRuleFile();
  assert.match(body, /alwaysApply: true/);
  assert.match(body, /kairo_publish_work_snapshot/);
  assert.match(body, /kairo-workspace/);
  assert.match(body, /--workspace-bound/);
  assert.match(body, /absolute-folder/);
  assert.match(body, /WORKSPACE_FOLDER_PATHS/);
  assert.match(body, /never send `projectKey`/);
  assert.match(body, /does not register/);
  assert.match(body, /workspace_ambiguous/);
  assert.match(body, /workspace_mismatch/);
  assert.match(WORK_SNAPSHOT_RULE_BODY, /Never invent work/);
  assert.match(WORK_SNAPSHOT_RULE_BODY, /Do not retry with paths/);
  assert.doesNotMatch(body, /returns `workspace_unbound`/);
  assert.doesNotMatch(body, /projectPath|transcripts to Kairo/i);
});

test("ensureWorkSnapshotRule writes once then stays idempotent", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-rule-"));
  try {
    const first = await ensureWorkSnapshotRule({ homeDir, apply: true, now: () => 1 });
    assert.equal(first.wrote, true);
    assert.equal(first.path, resolveWorkSnapshotRulePath(homeDir));
    const onDisk = await readFile(first.path, "utf8");
    assert.equal(onDisk, buildWorkSnapshotRuleFile());

    const second = await ensureWorkSnapshotRule({ homeDir, apply: true, now: () => 2 });
    assert.equal(second.wrote, false);
    assert.equal(second.wouldWrite, false);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
