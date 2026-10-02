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

const EVALUATION = {
  comparable: true, confidence: "medium", capabilities: { reasoning: 0.75, coding: 0.5 },
  benchmarkCounts: { reasoning: 2, coding: 1 }, optionalEvidence: false, missing: []
};
const NO_EVALUATION = {
  comparable: null, confidence: null, capabilities: { reasoning: null, coding: null },
  benchmarkCounts: { reasoning: null, coding: null }, optionalEvidence: false, missing: ["reasoning", "coding"]
};
function entry(overrides = {}) {
  const adapterId = overrides.adapterId ?? "codex";
  const modelId = overrides.modelId ?? "gpt-5";
  return {
    candidateKey: `${adapterId}::${modelId}`, adapterId, modelId, displayName: modelId,
    evidenceStatus: "scored", available: true, accessVerified: true, selectable: true, cause: null,
    rank: 1, qualification: "qualified", identityKey: modelId, evidenceKey: modelId, evaluation: { ...EVALUATION },
    recommendationTags: [],
    ...overrides
  };
}
const noEvidence = { evidenceStatus: "unscored", rank: null, qualification: "no_evidence", evidenceKey: null, evaluation: { ...NO_EVALUATION } };
const unverified = (overrides = {}) => entry({
  available: false, accessVerified: false, cause: "access_unknown", entitlement: "unverified", ...overrides
});
const keys = (rows) => rows.map((row) => row.candidateKey);

test("flat list (T27): all verified available routes, best→worst by catalog rank — no top-three / Other", () => {
  const curated = curateAnalystCatalogForPicker({
    recommendedModel: null,
    models: [
      entry({ adapterId: "codex", modelId: "c1", displayName: "C1", rank: 4 }),
      entry({ adapterId: "claude", modelId: "k1", displayName: "K1", rank: 1 }),
      entry({ adapterId: "cursor", modelId: "u1", displayName: "U1", rank: 2 }),
      entry({ adapterId: "codex", modelId: "c2", displayName: "C2", rank: 3 }),
      entry({ adapterId: "claude", modelId: "k2", displayName: "K2", rank: 5 }),
      entry({ adapterId: "cursor", modelId: "u2", displayName: "U2", rank: 6 })
    ]
  });
  assert.deepEqual(keys(curated.models), ["claude::k1", "cursor::u1", "codex::c2", "codex::c1", "claude::k2", "cursor::u2"]);
  assert.deepEqual(curated.alternatives, []);
  assert.equal(curated.recommendedModel, null);
  assert.ok(curated.models.every((row) => row.listing === "main"));
});

test("rank order ignores brand preference; unranked rows follow ranked (T27)", () => {
  const curated = curateAnalystCatalogForPicker({
    models: [
      entry({ adapterId: "codex", modelId: "gpt", displayName: "GPT", rank: 1 }),
      entry({ adapterId: "cursor", modelId: "composer", displayName: "Composer", rank: 2 }),
      entry({ adapterId: "claude", modelId: "opus", displayName: "Opus", rank: 3 })
    ]
  });
  assert.deepEqual(keys(curated.models), ["codex::gpt", "cursor::composer", "claude::opus"]);
});

test("recommendedModel is always null even when the raw catalog points at a row", () => {
  const rows = [
    entry({ adapterId: "codex", modelId: "a", displayName: "A", rank: 2 }),
    entry({ adapterId: "claude", modelId: "b", displayName: "B", rank: 1 })
  ];
  const curated = curateAnalystCatalogForPicker({ recommendedModel: { candidateKey: "codex::a" }, models: rows });
  assert.equal(curated.recommendedModel, null);
  assert.deepEqual(keys(curated.models), ["claude::b", "codex::a"]);
  const thin = curateAnalystCatalogForPicker({ models: [entry({ displayName: "Thin", qualification: "partial_evidence" })] });
  assert.equal(thin.recommendedModel, null);
  assert.equal(thin.models.length, 1);
});

test("thin, insufficient and unscored verified rows stay in the flat list", () => {
  const curated = curateAnalystCatalogForPicker({
    models: [
      entry({ adapterId: "codex", modelId: "good", displayName: "Good", rank: 1 }),
      entry({ adapterId: "codex", modelId: "thin", displayName: "Thin", rank: 2, qualification: "partial_evidence" }),
      entry({ adapterId: "claude", modelId: "partial", displayName: "Partial", rank: null, qualification: "insufficient_evidence", evaluation: { ...NO_EVALUATION, missing: ["coding"] } }),
      entry({ adapterId: "cursor", modelId: "unscored", displayName: "Unscored", ...noEvidence })
    ]
  });
  assert.deepEqual(keys(curated.models), ["codex::good", "codex::thin", "claude::partial", "cursor::unscored"]);
  assert.deepEqual(curated.alternatives, []);
});

