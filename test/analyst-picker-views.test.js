import assert from "node:assert/strict";
import { test } from "node:test";
import {
  analyzeProjectTeam,
  curateAnalystCatalogForPicker,
  preflightProjectTeam,
  summarizeProjectContext
} from "../src/global/host/project-team-sidecar.js";
import { classifyAnalystCatalog, compareAnalystRows, qualifiesForMainView } from "../src/global/conversation/analyst-qualification.js";

const EVALUATION = {
  comparable: true, confidence: "medium", capabilities: { reasoning: 0.75, coding: 0.5 },
  benchmarkCounts: { reasoning: 2, coding: 1 }, optionalEvidence: false, missing: []
};

function entry(overrides = {}) {
  const modelId = overrides.modelId ?? "gpt-5";
  return {
    candidateKey: `codex::${modelId}`,
    adapterId: "codex",
    modelId,
    displayName: "GPT-5",
    evidenceStatus: "scored",
    available: true,
    accessVerified: true,
    selectable: true,
    cause: null,
    rank: 1,
    qualification: "qualified",
    identityKey: modelId,
    evidenceKey: modelId,
    evaluation: { ...EVALUATION },
    recommendationTags: [],
    ...overrides
  };
}

const keys = (models) => models.map((m) => m.candidateKey);

test("qualifiesForMainView needs available + verified access + a qualified (sufficient, comparable) evaluation", () => {
  assert.equal(qualifiesForMainView(entry()), true);
  assert.equal(qualifiesForMainView(entry({ available: false })), false);
  assert.equal(qualifiesForMainView(entry({ accessVerified: false })), false);
  for (const qualification of ["partial_evidence", "insufficient_evidence", "no_evidence", undefined]) {
    assert.equal(qualifiesForMainView(entry({ qualification })), false, String(qualification));
  }
});

test("flat list (T26): every verified available route, alphabetical by model · subscription · id", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: null,
    models: [
      entry({ candidateKey: "a::second", modelId: "second", displayName: "Second", rank: 2 }),
      entry({ candidateKey: "a::first", modelId: "first", displayName: "First", rank: 1 }),
      entry({ candidateKey: "a::noevidence", modelId: "ne", displayName: "NoEvidence", rank: null, qualification: "no_evidence" }),
      entry({ candidateKey: "a::unverified", modelId: "unv", displayName: "Unverified", available: false, accessVerified: false, cause: "access_unknown" })
    ]
  });
  assert.deepEqual(keys(curated.models), ["a::first", "a::noevidence", "a::second"]);
  assert.deepEqual(curated.alternatives, []);
  assert.equal(curated.recommendedModel, null);
  assert.ok(curated.models.every((m) => m.listing === "main" && (m.recommendationTags ?? []).length === 0));
});

test("flat list includes thin/partial/unscored; excludes unknown access, denied and exhausted; never stars", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: { candidateKey: "a::unv" },
    models: [
      entry({ candidateKey: "a::ok", modelId: "ok", displayName: "Ok", rank: 1 }),
      entry({ candidateKey: "a::unscored", modelId: "unscored", displayName: "Unscored", evidenceStatus: "unscored", rank: null, qualification: "no_evidence", cause: "unscored" }),
      entry({ candidateKey: "a::unv", modelId: "unv", displayName: "Unv", available: false, accessVerified: false, cause: "access_unknown", recommendationTags: ["quality"] }),
      entry({ candidateKey: "a::both", modelId: "both", displayName: "Both", evidenceStatus: "unscored", available: false, accessVerified: false, cause: "access_unknown", rank: null, qualification: "no_evidence" }),
      entry({ candidateKey: "a::partial", modelId: "partial", displayName: "Partial", rank: 2, qualification: "partial_evidence" }),
      entry({ candidateKey: "a::denied", modelId: "denied", displayName: "Denied", available: false, selectable: false, cause: "quota_exhausted" })
    ]
  });
  assert.deepEqual(keys(curated.models), ["a::ok", "a::partial", "a::unscored"]);
  assert.deepEqual(curated.alternatives, []);
  assert.equal(curated.recommendedModel, null);
});

