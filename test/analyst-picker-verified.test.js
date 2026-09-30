import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  curateAnalystCatalogForPicker,
  buildAnalystExclusionCauses,
  buildAnalystPickerNotice,
  preflightProjectTeam,
  verifyProjectTeamAccess
} from "../src/global/host/project-team-sidecar.js";
import { createConversationService } from "../src/global/conversation/service.js";
import { writeProjectStrategy } from "../src/global/conversation/project-strategy-store.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";

// T23: the verified picker. Pure curation + sidecar entry points; every
// provider is a fake, nothing real ever runs.

const EVIDENCE = { reasoning: 0.7, coding: 0.6, coverage: 1 };
function entry(overrides = {}) {
  const adapterId = overrides.adapterId ?? "codex";
  const modelId = overrides.modelId ?? "gpt-5";
  return {
    candidateKey: `${adapterId}::${modelId}`, adapterId, modelId, displayName: modelId,
    evidenceStatus: "scored", available: true, accessVerified: true, selectable: true, cause: null,
    fit: 0.5, confidence: 0.7, evidence: { ...EVIDENCE }, recommendationTags: [],
    ...overrides
  };
}
const unverified = (overrides = {}) => entry({
  available: false, accessVerified: false, cause: "access_unknown", entitlement: "unverified", ...overrides
});
const keys = (rows) => rows.map((row) => row.candidateKey);

test("main view is the top THREE qualified options in one ranking across subscriptions; the rest go to manual (verified only)", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: null,
    models: [
      entry({ adapterId: "codex", modelId: "c1", fit: 0.61 }),
      entry({ adapterId: "claude", modelId: "k1", fit: 0.9 }),
      entry({ adapterId: "cursor", modelId: "u1", fit: 0.8 }),
      entry({ adapterId: "codex", modelId: "c2", fit: 0.7 }),
      entry({ adapterId: "claude", modelId: "k2", fit: 0.5 }),
      entry({ adapterId: "cursor", modelId: "u2", fit: 0.4 })
    ]
  });
  assert.deepEqual(keys(curated.models), ["claude::k1", "cursor::u1", "codex::c2"]);
  assert.deepEqual(keys(curated.alternatives), ["codex::c1", "claude::k2", "cursor::u2"]);
  assert.ok(curated.models.every((row) => row.listing === "main"));
  assert.ok(curated.alternatives.every((row) => row.listing === "manual"));
});

test("a better-scored Claude or Cursor outranks Codex in the curated order", () => {
  const curated = curateAnalystCatalogForPicker({
    models: [
      entry({ adapterId: "codex", modelId: "gpt", fit: 0.55 }),
      entry({ adapterId: "cursor", modelId: "composer", fit: 0.85 }),
      entry({ adapterId: "claude", modelId: "opus", fit: 0.95 })
    ]
  });
  assert.deepEqual(keys(curated.models), ["claude::opus", "cursor::composer", "codex::gpt"]);
});

test("the star is the FIRST ranked row (not any incoming pointer) and only when it qualifies", () => {
  const rows = [
    entry({ adapterId: "codex", modelId: "a", fit: 0.6 }),
    entry({ adapterId: "claude", modelId: "b", fit: 0.9 })
  ];
  const curated = curateAnalystCatalogForPicker({ recommendedModel: { candidateKey: "codex::a", confidence: 0.7 }, models: rows });
  assert.equal(curated.recommendedModel.candidateKey, "claude::b");
  assert.equal(curated.recommendedModel.candidateKey, curated.models[0].candidateKey);
  const none = curateAnalystCatalogForPicker({ models: [entry({ confidence: 0.2 })] });
  assert.equal(none.recommendedModel, null);
  assert.equal(none.models.length, 0);
});

