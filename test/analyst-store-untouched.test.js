import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { analyzeProjectTeam } from "../src/global/host/project-team-sidecar.js";
import { writeProjectStrategy } from "../src/global/conversation/project-strategy-store.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";

// T21b.1: a REAL temp-dir strategy store (same writer/path the service uses)
// behind a stubbed conversation service. If analysis were ever reached, the
// stub would write through the real store, so a regression shows both as a
// spy hit and as a byte difference.

const PROJECT = "/project";
const entry = (overrides = {}) => ({
  candidateKey: "claude::opus-unv", adapterId: "claude", modelId: "opus-unv", displayName: "Claude Opus Unverified",
  evidenceStatus: "scored", entitlement: "unverified", entitlementReason: null, available: false,
  selectable: true, accessVerified: false, cause: "access_unknown", fit: 0.9, confidence: 0.9,
  recommendationTags: [], ...overrides
});
const verifiedLow = entry({
  candidateKey: "codex::low", adapterId: "codex", modelId: "low", displayName: "Low", entitlement: null,
  available: true, selectable: true, accessVerified: true, cause: undefined, confidence: 0.1, recommendationTags: ["quality"]
});
const pick = { model: { adapterId: "claude", modelId: "opus-unv", displayName: "x" }, selectionSource: "manual", recommendationTags: [], choice: null, accessCheckConfirmed: true };
const unconfirmedPick = { ...pick, accessCheckConfirmed: undefined };

async function withStore(run) {
  const home = await mkdtemp(join(tmpdir(), "kairo-store-untouched-"));
  try {
    const previous = {
      schema: "kairo.project-strategy/v1", status: "active", projectRoot: PROJECT, approvedAt: "2026-09-01T00:00:00.000Z",
      projectTeam: [{ role: "Builder", model: { adapterId: "codex", modelId: "gpt-5" } }]
    };
    await writeProjectStrategy(home, PROJECT, previous);
    const file = join(harnessHomePaths(home).sessionsDir, projectKeyForPath(PROJECT), "project-strategy.json");
    const before = await readFile(file);
    const spies = { analysis: 0, verify: 0, approve: 0, otherAnalyst: [] };
    const service = (catalog, verify) => () => ({
      async preflightProject() {
        return { profile: { root: PROJECT }, candidates: { scoredAll: [], eligibility: {} }, analystCatalog: catalog, projectRoot: PROJECT };
      },
      async verifyAnalystAccess() {
        spies.verify += 1;
        if (verify instanceof Error) throw verify;
        return verify;
      },
      async runBootstrapAnalysis({ analyst }) {
        spies.analysis += 1;
        spies.otherAnalyst.push(analyst?.model?.modelId);
        return writeProjectStrategy(home, PROJECT, { status: "suggested", projectRoot: PROJECT, projectTeam: [] });
      },
      async approveProjectStrategy() { spies.approve += 1; }
    });
    await run({ file, before, spies, service, read: () => readFile(file) });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("T21b: analyst_selection_required leaves project-strategy.json byte-identical and never analyzes", async () => {
  await withStore(async ({ file, before, spies, service, read }) => {
    const result = await analyzeProjectTeam({
      cwd: PROJECT,
      createConversationService: service({ recommendedModel: { candidateKey: "codex::low" }, models: [verifiedLow, entry()] })
    });
    assert.equal(result.status, "analyst_selection_required");
    assert.ok(Buffer.from(before).equals(await read()), file);
    assert.deepEqual({ ...spies, otherAnalyst: spies.otherAnalyst.length }, { analysis: 0, verify: 0, approve: 0, otherAnalyst: 0 });
  });
});

test("T21b: analyst_access_unverified (failing or throwing revalidation) leaves the strategy file byte-identical, with no analysis and no substitution", async () => {
  const failures = [
    { status: "unverified", reason: "probe timed out" },
    { status: "denied", reason: "credits_required" },
    new Error("spawn EACCES")
  ];
  for (const verify of failures) {
    await withStore(async ({ before, spies, service, read }) => {
      const result = await analyzeProjectTeam({
        cwd: PROJECT,
        analyst: pick,
        createConversationService: service({ recommendedModel: { candidateKey: "codex::low" }, models: [verifiedLow, entry()] }, verify)
      });
      assert.equal(result.status, "analyst_access_unverified");
      assert.equal(result.analyst.modelId, "opus-unv");
      assert.equal(spies.verify, 1, "revalidation ran once");
      assert.equal(spies.analysis, 0, "no analyzer call");
      assert.deepEqual(spies.otherAnalyst, [], "no other model was analyzed in its place");
      assert.equal(spies.approve, 0);
      assert.ok(Buffer.from(before).equals(await read()), "strategy file is byte-identical");
    });
  }
});

test("an unknown-access pick WITHOUT the explicit second confirmation: no provider probe, no analysis, strategy file byte-identical", async () => {
  await withStore(async ({ before, spies, service, read }) => {
    const result = await analyzeProjectTeam({
      cwd: PROJECT,
      analyst: unconfirmedPick,
      createConversationService: service({ models: [verifiedLow, entry()] }, { status: "allowed" })
    });
    assert.equal(result.status, "analyst_access_confirmation_required");
    assert.equal(spies.verify, 0, "the provider probe never ran");
    assert.equal(spies.analysis, 0);
    assert.equal(spies.approve, 0);
    assert.ok(Buffer.from(before).equals(await read()));
  });
});

test("T21b (control): when revalidation passes, the stubbed analysis DOES change the file, so the byte check above can fail", async () => {
  await withStore(async ({ before, spies, service, read }) => {
    await analyzeProjectTeam({
      cwd: PROJECT, analyst: pick,
      createConversationService: service({ models: [entry()] }, { status: "allowed" })
    });
    assert.equal(spies.analysis, 1);
    assert.ok(!Buffer.from(before).equals(await read()));
  });
});
