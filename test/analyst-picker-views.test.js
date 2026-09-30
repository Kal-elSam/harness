import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeProjectTeam,
  curateAnalystCatalogForPicker,
  preflightProjectTeam
} from "../src/global/host/project-team-sidecar.js";
import { qualifiesForMainView, MIN_RECOMMENDATION_CONFIDENCE } from "../src/global/conversation/analyst-qualification.js";

const EVIDENCE = { reasoning: 0.7, coding: 0.6, coverage: 1 };

function entry(overrides = {}) {
  return {
    candidateKey: "codex::gpt-5",
    adapterId: "codex",
    modelId: "gpt-5",
    displayName: "GPT-5",
    evidenceStatus: "scored",
    available: true,
    accessVerified: true,
    selectable: true,
    cause: null,
    fit: 0.5,
    confidence: 0.7,
    evidence: { ...EVIDENCE },
    recommendationTags: [],
    ...overrides
  };
}

const keys = (models) => models.map((m) => m.candidateKey);

test("qualifiesForMainView needs available + verified access + reasoning AND coding evidence + confidence >= minimum", () => {
  assert.equal(qualifiesForMainView(entry()), true);
  assert.equal(qualifiesForMainView(entry({ available: false })), false);
  assert.equal(qualifiesForMainView(entry({ accessVerified: false })), false);
  assert.equal(qualifiesForMainView(entry({ evidence: { reasoning: 0.7, coding: null, coverage: 0.5 } })), false);
  assert.equal(qualifiesForMainView(entry({ evidence: { reasoning: null, coding: 0.7, coverage: 0.5 } })), false);
  assert.equal(qualifiesForMainView(entry({ evidence: undefined })), false);
  assert.equal(qualifiesForMainView(entry({ confidence: MIN_RECOMMENDATION_CONFIDENCE - 0.01 })), false);
  assert.equal(qualifiesForMainView(entry({ confidence: MIN_RECOMMENDATION_CONFIDENCE })), true);
  assert.equal(qualifiesForMainView(entry({ confidence: undefined })), false, "no valid confidence is not qualifying");
  assert.equal(qualifiesForMainView(entry({ confidence: Number.NaN })), false);
  assert.equal(qualifiesForMainView(entry({ evidence: { reasoning: 0, coding: 0, coverage: 0.8 }, fit: 0 })), true, "a measured 0 is evidence");
});

test("main list holds only qualifying candidates; no fit threshold is invented (a low but real fit qualifies)", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: null,
    models: [
      entry({ candidateKey: "a::low", modelId: "low", displayName: "Low", fit: 0.01 }),
      entry({ candidateKey: "a::high", modelId: "high", displayName: "High", fit: 0.9 }),
      entry({ candidateKey: "a::noevidence", modelId: "ne", displayName: "NoEvidence", fit: null, evidence: { reasoning: null, coding: null, coverage: null } }),
      entry({ candidateKey: "a::unverified", modelId: "unv", displayName: "Unverified", available: false, accessVerified: false, cause: "access_unknown" })
    ]
  });
  assert.deepEqual(keys(curated.models), ["a::high", "a::low"]);
  assert.deepEqual(curated.models.map((m) => m.listing), ["main", "main"]);
});

test("manual alternatives (T23, rewritten): only VERIFIED available candidates (no/partial benchmark); unknown access is excluded, never starred or tagged", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: { candidateKey: "a::unv", confidence: 0.9 },
    models: [
      entry({ candidateKey: "a::ok", modelId: "ok", displayName: "Ok" }),
      entry({ candidateKey: "a::unscored", modelId: "unscored", displayName: "Unscored", evidenceStatus: "unscored", fit: null, confidence: 0.25, cause: "unscored", evidence: { reasoning: null, coding: null, coverage: null } }),
      entry({ candidateKey: "a::unv", modelId: "unv", displayName: "Unv", available: false, accessVerified: false, cause: "access_unknown", fit: 0.4, recommendationTags: ["quality"] }),
      entry({ candidateKey: "a::both", modelId: "both", displayName: "Both", evidenceStatus: "unscored", available: false, accessVerified: false, cause: "access_unknown", fit: null, confidence: 0.25, evidence: { reasoning: null, coding: null, coverage: null } }),
      entry({ candidateKey: "a::partial", modelId: "partial", displayName: "Partial", fit: 0.2, evidence: { reasoning: 0.5, coding: null, coverage: 0.5 } }),
      entry({ candidateKey: "a::denied", modelId: "denied", displayName: "Denied", available: false, selectable: false, cause: "quota_exhausted" })
    ]
  });
  assert.deepEqual(keys(curated.models), ["a::ok"]);
  assert.deepEqual(keys(curated.alternatives), ["a::partial", "a::unscored"]);
  assert.ok(curated.alternatives.every((m) => m.listing === "manual"));
  assert.equal(curated.recommendedModel.candidateKey, "a::ok", "the star is the first ranked row, not the incoming pointer");
  assert.ok(curated.alternatives.every((m) => (m.recommendationTags ?? []).length === 0), "alternatives are never tagged");
});