test("the main list is never padded with insufficient candidates", () => {
  const curated = curateAnalystCatalogForPicker({
    models: [
      entry({ adapterId: "codex", modelId: "good" }),
      entry({ adapterId: "codex", modelId: "thin", confidence: 0.3 }),
      entry({ adapterId: "claude", modelId: "partial", evidence: { reasoning: 0.5, coding: null, coverage: 0.5 } }),
      entry({ adapterId: "cursor", modelId: "unscored", evidenceStatus: "unscored", fit: null, confidence: 0.25, evidence: { reasoning: null, coding: null, coverage: null } })
    ]
  });
  assert.deepEqual(keys(curated.models), ["codex::good"]);
  assert.deepEqual(keys(curated.alternatives).sort(), ["claude::partial", "codex::thin", "cursor::unscored"]);
});

test("unverified, denied and exhausted rows are in NEITHER list", () => {
  const curated = curateAnalystCatalogForPicker({
    models: [
      entry({ adapterId: "codex", modelId: "ok" }),
      unverified({ adapterId: "claude", modelId: "unknown" }),
      unverified({ adapterId: "cursor", modelId: "both", evidenceStatus: "unscored", fit: null, evidence: { reasoning: null, coding: null, coverage: null } }),
      entry({ adapterId: "cursor", modelId: "exhausted", available: false, selectable: false, cause: "quota_exhausted" })
    ]
  });
  assert.deepEqual(keys(curated.models), ["codex::ok"]);
  assert.deepEqual(keys(curated.alternatives), []);
});

test("explanations are plain language: no digits or decimals, evidence strength and confidence in words", () => {
  const curated = curateAnalystCatalogForPicker({
    models: [
      entry({ modelId: "strong", fit: 0.9, confidence: 0.9, evidence: { reasoning: 0.9, coding: 0.8, coverage: 1 } }),
      entry({ modelId: "meh", fit: 0.3, confidence: 0.55, evidence: { reasoning: 0.4, coding: 0.35, coverage: 0.6 } }),
      entry({ modelId: "unscored", evidenceStatus: "unscored", fit: null, confidence: 0.25, evidence: { reasoning: null, coding: null, coverage: null } })
    ]
  });
  for (const row of [...curated.models, ...curated.alternatives]) {
    assert.match(row.explanation, /\S/);
    assert.doesNotMatch(row.explanation, /\d/, `no numbers in: ${row.explanation}`);
  }
  assert.match(curated.models[0].explanation, /razonamiento/i);
  assert.match(curated.models[0].explanation, /c[oó]digo/i);
  assert.match(curated.models[0].explanation, /confianza/i);
  assert.notEqual(curated.models[0].explanation, curated.models[1].explanation, "different evidence reads differently");
  assert.match(curated.alternatives[0].explanation, /sin benchmark/i);
  // numeric fit stays internal to the row for ranking, not for display
  assert.equal(typeof curated.models[0].fit, "number");
});

test("rows carry model AND subscription so the same model on two subscriptions is distinguishable", () => {
  const curated = curateAnalystCatalogForPicker({
    models: [
      entry({ adapterId: "codex", modelId: "gpt-x", displayName: "GPT-X", fit: 0.6 }),
      entry({ adapterId: "cursor", modelId: "gpt-x", displayName: "GPT-X", fit: 0.6 })
    ]
  });
  assert.deepEqual(curated.models.map((row) => row.label).sort(), ["GPT-X · Codex", "GPT-X · Cursor"]);
  assert.deepEqual(curated.models.map((row) => row.subscription).sort(), ["Codex", "Cursor"]);
});

test("exclusion causes list every subscription with unverified/denied/exhausted models, even one that still has verified rows", () => {
  const raw = {
    models: [
      entry({ adapterId: "claude", modelId: "verified" }),
      unverified({ adapterId: "claude", modelId: "u1", entitlementReason: "stale" }),
      unverified({ adapterId: "claude", modelId: "u2" }),
      unverified({ adapterId: "cursor", modelId: "c-u" }),
      entry({ adapterId: "codex", modelId: "spent", available: false, selectable: false, cause: "quota_exhausted" })
    ],
    exclusions: [{ candidateKey: "claude::denied", adapterId: "claude", modelId: "denied", cause: "unavailable_verified", reason: "credits_required" }]
  };
  const curated = curateAnalystCatalogForPicker(raw);
  const causes = buildAnalystExclusionCauses(raw, curated);
  const find = (adapterId, cause) => causes.find((row) => row.adapterId === adapterId && row.cause === cause);
  assert.equal(find("claude", "access_unknown").models, 2);
  assert.equal(find("claude", "unavailable_verified").models, 1);
  assert.equal(find("cursor", "access_unknown").models, 1);
  assert.equal(find("codex", "quota_exhausted").models, 1);
});