test("equivalent routes stay separate; same candidateKey collapses once", () => {
  const twins = [
    entry({ candidateKey: "codex::gpt-5", adapterId: "codex", displayName: "GPT-5", rank: 1, identityKey: "gpt-5", evidenceKey: "gpt-5" }),
    entry({ candidateKey: "opencode-go::gpt-5", adapterId: "opencode-go", displayName: "GPT-5", rank: 2, identityKey: "gpt-5", evidenceKey: "gpt-5" })
  ];
  const many = Array.from({ length: 30 }, (_, i) => entry({
    candidateKey: `x::m${i}`, modelId: `m${i}`, displayName: `Model ${String(i).padStart(2, "0")}`, rank: 3 + i, identityKey: `m${i}`, evidenceKey: `m${i}`
  }));
  const curated = curateAnalystCatalogForPicker({ recommendedModel: null, models: [...twins, ...many] });
  assert.equal(curated.models.length, 32, "no artificial top-three truncation");
  assert.ok(keys(curated.models).includes("codex::gpt-5"));
  assert.ok(keys(curated.models).includes("opencode-go::gpt-5"));
  assert.deepEqual(curated.alternatives, []);
  const dupKey = curateAnalystCatalogForPicker({ recommendedModel: null, models: [twins[0], { ...twins[0] }] });
  assert.equal(dupKey.models.length, 1, "the same candidateKey twice is one row");
});

test("order is alphabetical by display name, then subscription, then candidateKey — input rank is ignored", () => {
  const rows = [
    entry({ candidateKey: "a::b", modelId: "b", displayName: "Bravo", rank: 2, identityKey: "b" }),
    entry({ candidateKey: "a::a", modelId: "a", displayName: "Alpha", rank: 1, identityKey: "a" }),
    entry({ candidateKey: "a::c", modelId: "c", displayName: "Charlie", rank: 3, identityKey: "c" }),
    entry({ candidateKey: "a::z", modelId: "z", displayName: "Zulu", rank: 4, identityKey: "z" })
  ];
  for (const input of [rows, [...rows].reverse(), [rows[2], rows[0], rows[3], rows[1]]]) {
    const curated = curateAnalystCatalogForPicker({ recommendedModel: null, models: input });
    assert.deepEqual(keys(curated.models), ["a::a", "a::b", "a::c", "a::z"]);
    assert.deepEqual(curated.alternatives, []);
    assert.equal(curated.recommendedModel, null);
    for (const row of curated.models) {
      assert.equal(row.explanation, null);
      assert.ok(row.detail == null || typeof row.detail === "string");
    }
  }
});

test("list lines have no recommendation copy; thin evidence keeps detail for d (T26)", () => {
  const curated = curateAnalystCatalogForPicker({
    models: [
      entry({ candidateKey: "a::ok", modelId: "ok", displayName: "Ok", rank: 1 }),
      entry({
        candidateKey: "a::sol", modelId: "sol", displayName: "Sol", rank: 2, qualification: "partial_evidence",
        evaluation: { ...EVALUATION, comparable: false, benchmarkCounts: { reasoning: 1, coding: 0 }, capabilities: { reasoning: 0.8, coding: null } }
      })
    ]
  });
  assert.deepEqual(keys(curated.models), ["a::ok", "a::sol"]);
  assert.ok(curated.models.every((row) => row.explanation == null));
  const sol = curated.models.find((row) => row.modelId === "sol");
  assert.match(sol.detail, /provisional|menos evidencia/i);
});

test("project context never reorders the flat list", () => {
  const models = [
    entry({ candidateKey: "a::b", modelId: "b", displayName: "Bravo", rank: 1, identityKey: "b" }),
    entry({ candidateKey: "a::a", modelId: "a", displayName: "Alpha", rank: 2, identityKey: "a" })
  ];
  const without = curateAnalystCatalogForPicker({ models });
  const withContext = curateAnalystCatalogForPicker({ models }, { projectContext: { stack: ["Rust"], risks: ["sin script de test"] } });
  assert.deepEqual(keys(withContext.models), keys(without.models));
  assert.deepEqual(keys(withContext.models), ["a::a", "a::b"]);
  assert.equal(withContext.recommendedModel, null);
});

test("recommendedModel is always null for the picker catalog (T26)", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: { candidateKey: "a::ok" },
    models: [entry({ candidateKey: "a::ok", recommendationTags: ["quality"] })]
  });
  assert.equal(curated.recommendedModel, null);
  assert.deepEqual(curated.models[0].recommendationTags, []);
});

