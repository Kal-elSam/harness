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

// T24 (rewritten from the BASELINE tests that characterized the old fit = profileFit x confidence ranking).
test("after T24: the same Sol model takes ONE main slot, Opus 5 is in the main view, nothing is starred by provider", () => {
  const trace = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels });
  const main = trace.rows.filter((row) => row.stage === "main").sort((a, b) => a.position - b.position);
  assert.equal(main.length, 3);
  assert.equal(new Set(main.map((row) => row.catalog.identityKey)).size, 3, "three DISTINCT models");
  assert.ok(main.some((row) => row.candidateKey === "claude::claude-opus-5"), "Opus 5 is one of the three distinct models");
  const solRoutes = trace.rows.filter((row) => row.catalog?.identityKey === "gpt-5-6-sol");
  assert.ok(solRoutes.some((row) => row.stage === "main"));
  assert.equal(solRoutes.filter((row) => row.stage === "main").length, 1, "the Sol model occupies one slot across Codex and Cursor");
  assert.equal(byKey(trace, "cursor::gpt-5-6-sol").stage, "manual", "the equivalent route is manual");
  assert.equal(byKey(trace, "codex::gpt-5-6-sol").catalog.evaluation.optionalEvidence, true);
});

test("after T24: the optional instructionFollowing datum no longer decides anything — removing ifBench from every row keeps the main three identical", () => {
  const withoutOptional = aaModels.map((row) => ({ ...row, ifBench: null }));
  const mainOf = (t) => t.rows.filter((row) => row.stage === "main").sort((a, b) => a.position - b.position).map((row) => row.candidateKey);
  const a = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels });
  const b = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels: withoutOptional });
  assert.deepEqual(new Set(mainOf(a)), new Set(mainOf(b)), "same three models with or without the optional benchmark");
});

test("after T24: the Cursor effort ids stay unscored (data gap) and are manual-only, never starred", () => {
  const trace = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels });
  for (const key of ["cursor::claude-opus-5-thinking-high", "cursor::claude-sonnet-5-thinking-high"]) {
    assert.equal(byKey(trace, key).stage, "manual");
    assert.equal(byKey(trace, key).catalog.qualification, "no_evidence");
    assert.equal(byKey(trace, key).starred, false);
  }
});
