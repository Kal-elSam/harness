import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTROLLED_TRACE_CATALOG, formatAnalystTrace, traceAnalystRanking } from "../src/global/conversation/analyst-ranking-trace.js";

// Verbatim rows from the local Artificial Analysis snapshot (see the fixture's _note).
const aaModels = JSON.parse(readFileSync(new URL("./fixtures/analyst-aa-excerpt.json", import.meta.url), "utf8")).models;

const byKey = (trace, key) => trace.rows.find((row) => row.candidateKey === key);
const mainRows = (trace) =>
  trace.rows.filter((row) => row.stage === "main").sort((a, b) => a.position - b.position);

test("trace reports identity, evidence, exclusion and final position for every candidate of the controlled catalog", () => {
  const trace = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels });
  const expected = CONTROLLED_TRACE_CATALOG.providerCatalogs.flatMap(({ adapterId, models }) =>
    models.map((m) => `${adapterId}::${m.id}`)
  );
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

  // T27: the picker never stars — curated.recommendedModel is always null.
  assert.equal(trace.rows.filter((row) => row.starred).length, 0);
  assert.match(formatAnalystTrace(trace), /claude::claude-opus-5/);
});

// T27 (rewritten from the T24 top-3/star assertions): flat list, no star, equivalent routes stay separate.
test("T27: flat main list keeps Opus 5 and every Sol subscription route; nothing is starred by provider", () => {
  const trace = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels });
  const main = mainRows(trace);

  assert.ok(main.length > 3, "T27 lists every usable route — not a capped top-3");
  assert.equal(
    main.map((row) => row.position).join(","),
    main.map((_, i) => i + 1).join(","),
    "main positions are contiguous from 1 in rank order"
  );
  assert.ok(
    main.some((row) => row.candidateKey === "claude::claude-opus-5"),
    "Opus 5 remains in the flat list"
  );

  const solRoutes = trace.rows.filter((row) => row.catalog?.identityKey === "gpt-5-6-sol");
  assert.ok(solRoutes.length >= 2, "Sol appears through more than one subscription");
  assert.ok(
    solRoutes.every((row) => row.stage === "main"),
    "every Sol subscription route stays in the flat main list (no artificial manual parking)"
  );
  assert.equal(
    new Set(solRoutes.map((row) => row.candidateKey)).size,
    solRoutes.length,
    "equivalent Sol routes keep distinct candidateKeys"
  );
  assert.equal(
    new Set(solRoutes.map((row) => row.catalog.identityKey)).size,
    1,
    "those routes share one model identity"
  );
  assert.equal(byKey(trace, "codex::gpt-5-6-sol").catalog.evaluation.optionalEvidence, true);
  assert.equal(trace.rows.filter((row) => row.starred).length, 0, "T27: no picker star");
});

test("T27: the optional instructionFollowing datum no longer decides anything — removing ifBench keeps the flat main order identical", () => {
  const withoutOptional = aaModels.map((row) => ({ ...row, ifBench: null }));
  const mainOf = (t) => mainRows(t).map((row) => row.candidateKey);
  const a = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels });
  const b = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels: withoutOptional });
  assert.deepEqual(mainOf(a), mainOf(b), "same flat order with or without the optional benchmark");
});

test("T27: Cursor effort ids stay unscored (data gap), listed in the flat main tail, never starred", () => {
  const trace = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels });
  const main = mainRows(trace);
  const rankedTailStart = main.findIndex((row) => row.catalog?.qualification === "no_evidence");
  assert.ok(rankedTailStart > 0, "unscored rows follow at least one ranked/qualified route");

  for (const key of ["cursor::claude-opus-5-thinking-high", "cursor::claude-sonnet-5-thinking-high"]) {
    const row = byKey(trace, key);
    assert.equal(row.stage, "main", "T27 keeps unscored-but-available effort ids in the flat list");
    assert.equal(row.catalog.qualification, "no_evidence");
    assert.equal(row.evidenceStatus, "unscored");
    assert.equal(row.benchmarks.gpqa, null, "no invented AA numbers for a data-gap id");
    assert.equal(row.starred, false);
    assert.ok(row.position > rankedTailStart, "effort ids sit in the unscored tail by rank order");
  }
});