test("classifyAnalystCatalog (recovery/default helper) still derives star and top-three from rank", () => {
  const rows = [
    entry({ candidateKey: "a::a", modelId: "a", rank: 1, identityKey: "a" }),
    entry({ candidateKey: "b::a", adapterId: "b", modelId: "a", rank: 2, identityKey: "a" }),
    entry({ candidateKey: "a::b", modelId: "b", rank: 3, identityKey: "b" }),
    entry({ candidateKey: "a::c", modelId: "c", rank: 4, identityKey: "c" })
  ];
  for (const input of [rows, [...rows].reverse(), [rows[2], rows[3], rows[1], rows[0]]]) {
    const { main, manual, star } = classifyAnalystCatalog(input);
    assert.deepEqual(keys(main), ["a::a", "a::b", "a::c"]);
    assert.deepEqual(keys(manual), ["b::a"]);
    assert.equal(star.candidateKey, "a::a");
  }
  assert.deepEqual([...rows].reverse().sort(compareAnalystRows).map((r) => r.candidateKey), keys(rows));
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

test("preflight exposes main models and manual alternatives, puts the equivalent route in manual, and reports unverified access separately (T24, rewritten from T23)", async () => {
  const raw = {
    recommendedModel: null,
    models: [
      entry({ candidateKey: "codex::gpt-5", adapterId: "codex", displayName: "GPT-5", rank: 1 }),
      entry({ candidateKey: "claude::gpt-5", adapterId: "claude", displayName: "GPT-5", rank: 2 }),
      entry({ candidateKey: "claude::other", adapterId: "claude", modelId: "other", displayName: "Other", rank: 3, identityKey: "other" }),
      unverifiedCatalog.models[0]
    ],
    exclusions: []
  };
  const result = await preflightProjectTeam({ cwd: "/p", createConversationService: fakeService({ analystCatalog: raw, verify: {}, calls: [] }), computeProfile: async () => null });
  assert.deepEqual(keys(result.analystCatalog.models).sort(), ["claude::other", "codex::gpt-5", "claude::gpt-5"].sort());
  assert.deepEqual(result.analystCatalog.alternatives, []);
  assert.equal(result.analystCatalog.recommendedModel, null);
  assert.deepEqual(result.unverifiedSubscriptions.map((row) => [row.adapterId, row.models]), [["claude", 1]]);
  assert.equal(result.projectContext, null, "no scan result means no context, never a made-up one");
});

test("project context (T24): the local scan is summarized for the picker, never invented, and a failing scan never blocks the picker", async () => {
  assert.equal(summarizeProjectContext(null), null);
  assert.equal(summarizeProjectContext({ stack: ["Unknown"], risks: [] }), null, "an unknown stack with nothing else says nothing");
  const context = summarizeProjectContext({
    projectName: "demo", stack: ["Node.js"], architecture: { pattern: "modular" },
    risks: [{ kind: "no-test-command" }, { kind: "something-new" }], confidence: "medium"
  });
  assert.equal(context.line, "Proyecto demo · Node.js · arquitectura modular · riesgos: sin script de test");
  assert.deepEqual(context.risks, ["sin script de test"], "only risks Kairo can word are shown");

  const raw = { recommendedModel: null, models: [entry({ rank: 1 }), entry({ candidateKey: "a::b", modelId: "b", identityKey: "b", rank: 2 })], exclusions: [] };
  const service = fakeService({ analystCatalog: raw, verify: {}, calls: [] });
  const ok = await preflightProjectTeam({ cwd: "/p", createConversationService: service, computeProfile: async () => ({ projectName: "demo", stack: ["Rust"] }) });
  assert.equal(ok.analystCatalog.recommendedModel, null);
  assert.equal(ok.projectContext.stack[0], "Rust");
  const failed = await preflightProjectTeam({ cwd: "/p", createConversationService: service, computeProfile: async () => { throw new Error("git exploded"); } });
  assert.equal(failed.projectContext, null);
  assert.deepEqual(keys(failed.analystCatalog.models), keys(ok.analystCatalog.models), "context never changes the picks");
  assert.deepEqual(failed.analystCatalog.alternatives, []);
});
