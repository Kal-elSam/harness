import test from "node:test";
import assert from "node:assert/strict";
import { computeBootstrapAnalystCatalog } from "../src/global/conversation/project-strategy.js";
import { curateAnalystCatalogForPicker, pickDefaultAnalyst } from "../src/global/host/project-team-sidecar.js";
import { scoreAvailableModels } from "../src/global/intelligence/model-intelligence.js";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";

// Mechanism fixtures (synthetic shape): only the relative order inside each benchmark matters.
const row = (slug, metrics) => ({
  slug, name: slug, intelligenceIndex: null, codingIndex: null, mathIndex: null,
  gpqa: null, hle: null, sciCode: null, mmluPro: null, liveCodeBench: null, ifBench: null, ...metrics
});
const full = (slug, gpqa, hle, sciCode, extra = {}) => row(slug, { gpqa, hle, sciCode, intelligenceIndex: 1, codingIndex: 1, ...extra });

/** routes: [adapterId, slug] pairs; the same slug on two adapters is the same model via two subscriptions. */
function catalogFor(aaRows, routes, { eligible = null, entitlement = {}, denied = [] } = {}) {
  const adapters = [...new Set(routes.map(([adapterId]) => adapterId))];
  const all = scoreAvailableModels(
    adapters.map((adapterId) => ({ adapterId, models: routes.filter(([a]) => a === adapterId).map(([, id]) => ({ id })) })),
    aaRows
  ).map((model) => ({ ...model, candidateKey: `${model.adapterId}::${model.modelId}`, entitlement: entitlement[`${model.adapterId}::${model.modelId}`] ?? ENTITLEMENT.NOT_APPLICABLE }));
  // Like the product's candidate pools: a verified-DENIED route never enters the selection pools; it travels separately.
  const isDenied = (model) => denied.includes(model.candidateKey);
  const scored = all.filter((model) => !isDenied(model));
  const deniedScoredPool = all.filter(isDenied).map((model) => ({ ...model, entitlement: ENTITLEMENT.DENIED }));
  const eligibility = Object.fromEntries(adapters.map((adapterId) => [adapterId, { ok: eligible ? eligible.includes(adapterId) : true }]));
  return computeBootstrapAnalystCatalog({ scoredAll: scored, manualSelectionScoredPool: scored, deniedScoredPool, eligibility, registry: createCapabilityRegistry() });
}

const rowOf = (catalog, key) => catalog.models.find((model) => model.candidateKey === key);
const order = (catalog) => catalog.models.filter((m) => m.rank != null).sort((a, b) => a.rank - b.rank).map((m) => m.candidateKey);

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

test("the better-evaluated candidate is starred whatever its provider or the input order", () => {
  const aa = [full("best", 0.97, 0.62, 0.62), full("second", 0.93, 0.55, 0.58), full("third", 0.9, 0.5, 0.5), full("fourth", 0.85, 0.4, 0.45)];
  const routes = [["claude", "best"], ["codex", "second"], ["cursor", "third"], ["opencode-go", "fourth"]];
  const reference = catalogFor(aa, routes);
  assert.equal(reference.recommendedModel.candidateKey, "claude::best");
  assert.equal(order(reference).length, 4, "every evaluated route carries a rank");
  for (const seed of [3, 11, 77, 2024]) {
    const catalog = catalogFor(shuffled(aa, seed), shuffled(routes, seed + 1));
    assert.deepEqual(order(catalog), order(reference), `seed ${seed}`);
    assert.equal(catalog.recommendedModel.candidateKey, "claude::best");
  }
  // and the same order with the providers swapped around
  const swapped = catalogFor(aa, [["codex", "best"], ["claude", "second"], ["opencode-go", "third"], ["cursor", "fourth"]]);
  assert.equal(swapped.recommendedModel.modelId, "best");
});

test("absent OPTIONAL data does not penalize: the stronger model without instructionFollowing evidence is starred", () => {
  const aa = [
    full("strong-no-ifbench", 0.96, 0.6, 0.6),
    full("weaker-with-ifbench", 0.9, 0.5, 0.5, { ifBench: 0.99 }),
    full("weakest-with-ifbench", 0.85, 0.4, 0.4, { ifBench: 0.95 })
  ];
  const catalog = catalogFor(aa, [["claude", "strong-no-ifbench"], ["codex", "weaker-with-ifbench"], ["codex", "weakest-with-ifbench"]]);
  assert.equal(catalog.recommendedModel.modelId, "strong-no-ifbench");
  assert.equal(rowOf(catalog, "claude::strong-no-ifbench").qualification, "qualified");
  assert.equal(rowOf(catalog, "claude::strong-no-ifbench").evaluation.optionalEvidence, false);
});