test("a subscription that could not be verified is acknowledged in the notice so a partial comparison is never presented as complete", () => {
  const raw = { models: [entry({ adapterId: "codex", modelId: "ok" }), unverified({ adapterId: "cursor", modelId: "c" })] };
  const curated = curateAnalystCatalogForPicker(raw);
  const notice = buildAnalystPickerNotice(raw, curated);
  assert.match(notice, /Cursor: no verificado — comparación parcial/);
  assert.doesNotMatch(notice, /Codex/);
});

// ---- sidecar entry points (fakes only) ----

test("preflightProjectTeam exposes verificationPlan and unverifiedSubscriptions additively and never calls a verification entry point", async () => {
  const plan = { pendingCount: 2, reusableCount: 0, mayConsumeQuota: true, subscriptions: [{ adapterId: "cursor", provider: "Cursor", granularity: "pool", checks: [] }], costStatement: "x" };
  const spies = { verifyAccess: 0, verifyAnalystAccess: 0 };
  const result = await preflightProjectTeam({
    cwd: "/project",
    createConversationService: () => ({
      async preflightProject() {
        return {
          profile: null, candidates: null, projectRoot: "/project", unverifiedClaudeNotice: null, verificationPlan: plan,
          analystCatalog: { recommendedModel: null, models: [entry({ adapterId: "codex", modelId: "ok" }), unverified({ adapterId: "cursor", modelId: "c" })], exclusions: [] }
        };
      },
      async verifyAccess() { spies.verifyAccess += 1; },
      async verifyAnalystAccess() { spies.verifyAnalystAccess += 1; }
    })
  });
  assert.deepEqual(result.verificationPlan, plan);
  assert.deepEqual(result.unverifiedSubscriptions.map((s) => [s.adapterId, s.models]), [["cursor", 1]]);
  assert.deepEqual(spies, { verifyAccess: 0, verifyAnalystAccess: 0 });
});

test("preflightProjectTeam defaults to an empty plan when the service has none (older service)", async () => {
  const result = await preflightProjectTeam({
    cwd: "/project",
    createConversationService: () => ({
      async preflightProject() {
        return { profile: null, candidates: null, projectRoot: "/project", analystCatalog: { models: [] } };
      }
    })
  });
  assert.equal(result.verificationPlan.pendingCount, 0);
  assert.equal(result.verificationPlan.mayConsumeQuota, false);
  assert.deepEqual(result.unverifiedSubscriptions, []);
});

test("verifyProjectTeamAccess without confirmed === true never reaches a probe", async () => {
  let ran = 0;
  const make = () => ({ async verifyAccess({ confirmed }) { ran += 1; return { ran: confirmed === true, status: confirmed === true ? "verified" : "confirmation_required", outcomes: [] }; } });
  for (const confirmed of [undefined, false, "true"]) {
    const result = await verifyProjectTeamAccess({ cwd: "/project", confirmed, createConversationService: make });
    assert.equal(result.ran, false);
    assert.equal(result.status, "confirmation_required");
  }
  assert.equal(ran, 0, "the service is not even asked when consent is missing");
});

test("verifyProjectTeamAccess with consent runs the service once and returns per-subscription outcomes", async () => {
  const calls = [];
  const outcomes = [{ adapterId: "cursor", provider: "Cursor", results: [{ id: "cursor::other_models", status: "allowed", reason: null }], counts: { allowed: 1, denied: 0, unverified: 0 } }];
  const result = await verifyProjectTeamAccess({
    cwd: "/project", confirmed: true,
    createConversationService: () => ({ async verifyAccess(args) { calls.push(args); return { ran: true, status: "verified", persisted: true, outcomes }; } })
  });
  assert.deepEqual(calls, [{ cwd: "/project", confirmed: true }]);
  assert.equal(result.ran, true);
  assert.deepEqual(result.outcomes, outcomes);
});

