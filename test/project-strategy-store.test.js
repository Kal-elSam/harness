import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

function providerStrategy(status = "suggested") {
  return {
    status,
    bootstrapAnalyst: { adapterId: "codex", modelId: "analyst" },
    orchestrator: { adapterId: "claude", modelId: "architect" },
    projectTeam: [
      { role: "Architect", model: { adapterId: "claude", modelId: "architect" } },
      {
        role: "Builder",
        model: { adapterId: "codex", modelId: "builder" },
        fallback: { adapterId: "claude", modelId: "fallback" },
        recommendedAssignment: {
          model: { adapterId: "codex", modelId: "builder" },
          fallback: { adapterId: "claude", modelId: "fallback" }
        }
      }
    ]
  };
}

for (const [assignment, select] of [
  ["projectTeam role", (strategy) => strategy.projectTeam[1].model],
  ["bootstrapAnalyst", (strategy) => strategy.bootstrapAnalyst],
  ["orchestrator", (strategy) => strategy.orchestrator],
  ["projectTeam fallback", (strategy) => strategy.projectTeam[1].fallback],
  ["projectTeam recommended model", (strategy) => strategy.projectTeam[1].recommendedAssignment.model],
  ["projectTeam recommended fallback", (strategy) => strategy.projectTeam[1].recommendedAssignment.fallback]
]) {
  test(`readProjectStrategy rejects a suggested inactive-provider ${assignment} without changing disk`, async () => {
    const { homeDir, projectRoot } = await tempHomeAndProject();
    const strategy = providerStrategy();
    select(strategy).adapterId = "opencode-go";
    await writeProjectStrategy(homeDir, projectRoot, strategy);
    const path = strategyFilePath(homeDir, projectRoot);
    const before = await readFile(path, "utf8");
    assert.equal(await readProjectStrategy(homeDir, projectRoot), null);
    assert.equal(await readFile(path, "utf8"), before);
  });
}

test("readProjectStrategy preserves suggested assignments using only claude and codex", async () => {
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const saved = await writeProjectStrategy(homeDir, projectRoot, providerStrategy());
  assert.deepEqual(await readProjectStrategy(homeDir, projectRoot), saved);
});

for (const status of ["active", "stale"]) {
  test(`readProjectStrategy preserves ${status} inactive-provider assignments`, async () => {
    const { homeDir, projectRoot } = await tempHomeAndProject();
    const strategy = providerStrategy(status);
    strategy.projectTeam[1].model.adapterId = "opencode-go";
    const saved = await writeProjectStrategy(homeDir, projectRoot, strategy);
    assert.deepEqual(await readProjectStrategy(homeDir, projectRoot), saved);
  });
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

test("approved inactive-provider assignments survive loading and retain execution routing", async () => {
  const { createKernelService } = await import("../src/global/kernel/service.js");
  const { PROJECT_ROUTE_DECISION } = await import("../src/global/conversation/project-router.js");
  const { homeDir, projectRoot } = await tempHomeAndProject();
  const projectTeam = [
    { role: "Builder", model: { candidateKey: "cursor::legacy", adapterId: "cursor", modelId: "legacy", accessMode: "automatic" } },
    { role: "Tester", model: { candidateKey: "opencode-go::legacy", adapterId: "opencode-go", modelId: "legacy", accessMode: "manual" } }
  ];
  await writeProjectStrategy(homeDir, projectRoot, { status: "active", projectTeam });
  const loaded = await readProjectStrategy(homeDir, projectRoot);
  assert.deepEqual(loaded.projectTeam, projectTeam);
  const calls = [];
  const kernel = createKernelService({
    readStrategy: () => loaded,
    readAvailability: () => ({ cursor: { ok: true }, "opencode-go": { ok: true } }),
    spawnAdapter: async (decision) => { calls.push(decision); return { workerId: "legacy-worker", ok: true, summary: "Legacy worker completed" }; }
  });
  await kernel.delegate({ role: "Builder" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "cursor");
  assert.equal(calls[0].model.modelId, "legacy");
  const handoff = await kernel.delegate({ role: "Tester" });
  assert.equal(handoff.decision, PROJECT_ROUTE_DECISION.MANUAL_HANDOFF);
  assert.equal(calls.length, 1, "manual assignment retains its existing handoff, no automatic provider call");
  assert.deepEqual((await readProjectStrategy(homeDir, projectRoot)).projectTeam, projectTeam);
});