test("insufficient REQUIRED evidence gets no star, no rank and says which capability is missing", () => {
  const aa = [full("complete-a", 0.95, 0.6, 0.6), full("complete-b", 0.9, 0.5, 0.5), row("reasoning-only", { gpqa: 0.99, hle: 0.7, intelligenceIndex: 60 })];
  const catalog = catalogFor(aa, [["claude", "complete-a"], ["codex", "complete-b"], ["cursor", "reasoning-only"]]);
  const thin = rowOf(catalog, "cursor::reasoning-only");
  assert.equal(thin.qualification, "insufficient_evidence");
  assert.equal(thin.rank, null);
  assert.deepEqual(thin.evaluation.missing, ["coding"]);
  assert.notEqual(catalog.recommendedModel?.candidateKey, "cursor::reasoning-only");

  const onlyThin = catalogFor([row("reasoning-only", { gpqa: 0.99, hle: 0.7, intelligenceIndex: 60 })], [["claude", "reasoning-only"]]);
  assert.equal(onlyThin.recommendedModel, null, "no star when nothing has sufficient required evidence");
  assert.equal(onlyThin.models.length, 1, "the row is still listed (manual), never invented away");
});

test("an unscored model has no rank and no evaluation; it is never starred", () => {
  const scored = catalogFor([full("a", 0.9, 0.5, 0.5), full("b", 0.8, 0.4, 0.4)], [["claude", "a"], ["codex", "b"]]);
  const withUnscored = computeBootstrapAnalystCatalog({
    scoredAll: [], manualSelectionScoredPool: [], eligibility: { cursor: { ok: true } }, registry: createCapabilityRegistry(),
    unscoredModels: [{ adapterId: "cursor", modelId: "mystery-effort", displayName: "Mystery", candidateKey: "cursor::mystery-effort", entitlement: ENTITLEMENT.NOT_APPLICABLE }]
  });
  assert.equal(scored.models.every((m) => m.qualification === "qualified"), true);
  const mystery = withUnscored.models[0];
  assert.equal(mystery.qualification, "no_evidence");
  assert.equal(mystery.rank, null);
  assert.equal(withUnscored.recommendedModel, null);
});

test("the same model through several subscriptions: adjacent ranks, one identity, evidence counted once", () => {
  const aa = [full("shared", 0.95, 0.6, 0.6), full("other", 0.9, 0.5, 0.5), full("third", 0.85, 0.45, 0.45)];
  const duplicated = catalogFor(aa, [["codex", "shared"], ["cursor", "shared"], ["claude", "other"], ["opencode-go", "third"]]);
  const single = catalogFor(aa, [["codex", "shared"], ["claude", "other"], ["opencode-go", "third"]]);
  const codex = rowOf(duplicated, "codex::shared");
  const cursor = rowOf(duplicated, "cursor::shared");
  assert.equal(codex.identityKey, cursor.identityKey);
  assert.deepEqual(codex.evaluation, cursor.evaluation);
  assert.equal(Math.abs(codex.rank - cursor.rank), 1);
  assert.equal(codex.rank < cursor.rank, true, "equivalent routes break ties by candidateKey, never input order");
  for (const key of ["claude::other", "opencode-go::third"]) {
    assert.deepEqual(rowOf(duplicated, key).evaluation, rowOf(single, key).evaluation, `${key} evaluation is unchanged by a duplicate route`);
  }
});

test("equivalent routes tie-break by candidateKey in either input order", () => {
  const aa = [full("shared", 0.95, 0.6, 0.6), full("other", 0.9, 0.5, 0.5)];
  const a = catalogFor(aa, [["codex", "shared"], ["cursor", "shared"], ["claude", "other"]]);
  const b = catalogFor(aa, [["claude", "other"], ["cursor", "shared"], ["codex", "shared"]]);
  assert.equal(order(a).length, 3);
  assert.deepEqual(order(a), order(b));
  assert.equal(a.recommendedModel.candidateKey, "codex::shared");
});

test("unverified routes take part in the same comparison but are never starred", () => {
  const aa = [full("best", 0.97, 0.62, 0.62), full("second", 0.9, 0.5, 0.5), full("third", 0.85, 0.45, 0.45)];
  const routes = [["claude", "best"], ["codex", "second"], ["cursor", "third"]];
  const unverified = catalogFor(aa, routes, { entitlement: { "claude::best": ENTITLEMENT.UNVERIFIED } });
  const verified = catalogFor(aa, routes);
  assert.equal(order(verified).length, 3);
  assert.deepEqual(order(unverified), order(verified), "verification changes who may be listed, never the order");
  assert.equal(unverified.recommendedModel.modelId, "second");
  assert.equal(verified.recommendedModel.modelId, "best");
});

