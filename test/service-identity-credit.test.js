import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConversationService } from "../src/global/team/service.js";
import { appendOutcomeRecord } from "../src/global/team/launch-ledger.js";

// S67: the snapshot's role telemetry credits a proven mismatch to the model that ran, through the real ledger read.
const service = homeDir => createConversationService({
  resolveRoot: async () => "/repo",
  homeDir,
  enableProviderProbes: true,
  listPlans: async () => [],
  recoverRuns: async () => {},
  inspectExecutionAdapters: () => [{ id: "codex", available: true, launchable: true, reason: null }],
  inspectEngramIntegration: () => ({ status: "configured" }),
  readCodexUsage: async () => null,
  readClaudeUsage: async () => null,
  readCodexModels: async () => ({ status: "measured", models: [{ id: "gpt-6-astra", displayName: "GPT-6 Astra" }] }),
  readClaudeModels: () => ({ status: "documented", models: [] }),
  readOpenCodeModels: async () => ({ status: "measured", models: [] }),
  readCursorModels: async () => ({ status: "measured", models: [] }),
  readArtificialAnalysisModels: async () => ({
    status: "live", source: "test", age: "<1h",
    models: [{ slug: "gpt-6-astra", name: "GPT-6 Astra", intelligenceIndex: 52.8, codingIndex: 76.9, mathIndex: null, priceInputPerMTok: 2, priceOutputPerMTok: 10 }]
  }),
  readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "not mocked" }),
  listRunRecords: async () => [],
  readAgentSessionTelemetry: async () => ({ records: [], skipped: 0, linked: 0, ambiguous: 0 }),
});

test("a mismatch outcome row is credited to the observed model in role telemetry, not the requested one", async t => {
  const home = await mkdtemp(join(tmpdir(), "kairo-identity-credit-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  for (let i = 0; i < 5; i++) {
    await appendOutcomeRecord(home, "/repo", {
      role: "Builder", agent: "team-builder", adapterId: "codex", modelId: "gpt-requested", status: "completed", result: "pass",
      identityStatus: "mismatch", observedModelId: "gpt-6-astra", requestedModelId: "gpt-requested",
    });
  }
  const snapshot = await service(home).snapshot({ cwd: "/repo" });
  const builder = snapshot.modelIntelligence.roleTelemetry?.roles.Builder;
  assert.ok(builder, "role telemetry must be built from the outcome row");
  assert.equal(builder.get("codex::gpt-6-astra").resultRuns, 5);
  assert.equal(builder.has("codex::gpt-requested"), false);
});
