import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROJECT_STRATEGY_SCHEMA, readProjectStrategy, writeProjectStrategy } from "../src/global/conversation/project-strategy-store.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";

async function tempHomeAndProject() {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "kairo-project-"));
  return { homeDir, projectRoot };
}

function strategyFilePath(homeDir, projectRoot) {
  return join(harnessHomePaths(homeDir).sessionsDir, projectKeyForPath(projectRoot), "project-strategy.json");
}

test("readProjectStrategy returns null (NOT_ANALYZED) when nothing has been persisted yet — never a fabricated default strategy", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  assert.equal(await readProjectStrategy(homeDir, projectRoot), null);
});

test("writeProjectStrategy persists and round-trips a real strategy document", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const strategy = { status: "suggested", bootstrapAnalyst: { adapterId: "codex", modelId: "gpt-6-astra" }, orchestrator: null, activeRoles: ["Architect"], qualityTeam: [], efficientTeam: [], profileFingerprint: "abc123" };
  await writeProjectStrategy(homeDir, projectRoot, strategy);
  const read = await readProjectStrategy(homeDir, projectRoot);
  assert.equal(read.status, "suggested");
  assert.equal(read.schema, PROJECT_STRATEGY_SCHEMA);
  assert.equal(read.profileFingerprint, "abc123");
});

test("writeProjectStrategy is keyed by project path, never written inside the project's own directory", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await writeProjectStrategy(homeDir, projectRoot, { status: "suggested", profileFingerprint: "x" });
  const path = strategyFilePath(homeDir, projectRoot);
  assert.ok(path.startsWith(homeDir));
  assert.ok(!path.startsWith(projectRoot));
});

test("writeProjectStrategy rejects a document with no real status instead of persisting garbage", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await assert.rejects(() => writeProjectStrategy(homeDir, projectRoot, { profileFingerprint: "x" }));
});

test("readProjectStrategy fails closed to null on a malformed file, never throwing", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const path = strategyFilePath(homeDir, projectRoot);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "not json");
  assert.equal(await readProjectStrategy(homeDir, projectRoot), null);
});

test("writeProjectStrategy always replaces the whole document — a refresh never leaves a stale nested field behind", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  await writeProjectStrategy(homeDir, projectRoot, { status: "active", activeRoles: ["Architect", "Builder"], profileFingerprint: "old" });
  await writeProjectStrategy(homeDir, projectRoot, { status: "stale", profileFingerprint: "old" });
  const read = await readProjectStrategy(homeDir, projectRoot);
  assert.equal(read.status, "stale");
  assert.equal(read.activeRoles, undefined, "the old activeRoles must not survive a whole-document replace");
});