test("unverified, denied and exhausted rows are in NEITHER list", () => {
  const curated = curateAnalystCatalogForPicker({
    models: [
      entry({ adapterId: "codex", modelId: "ok" }),
      unverified({ adapterId: "claude", modelId: "unknown" }),
      unverified({ adapterId: "cursor", modelId: "both", ...noEvidence }),
      entry({ adapterId: "cursor", modelId: "exhausted", available: false, selectable: false, cause: "quota_exhausted" })
    ]
  });
  assert.deepEqual(keys(curated.models), ["codex::ok"]);
  assert.deepEqual(keys(curated.alternatives), []);
});

test("explanations separate aptitude from evidential confidence; detail carries counts for d (T29)", () => {
  const curated = curateAnalystCatalogForPicker({
    models: [
      entry({ modelId: "strong", displayName: "Strong", rank: 1, evaluation: { ...EVALUATION, capabilities: { reasoning: 0.9, coding: 0.8 } } }),
      entry({ modelId: "meh", displayName: "Meh", rank: 2, evaluation: { ...EVALUATION, capabilities: { reasoning: 0.4, coding: 0.35 } } }),
      entry({ modelId: "unscored", displayName: "Unscored", ...noEvidence })
    ]
  });
  assert.equal(curated.recommendedModel, null);
  assert.deepEqual(curated.alternatives, []);
  const strong = curated.models.find((row) => row.modelId === "strong");
  assert.match(strong.explanation, /apto|investigar/i);
  assert.doesNotMatch(strong.explanation, /menor capacidad/i);
  const unscored = curated.models.find((row) => row.modelId === "unscored");
  assert.match(unscored.explanation, /no implica menor capacidad/i);
  assert.match(unscored.detail, /sin fila de benchmark|benchmark/i);
});

test("rows carry model AND subscription so the same model on two subscriptions is distinguishable", () => {
  const curated = curateAnalystCatalogForPicker({
    models: [
      entry({ adapterId: "codex", modelId: "gpt-x", displayName: "GPT-X", rank: 1 }),
      entry({ adapterId: "cursor", modelId: "gpt-x", displayName: "GPT-X", rank: 2 })
    ]
  });
  assert.deepEqual(curated.models.map((row) => row.label), ["GPT-X · Codex", "GPT-X · Cursor"]);
  assert.deepEqual(curated.models.map((row) => row.subscription), ["Codex", "Cursor"]);
  assert.deepEqual([curated.models.length, curated.alternatives.length], [2, 0]);
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

test("a subscription that could not be verified is acknowledged compactly; causes stay machine-readable for d (T25)", () => {
  const raw = { models: [entry({ adapterId: "codex", modelId: "ok" }), unverified({ adapterId: "cursor", modelId: "c" })] };
  const curated = curateAnalystCatalogForPicker(raw);
  const notice = buildAnalystPickerNotice(raw, curated);
  assert.match(notice, /Comparación parcial — d = detalles/);
  assert.doesNotMatch(notice, /Cursor:|Claude:|cuota/);
  const causes = buildAnalystExclusionCauses(raw, curated);
  assert.ok(causes.some((row) => row.adapterId === "cursor" && row.cause === "access_unknown"));
});

// ---- sidecar entry points (fakes only) ----

test("preflightProjectTeam exposes verificationPlan and unverifiedSubscriptions additively and never calls a verification entry point", async () => {
  const plan = {
    pendingCount: 3,
    reusableCount: 1,
    mayConsumeQuota: true,
    costStatement: "x",
    subscriptions: [
      { adapterId: "claude", provider: "Claude", granularity: "model", pendingCount: 1, reusableCount: 1, checks: [] },
      { adapterId: "cursor", provider: "Cursor", granularity: "pool", pendingCount: 2, reusableCount: 0, checks: [] }
    ]
  };
  const spies = { verifyAccess: 0, verifyAnalystAccess: 0 };
  const result = await preflightProjectTeam({
    cwd: "/project",
    createConversationService: () => ({
      async preflightProject() {
        return {
          profile: null, candidates: null, projectRoot: "/project", unverifiedClaudeNotice: null, verificationPlan: plan,
          analystCatalog: {
            recommendedModel: null,
            models: [
              entry({ adapterId: "codex", modelId: "ok" }),
              unverified({ adapterId: "claude", modelId: "claude-a" }),
              unverified({ adapterId: "cursor", modelId: "c" })
            ],
            exclusions: []
          }
        };
      },
      async verifyAccess() { spies.verifyAccess += 1; },
      async verifyAnalystAccess() { spies.verifyAnalystAccess += 1; }
    })
  });
  // Analyze notice: Cursor pools stripped; Claude pending kept. Cursor still in exclusionCauses (`d`).
  assert.equal(result.verificationPlan.pendingCount, 1);
  assert.deepEqual(result.verificationPlan.subscriptions.map((s) => s.adapterId), ["claude"]);
  assert.deepEqual(result.unverifiedSubscriptions.map((s) => [s.adapterId, s.models]), [["claude", 1]]);
  assert.ok(result.exclusionCauses.some((row) => row.adapterId === "cursor" && row.cause === "access_unknown"));
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