test("ONE classification: catalog star, picker star, default analyst and main rows agree, in any input order and before/after verification", () => {
  const aa = [full("best", 0.97, 0.62, 0.62), full("shared", 0.93, 0.55, 0.58), full("third", 0.9, 0.5, 0.5), full("fourth", 0.85, 0.4, 0.45)];
  const routes = [["claude", "best"], ["codex", "shared"], ["cursor", "shared"], ["opencode-go", "third"], ["claude", "fourth"]];
  const mainKeys = (catalog) => curateAnalystCatalogForPicker(catalog).models.map((m) => m.candidateKey);
  for (const entitlement of [{}, { "claude::best": ENTITLEMENT.UNVERIFIED }]) {
    const reference = catalogFor(aa, routes, { entitlement });
    const curated = curateAnalystCatalogForPicker(reference);
    assert.equal(curated.recommendedModel.candidateKey, reference.recommendedModel.candidateKey);
    assert.equal(pickDefaultAnalyst(reference).model.modelId, curated.recommendedModel.modelId, "default == star");
    assert.equal(new Set(curated.models.map((m) => m.identityKey)).size, curated.models.length, "main rows are distinct models");
    for (const seed of [5, 17, 301]) {
      const shuffledCatalog = catalogFor(shuffled(aa, seed), shuffled(routes, seed + 3), { entitlement });
      assert.deepEqual(mainKeys(shuffledCatalog), mainKeys(reference), `seed ${seed}`);
      assert.equal(pickDefaultAnalyst(shuffledCatalog).model.modelId, pickDefaultAnalyst(reference).model.modelId);
    }
  }
  // Verifying the unverified star changes who is listed, not the order of the rows that were already listed.
  const before = catalogFor(aa, routes, { entitlement: { "claude::best": ENTITLEMENT.UNVERIFIED } });
  const after = catalogFor(aa, routes);
  assert.deepEqual(mainKeys(before), ["codex::shared", "opencode-go::third", "claude::fourth"]);
  assert.deepEqual(mainKeys(after), ["claude::best", "codex::shared", "opencode-go::third"]);
  assert.equal(pickDefaultAnalyst(after).model.modelId, "best");
  assert.equal(pickDefaultAnalyst(before).model.modelId, "shared");
});

test("a verified-DENIED model stays in the comparison as evidence: denying it never reorders the others, and it is reported as an exclusion, never listed", () => {
  // Found by search: with this data the order of a/b/c DOES flip when t-top leaves the pool (percentiles are pool-relative).
  const aa = [full("t-top", 0.836, 0.398, 0.502), full("a", 0.81, 0.354, 0.598), full("b", 0.963, 0.394, 0.566), full("c", 0.857, 0.374, 0.58)];
  const routes = [["claude", "t-top"], ["codex", "a"], ["cursor", "b"], ["opencode-go", "c"]];
  const unverified = catalogFor(aa, routes, { entitlement: { "claude::t-top": ENTITLEMENT.UNVERIFIED } });
  const denied = catalogFor(aa, routes, { denied: ["claude::t-top"] });
  const others = (catalog) => order(catalog).filter((key) => key !== "claude::t-top");
  assert.equal(others(denied).length, 3);
  assert.deepEqual(others(denied), others(unverified), "same comparison pool, same order among the usable rows");
  const withoutDeniedEvidence = catalogFor(aa.filter((row) => row.slug !== "t-top"), routes.filter(([, id]) => id !== "t-top"));
  assert.notDeepEqual(order(withoutDeniedEvidence), others(denied), "the fixture is sensitive: dropping the denied evidence WOULD reorder the rest");
  assert.equal(denied.models.some((m) => m.candidateKey === "claude::t-top"), false, "a denied route is never a row");
  assert.deepEqual(denied.exclusions.map((e) => [e.candidateKey, e.cause]), [["claude::t-top", "unavailable_verified"]]);
});

test("an evidence-only (denied) model that would rank FIRST takes no rank: the rows' ranks stay contiguous from 1", () => {
  const aa = [full("strongest", 0.99, 0.7, 0.7), full("a", 0.9, 0.5, 0.5), full("b", 0.85, 0.45, 0.45)];
  const catalog = catalogFor(aa, [["claude", "strongest"], ["codex", "a"], ["cursor", "b"]], { denied: ["claude::strongest"] });
  assert.deepEqual(catalog.models.map((m) => [m.modelId, m.rank]), [["a", 1], ["b", 2]]);
  assert.equal(catalog.recommendedModel.modelId, "a");
});