test("identity is candidateKey (T23, rewritten): same model through two subscriptions keeps both rows across main+manual; no display-name dedupe", () => {
  const twins = [
    entry({ candidateKey: "codex::gpt-5", adapterId: "codex", displayName: "GPT-5", fit: 0.6 }),
    entry({ candidateKey: "opencode-go::gpt-5", adapterId: "opencode-go", displayName: "GPT-5", fit: 0.5 })
  ];
  const many = Array.from({ length: 30 }, (_, i) => entry({
    candidateKey: `x::m${i}`, modelId: `m${i}`, displayName: `Model ${i}`, fit: 0.3 + i / 1000
  }));
  const curated = curateAnalystCatalogForPicker({ recommendedModel: null, models: [...twins, ...many] });
  assert.equal(curated.models.length, 3, "main view is the top three");
  assert.equal(curated.models.length + curated.alternatives.length, 32, "nothing is lost: the rest stays reachable in the manual view");
  const all = [...curated.models, ...curated.alternatives];
  assert.ok(all.some((m) => m.candidateKey === "codex::gpt-5"));
  assert.ok(all.some((m) => m.candidateKey === "opencode-go::gpt-5"));
  const dupKey = curateAnalystCatalogForPicker({ recommendedModel: null, models: [twins[0], { ...twins[0] }] });
  assert.equal(dupKey.models.length, 1, "the same candidateKey twice is one row");
});

test("rows are sorted by fit then confidence then name across main then manual; every row carries a short plain explanation and the raw evidence (T23: top three + rest)", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: null,
    models: [
      entry({ candidateKey: "a::b", displayName: "Bravo", fit: 0.5, confidence: 0.6 }),
      entry({ candidateKey: "a::c", displayName: "Charlie", fit: 0.5, confidence: 0.9 }),
      entry({ candidateKey: "a::a", displayName: "Alpha", fit: 0.5, confidence: 0.6 }),
      entry({ candidateKey: "a::z", displayName: "Zulu", fit: 0.8, confidence: 0.55 })
    ]
  });
  assert.deepEqual(keys(curated.models), ["a::z", "a::c", "a::a"]);
  assert.deepEqual(keys(curated.alternatives), ["a::b"], "qualified beyond the top three stays reachable manually");
  for (const row of [...curated.models, ...curated.alternatives]) {
    assert.equal(typeof row.explanation, "string");
    assert.ok(row.explanation.length > 0 && row.explanation.length <= 100, row.explanation);
    assert.deepEqual(row.evidence, EVIDENCE);
  }
});

test("recommended star survives only from the main list", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: { candidateKey: "a::ok", confidence: 0.8 },
    models: [entry({ candidateKey: "a::ok", recommendationTags: ["quality"] })]
  });
  assert.equal(curated.recommendedModel.candidateKey, "a::ok");
});

// ---- second confirmation before any provider probe ----

function fakeService({ analystCatalog, verify, calls }) {
  return () => ({
    async verifyAnalystAccess(args) {
      calls.push(["verifyAnalystAccess", args]);
      return verify;
    },
    async preflightProject({ cwd, mode = "full" } = {}) {
      return { profile: mode === "catalog" ? null : {}, candidates: {}, analystCatalog, projectRoot: cwd, unverifiedClaudeNotice: null };
    },
    async runBootstrapAnalysis(args) {
      calls.push(["runBootstrapAnalysis", args]);
      return { status: "suggested", projectRoot: "/p", projectTeam: [], bootstrapAnalyst: { model: args.analyst.model } };
    }
  });
}

