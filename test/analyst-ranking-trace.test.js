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
  assert.equal(trace.rows.filter((row) => row.starred).length, 0, "T26: picker has no star");
  assert.equal(trace.curated.recommendedModel, null);
  assert.match(formatAnalystTrace(trace), /claude::claude-opus-5/);
});

// T26/T27: flat list (no top-three / Other). Rewritten from the T24 main-slot assertions.
test("after T26/T27: flat list keeps every verified available route; Sol appears on both Codex and Cursor; Opus 5 is listed", () => {
  const trace = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels });
  const main = trace.rows.filter((row) => row.stage === "main").sort((a, b) => a.position - b.position);
  assert.ok(main.length > 3, "flat list is uncapped");
  assert.deepEqual(trace.curated.alternatives, []);
  assert.equal(trace.curated.recommendedModel, null);
  assert.ok(main.some((row) => row.candidateKey === "claude::claude-opus-5"), "Opus 5 stays in the flat list");
  assert.ok(main.some((row) => row.candidateKey === "codex::gpt-5-6-sol"));
  assert.ok(main.some((row) => row.candidateKey === "cursor::gpt-5-6-sol"), "equivalent routes stay separate (T27)");
  assert.equal(byKey(trace, "codex::gpt-5-6-sol").catalog.evaluation.optionalEvidence, true);
});

test("after T24 evaluator: the optional instructionFollowing datum no longer decides order — removing ifBench keeps the flat list identical", () => {
  const withoutOptional = aaModels.map((row) => ({ ...row, ifBench: null }));
  const mainOf = (t) => t.rows.filter((row) => row.stage === "main").sort((a, b) => a.position - b.position).map((row) => row.candidateKey);
  const a = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels });
  const b = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels: withoutOptional });
  assert.deepEqual(mainOf(a), mainOf(b), "same flat order with or without the optional benchmark");
});

test("after T26/T27: Cursor effort ids stay unscored but remain in the flat list, never starred", () => {
  const trace = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels });
  for (const key of ["cursor::claude-opus-5-thinking-high", "cursor::claude-sonnet-5-thinking-high"]) {
    assert.equal(byKey(trace, key).stage, "main");
    assert.equal(byKey(trace, key).catalog.qualification, "no_evidence");
    assert.equal(byKey(trace, key).starred, false);
  }
});
