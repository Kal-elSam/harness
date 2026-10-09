import test from "node:test";
import assert from "node:assert/strict";
import { rankCandidatesByRequirements, scoreAvailableModels } from "../src/global/intelligence/model-intelligence.js";

const CAPABILITIES = { required: ["reasoning", "coding"], optional: ["instructionFollowing"] };

// Mechanism fixtures (synthetic shape): only relative order inside one benchmark matters here.
function row(slug, metrics) {
  return { slug, name: slug, intelligenceIndex: null, codingIndex: null, mathIndex: null, gpqa: null, hle: null, sciCode: null, mmluPro: null, liveCodeBench: null, ifBench: null, ...metrics };
}

function pool(rows, adapterFor = () => "codex") {
  return scoreAvailableModels(
    [...new Set(rows.map((r) => adapterFor(r.slug)))].map((adapterId) => ({
      adapterId, models: rows.filter((r) => adapterFor(r.slug) === adapterId).map((r) => ({ id: r.slug }))
    })),
    rows
  );
}

const keys = (result) => result.ranked.map((entry) => `${entry.model.adapterId}::${entry.model.modelId}`);

function shuffled(items, seed) {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const full = (slug, gpqa, hle, sciCode, extra = {}) => row(slug, { gpqa, hle, sciCode, intelligenceIndex: 1, codingIndex: 1, ...extra });

test("required capabilities decide the order; an optional datum never outranks a required lead", () => {
  const rows = [
    full("strong", 0.95, 0.6, 0.6),
    full("middle", 0.9, 0.5, 0.5, { ifBench: 0.9 }),
    full("weak", 0.8, 0.4, 0.4, { ifBench: 0.99 })
  ];
  const result = rankCandidatesByRequirements(pool(rows), null, { capabilities: CAPABILITIES });
  assert.deepEqual(keys(result), ["codex::strong", "codex::middle", "codex::weak"]);
});

test("the order does not depend on input order or on provider (shuffle)", () => {
  const rows = [
    full("a-model", 0.97, 0.62, 0.62),
    full("b-model", 0.93, 0.55, 0.58),
    full("c-model", 0.91, 0.5, 0.52),
    full("d-model", 0.88, 0.45, 0.5),
    full("e-model", 0.85, 0.4, 0.45)
  ];
  const adapters = ["codex", "claude", "cursor", "opencode-go", "claude"];
  const adapterFor = (slug) => adapters[rows.findIndex((r) => r.slug === slug)];
  const expected = keys(rankCandidatesByRequirements(pool(rows, adapterFor), null, { capabilities: CAPABILITIES }));
  assert.equal(expected[0], "codex::a-model");
  for (const seed of [1, 7, 42, 99, 12345]) {
    const order = shuffled(rows, seed);
    const got = keys(rankCandidatesByRequirements(pool(order, adapterFor), null, { capabilities: CAPABILITIES }));
    assert.deepEqual(got, expected, `seed ${seed}`);
  }
});

test("missing OPTIONAL evidence does not penalize: the stronger model without it still wins", () => {
  const rows = [
    full("has-optional", 0.9, 0.5, 0.5, { ifBench: 0.95 }),
    full("no-optional-but-better", 0.96, 0.6, 0.6)
  ];
  const result = rankCandidatesByRequirements(pool(rows), null, { capabilities: CAPABILITIES });
  assert.equal(keys(result)[0], "codex::no-optional-but-better");
});

test("optional evidence only breaks an exact tie on the required capabilities", () => {
  const rows = [
    full("tie-without", 0.9, 0.5, 0.5),
    full("tie-with", 0.9, 0.5, 0.5, { ifBench: 0.8 }),
    full("tie-other", 0.9, 0.5, 0.5, { ifBench: 0.7 })
  ];
  const result = rankCandidatesByRequirements(pool(rows), null, { capabilities: CAPABILITIES });
  assert.deepEqual(keys(result), ["codex::tie-with", "codex::tie-other", "codex::tie-without"]);
});

test("a candidate without evidence for a REQUIRED capability is not ranked (and says what is missing)", () => {
  const rows = [
    full("complete", 0.95, 0.6, 0.6),
    full("complete-2", 0.9, 0.5, 0.5),
    row("reasoning-only", { gpqa: 0.99, hle: 0.7, intelligenceIndex: 60 })
  ];
  const result = rankCandidatesByRequirements(pool(rows), null, { capabilities: CAPABILITIES });
  assert.deepEqual(keys(result), ["codex::complete", "codex::complete-2"]);
  assert.deepEqual(result.unranked.map((e) => [e.model.modelId, e.missing]), [["reasoning-only", ["coding"]]]);
});

test("comparable evidence is preferred over a provisional (thin) candidate even with a higher raw value", () => {
  const rows = [
    full("broad", 0.9, 0.5, 0.5),
    full("broad-2", 0.88, 0.48, 0.49),
    // one reasoning benchmark only (hle): provisional for reasoning
    row("thin", { hle: 0.99, sciCode: 0.99 })
  ];
  const result = rankCandidatesByRequirements(pool(rows), null, { capabilities: CAPABILITIES });
  const order = keys(result);
  assert.equal(order.at(-1), "codex::thin");
  assert.equal(result.ranked.at(-1).comparable, false);
  assert.ok(result.ranked.slice(0, 2).every((entry) => entry.comparable));
});

test("ties break by a stable identifier, never by input order", () => {
  const rows = [full("same-x", 0.9, 0.5, 0.5), full("same-y", 0.9, 0.5, 0.5)];
  const forward = keys(rankCandidatesByRequirements(pool(rows, (s) => (s === "same-x" ? "codex" : "claude")), null, { capabilities: CAPABILITIES }));
  const backward = keys(rankCandidatesByRequirements(pool([...rows].reverse(), (s) => (s === "same-x" ? "codex" : "claude")), null, { capabilities: CAPABILITIES }));
  assert.deepEqual(forward, backward);
});
