import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTROLLED_TRACE_CATALOG, formatAnalystTrace, traceAnalystRanking } from "../src/global/conversation/analyst-ranking-trace.js";

// Verbatim rows from the local Artificial Analysis snapshot (see the fixture's _note).
const aaModels = JSON.parse(readFileSync(new URL("./fixtures/analyst-aa-excerpt.json", import.meta.url), "utf8")).models;

const byKey = (trace, key) => trace.rows.find((row) => row.candidateKey === key);

test("trace reports identity, evidence, exclusion and final position for every candidate of the controlled catalog", () => {
  const trace = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels });
  const expected = CONTROLLED_TRACE_CATALOG.providerCatalogs.flatMap(({ adapterId, models }) => models.map((m) => `${adapterId}::${m.id}`));
  assert.deepEqual(trace.rows.map((row) => row.candidateKey).sort(), expected.sort());
  const fable = byKey(trace, "claude::claude-fable-5-1");
  assert.equal(fable.stage, "excluded");
  assert.match(fable.reason, /denied/);
  assert.equal(fable.benchmarks.gpqa, 0.937, "evidence is the snapshot's own value, untouched");
  const old = byKey(trace, "claude::claude-opus-4-8");
  assert.equal(old.stage, "excluded");
  assert.match(old.reason, /superseded/);
  const cursorOpus = byKey(trace, "cursor::claude-opus-5-thinking-high");
  assert.equal(cursorOpus.evidenceStatus, "unscored", "no AA match for the Cursor effort id: a data gap, not a code outcome");
  assert.equal(cursorOpus.benchmarks.gpqa, null);
  assert.equal(trace.rows.filter((row) => row.starred).length, 1);
  assert.match(formatAnalystTrace(trace), /claude::claude-opus-5/);
});

// T24 baseline: characterizes the ranking BEFORE the shared-evaluator rewrite.
// Superseded (deliberately rewritten) by the T24 behaviour tests.
test("BASELINE: Opus 5 has the strongest measured reasoning yet ranks outside the main view; the same Sol model takes two main slots", () => {
  const trace = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels });
  const opus = byKey(trace, "claude::claude-opus-5");
  const sol = byKey(trace, "codex::gpt-5-6-sol");
  assert.ok(opus.catalog.evidence.reasoning > sol.catalog.evidence.reasoning, "Opus 5 measured reasoning is higher");
  assert.equal(opus.stage, "manual");
  assert.equal(sol.starred, true);
  const mainKeys = trace.rows.filter((row) => row.stage === "main").sort((a, b) => a.position - b.position).map((row) => row.candidateKey);
  assert.deepEqual(mainKeys.slice(0, 2), ["codex::gpt-5-6-sol", "cursor::gpt-5-6-sol"], "same model through two subscriptions takes two slots");
});

test("BASELINE cause: the gap is the optional instructionFollowing data (ifBench), amplified by code — removing ifBench from every row lets Opus 5 into the main view", () => {
  const withoutOptional = aaModels.map((row) => ({ ...row, ifBench: null }));
  const trace = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels: withoutOptional });
  assert.equal(byKey(trace, "claude::claude-opus-5").stage, "main");
  const original = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels });
  assert.notEqual(byKey(original, "claude::claude-opus-5").stage, "main");
  const confidenceOf = (t, key) => byKey(t, key).catalog.confidence;
  assert.ok(confidenceOf(original, "codex::gpt-5-6-sol") > confidenceOf(original, "claude::claude-opus-5"), "confidence (coverage incl. optional) is what separates them");
});