const unverifiedCatalog = {
  recommendedModel: null,
  models: [entry({ candidateKey: "claude::unv", adapterId: "claude", modelId: "unv", displayName: "Unv", available: false, accessVerified: false, cause: "access_unknown" })]
};
const pick = { model: { adapterId: "claude", modelId: "unv", displayName: "Unv" }, selectionSource: "manual", recommendationTags: [], choice: null };

test("an unknown-access pick without explicit confirmation never calls the provider probe nor the analysis", async () => {
  const calls = [];
  const result = await analyzeProjectTeam({
    cwd: "/p", analyst: pick,
    createConversationService: fakeService({ analystCatalog: unverifiedCatalog, verify: { status: "allowed" }, calls })
  });
  assert.equal(result.status, "analyst_access_confirmation_required");
  assert.deepEqual(result.analyst, pick.model);
  assert.ok(result.message.length > 0);
  assert.deepEqual(calls, [], "no probe, no analysis");
});

test("with accessCheckConfirmed the existing probe runs once, then the analysis; the flag never reaches the service", async () => {
  const calls = [];
  const result = await analyzeProjectTeam({
    cwd: "/p", analyst: { ...pick, accessCheckConfirmed: true },
    createConversationService: fakeService({ analystCatalog: unverifiedCatalog, verify: { status: "allowed" }, calls })
  });
  assert.equal(result.state, "suggested");
  assert.deepEqual(calls.map((c) => c[0]), ["verifyAnalystAccess", "runBootstrapAnalysis"]);
  assert.equal("accessCheckConfirmed" in calls[1][1].analyst, false);
});

test("a confirmed probe that fails still yields no analysis and no substitution", async () => {
  const calls = [];
  const result = await analyzeProjectTeam({
    cwd: "/p", analyst: { ...pick, accessCheckConfirmed: true },
    createConversationService: fakeService({ analystCatalog: unverifiedCatalog, verify: { status: "denied", reason: "no entitlement" }, calls })
  });
  assert.equal(result.status, "analyst_access_unverified");
  assert.deepEqual(calls.map((c) => c[0]), ["verifyAnalystAccess"]);
});

test("a verified pick needs no confirmation flag (no probe at all)", async () => {
  const calls = [];
  const catalog = { recommendedModel: null, models: [entry({ candidateKey: "claude::ok", adapterId: "claude", modelId: "ok", displayName: "Ok" })] };
  const result = await analyzeProjectTeam({
    cwd: "/p", analyst: { model: { adapterId: "claude", modelId: "ok", displayName: "Ok" }, selectionSource: "manual" },
    createConversationService: fakeService({ analystCatalog: catalog, verify: { status: "allowed" }, calls })
  });
  assert.equal(result.state, "suggested");
  assert.deepEqual(calls.map((c) => c[0]), ["runBootstrapAnalysis"]);
});

test("preflight exposes main models and manual alternatives, keeps both subscriptions of one model, and reports unverified access separately (T23)", async () => {
  const raw = {
    recommendedModel: null,
    models: [
      entry({ candidateKey: "codex::gpt-5", adapterId: "codex", displayName: "GPT-5" }),
      entry({ candidateKey: "claude::gpt-5", adapterId: "claude", displayName: "GPT-5", fit: 0.4 }),
      unverifiedCatalog.models[0]
    ],
    exclusions: []
  };
  const result = await preflightProjectTeam({ cwd: "/p", createConversationService: fakeService({ analystCatalog: raw, verify: {}, calls: [] }) });
  assert.deepEqual(keys(result.analystCatalog.models), ["codex::gpt-5", "claude::gpt-5"]);
  assert.deepEqual(keys(result.analystCatalog.alternatives), [], "T23: unknown access is in neither list");
  assert.deepEqual(result.unverifiedSubscriptions.map((row) => [row.adapterId, row.models]), [["claude", 1]]);
});