test("verifyProjectTeamAccess reports a service failure as not-run with the real reason", async () => {
  const result = await verifyProjectTeamAccess({
    cwd: "/project", confirmed: true,
    createConversationService: () => ({ async verifyAccess() { throw new Error("disk exploded"); } })
  });
  assert.equal(result.ran, false);
  assert.equal(result.status, "failed");
  assert.match(result.message, /disk exploded/);
});

test("the strategy file is byte-identical after a cancelled (unconfirmed) and a failed verification, with the REAL service and a real store", async () => {
  const project = "/project";
  const home = await mkdtemp(join(tmpdir(), "kairo-verify-untouched-"));
  try {
    await writeProjectStrategy(home, project, {
      schema: "kairo.project-strategy/v1", status: "active", projectRoot: project, approvedAt: "2026-09-01T00:00:00.000Z",
      projectTeam: [{ role: "Builder", model: { adapterId: "codex", modelId: "gpt-5" } }]
    });
    const file = join(harnessHomePaths(home).sessionsDir, projectKeyForPath(project), "project-strategy.json");
    const before = await readFile(file);
    const probes = { claude: 0, cursor: 0 };
    const make = (claudeProbe) => () => createConversationService({
      resolveRoot: async () => project, homeDir: home, enableProviderProbes: true,
      listPlans: async () => [], recoverRuns: async () => {},
      inspectExecutionAdapters: () => [{ id: "claude", available: true, launchable: true, reason: null }, { id: "cursor", available: true, launchable: true, reason: null }],
      inspectEngramIntegration: () => ({ status: "configured" }),
      readCodexUsage: async () => null, readClaudeUsage: async () => null,
      verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
      readClaudeEntitlementCache: async () => null, writeClaudeEntitlementCache: async () => {},
      readCursorAccessCache: async () => null, writeCursorAccessCache: async () => {},
      readCodexModels: async () => ({ status: "measured", models: [] }),
      readClaudeModels: () => ({ status: "documented", models: [{ id: "claude-a", displayName: "Claude A" }] }),
      readOpenCodeModels: async () => ({ status: "measured", models: [] }),
      readCursorModels: async () => ({ status: "measured", models: [{ id: "composer-2.5", displayName: "Composer 2.5" }] }),
      probeClaudeModelEntitlements: async (args) => { probes.claude += 1; return claudeProbe(args); },
      probeCursorPoolAccess: async () => { probes.cursor += 1; throw new Error("cursor down"); },
      readArtificialAnalysisModels: async () => ({ status: "live", source: "x", age: "<1h", models: [] }),
      readHuggingFaceLeaderboard: async () => ({ status: "unknown", source: null, fetchedAt: null, age: null, entries: [], error: "n/a" }),
      listRunRecords: async () => []
    });

    await preflightProjectTeam({ cwd: project, createConversationService: make(async () => []) });
    const cancelled = await verifyProjectTeamAccess({ cwd: project, confirmed: false, createConversationService: make(async () => []) });
    assert.equal(cancelled.ran, false);
    assert.deepEqual(probes, { claude: 0, cursor: 0 }, "preflight + cancel spawn nothing");
    assert.deepEqual(await readFile(file), before);

    const failed = await verifyProjectTeamAccess({ cwd: project, confirmed: true, createConversationService: make(async () => { throw new Error("claude down"); }) });
    assert.equal(failed.ran, true, "the real run happened; both checks ended unverified with real reasons");
    assert.ok(failed.outcomes.every((o) => o.counts.unverified === o.results.length));
    assert.deepEqual(probes, { claude: 1, cursor: 1 });
    assert.deepEqual(await readFile(file), before, "verification never touches the project strategy");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
