import test from "node:test";
import assert from "node:assert/strict";
import {
  decideTeamRecovery, pickRecoveryAnalyst, runTeamRecovery
} from "../src/global/conversation/team-recovery.js";
import { availabilityFingerprint } from "../src/global/conversation/availability-fingerprint.js";

const GO = { candidateKey: "opencode-go::glm", adapterId: "opencode-go", modelId: "glm-5-3", displayName: "GLM-5.3", accessMode: "automatic" };
const CODEX = { candidateKey: "codex::astra", adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" };
const CLAUDE = { candidateKey: "claude::opus", adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5", accessMode: "automatic" };

const GO_LIMITED = {
  "opencode-go": { ok: false, reason: "OpenCode Go monthly window is rate-limited", limit: { provider: "opencode-go", window: "monthly" } },
  codex: { ok: true, reason: null },
  claude: { ok: true, reason: null }
};
const ALL_OK = { "opencode-go": { ok: true, reason: null }, codex: { ok: true, reason: null }, claude: { ok: true, reason: null } };

const activeTeam = (entries) => ({ status: "active", profileFingerprint: "fp-1", projectTeam: entries });
const goTeam = activeTeam([
  { role: "Builder", model: GO, fallback: CODEX, assignmentSource: "recommended" },
  { role: "Reviewer", model: CLAUDE, fallback: null, assignmentSource: "recommended" }
]);

test("decide: only an ACTIVE team is ever recovered", () => {
  const fingerprint = availabilityFingerprint(GO_LIMITED);
  assert.deepEqual(decideTeamRecovery({ strategy: null, fingerprint, record: null, eligibility: GO_LIMITED }), { action: "skip", reason: "no-active-team" });
  assert.deepEqual(decideTeamRecovery({ strategy: { ...goTeam, status: "suggested" }, fingerprint, record: null, eligibility: GO_LIMITED }), { action: "skip", reason: "no-active-team" });
});

test("decide: a fingerprint already acted on is never recovered twice", () => {
  const fingerprint = availabilityFingerprint(GO_LIMITED);
  const record = { fingerprint: fingerprint.key, outcome: "activated" };
  assert.deepEqual(decideTeamRecovery({ strategy: goTeam, fingerprint, record, eligibility: GO_LIMITED }), { action: "skip", reason: "already-handled" });
});

test("decide: first sight with nothing affected only records a baseline — no analysis on upgrade", () => {
  const fingerprint = availabilityFingerprint(ALL_OK);
  assert.deepEqual(decideTeamRecovery({ strategy: goTeam, fingerprint, record: null, eligibility: ALL_OK }), { action: "baseline" });
});

test("decide: an affected team, or any later availability change, triggers one recovery", () => {
  const limited = availabilityFingerprint(GO_LIMITED);
  assert.deepEqual(decideTeamRecovery({ strategy: goTeam, fingerprint: limited, record: null, eligibility: GO_LIMITED }), { action: "recover" });
  const recovered = availabilityFingerprint(ALL_OK);
  assert.deepEqual(
    decideTeamRecovery({ strategy: goTeam, fingerprint: recovered, record: { fingerprint: limited.key, outcome: "activated" }, eligibility: ALL_OK }),
    { action: "recover" },
    "availability coming back is a change too: the degraded team gets rebuilt"
  );
});

test("pickRecoveryAnalyst prefers the available quality pick, then efficient, then any scored available model — never an unavailable one", () => {
  const entry = (model, extra = {}) => ({ ...model, evidenceStatus: "scored", entitlement: null, entitlementReason: null, available: true, recommendationTags: [], ...extra });
  const quality = entry(CLAUDE, { recommendationTags: ["quality"] });
  assert.equal(pickRecoveryAnalyst({ recommendedModel: quality, models: [quality] }).model.modelId, "claude-opus-5");

  const qualityDown = entry(GO, { available: false, recommendationTags: ["quality"] });
  const efficient = entry(CODEX, { recommendationTags: ["efficient"] });
  const picked = pickRecoveryAnalyst({ recommendedModel: qualityDown, models: [qualityDown, entry(CLAUDE), efficient] });
  assert.equal(picked.model.modelId, "gpt-6-astra");
  assert.equal(picked.selectionSource, "automatic-recovery");
  assert.equal(picked.choice, "efficient");

  assert.equal(pickRecoveryAnalyst({ recommendedModel: qualityDown, models: [qualityDown, entry(CLAUDE, { evidenceStatus: "unscored" })] }), null);
  assert.equal(pickRecoveryAnalyst({ recommendedModel: null, models: [] }), null);
});

// A controllable world for runTeamRecovery: eligibility can change between
// calls, and every write is observable.
function world({ strategy = goTeam, record = null, eligibilitySequence = [GO_LIMITED], analyze, lock = true, analystCatalog } = {}) {
  const state = { strategy, record, writes: [], records: [], released: false, analyzeCalls: 0, clock: Date.parse("2026-09-23T12:00:00.000Z") };
  let eligibilityCalls = 0;
  const nextEligibility = () => eligibilitySequence[Math.min(eligibilityCalls++, eligibilitySequence.length - 1)];
  const catalogEntry = (model) => ({ ...model, evidenceStatus: "scored", entitlement: null, entitlementReason: null, available: true, recommendationTags: ["quality"] });
  const context = {
    readStrategy: async () => state.strategy,
    writeStrategy: async (next) => { state.writes.push(next); state.strategy = next; },
    readRecord: async () => state.record,
    // Mirrors the real store, which stamps updatedAt on every write.
    writeRecord: async (next) => {
      const stored = { ...next, updatedAt: new Date(state.clock).toISOString() };
      state.records.push(stored);
      state.record = stored;
    },
    acquireLock: async () => (lock
      ? { acquired: true, release: async () => { state.released = true; } }
      : { acquired: false, holder: { owner: "manual", startedAt: "2026-09-23T10:00:00.000Z" } }),
    currentEligibility: async () => nextEligibility(),
    preflight: async () => {
      const eligibility = nextEligibility();
      const catalog = analystCatalog ?? { recommendedModel: catalogEntry(CLAUDE), models: [catalogEntry(CLAUDE)] };
      return { profile: { fingerprint: "fp-2" }, candidates: { eligibility }, analystCatalog: catalog };
    },
    analyze: async () => {
      state.analyzeCalls += 1;
      if (analyze) return analyze();
      return {
        status: "suggested", profileFingerprint: "fp-2",
        projectTeam: [
          { role: "Builder", model: CODEX, fallback: CLAUDE, assignmentSource: "recommended" },
          { role: "Reviewer", model: CLAUDE, fallback: null, assignmentSource: "recommended" }
        ]
      };
    },
    now: () => state.clock
  };
  return { state, context };
}

test("recovery success: Go limited with Codex/Claude available activates a team without Go and records the fingerprint", async () => {
  const { state, context } = world();
  const result = await runTeamRecovery(context);
  assert.equal(result.outcome, "activated");
  assert.equal(state.writes.length, 1);
  const active = state.writes[0];
  assert.equal(active.status, "active");
  assert.equal(active.approvedAt, "2026-09-23T12:00:00.000Z");
  assert.deepEqual(active.activation, { source: "automatic-recovery", fingerprint: availabilityFingerprint(GO_LIMITED).key });
  assert.ok(active.projectTeam.every((entry) => entry.model.adapterId !== "opencode-go"), "no new assignment uses the limited provider");
  assert.deepEqual(state.records.map((r) => r.outcome), ["started", "activated"]);
  assert.equal(state.released, true);
});

test("recovery keeps the previous team when the analysis fails", async () => {
  const { state, context } = world({ analyze: () => { throw new Error("Bootstrap Analyst did not answer: timeout"); } });
  const result = await runTeamRecovery(context);
  assert.equal(result.outcome, "kept-previous");
  assert.match(result.reason, /did not answer/);
  assert.equal(state.writes.length, 0, "the active team is never touched");
  assert.equal(state.strategy, goTeam);
  assert.equal(state.records.at(-1).outcome, "analysis-failed");
  assert.equal(state.released, true);
});

test("recovery keeps the previous team when availability changes during the analysis", async () => {
  const { state, context } = world({ eligibilitySequence: [GO_LIMITED, GO_LIMITED, ALL_OK] });
  const result = await runTeamRecovery(context);
  assert.equal(result.outcome, "kept-previous");
  assert.equal(result.reason, "availability-changed");
  assert.equal(state.analyzeCalls, 1);
  assert.equal(state.writes.length, 0, "a team built for stale availability is never activated");
});

test("recovery keeps the previous team when no analyst is available (e.g. unverified entitlement only)", async () => {
  const unverified = { ...CLAUDE, evidenceStatus: "scored", entitlement: "unverified", available: false, recommendationTags: ["quality"] };
  const { state, context } = world({ analystCatalog: { recommendedModel: unverified, models: [unverified] } });
  const result = await runTeamRecovery(context);
  assert.equal(result.outcome, "kept-previous");
  assert.equal(result.reason, "no-analyst");
  assert.equal(state.analyzeCalls, 0);
  assert.equal(state.writes.length, 0);
});

test("recovery keeps the previous team when the recomputed team has no usable provider, and says so", async () => {
  const noneOk = { "opencode-go": GO_LIMITED["opencode-go"], codex: { ok: false, reason: "Codex weekly window is limited", limit: { window: "weekly" } }, claude: { ok: false, reason: "Claude Current session window is limited", limit: { window: "Current session" } } };
  const { state, context } = world({ eligibilitySequence: [noneOk] });
  const result = await runTeamRecovery(context);
  assert.equal(result.outcome, "kept-previous");
  assert.equal(result.reason, "no-usable-provider");
  assert.equal(state.writes.length, 0);
});

test("a held analysis lock skips without claiming the fingerprint, so a later refresh retries", async () => {
  const { state, context } = world({ lock: false });
  const result = await runTeamRecovery(context);
  assert.deepEqual({ outcome: result.outcome, reason: result.reason }, { outcome: "skipped", reason: "analysis-in-progress" });
  assert.equal(state.records.length, 0);
  assert.equal(state.analyzeCalls, 0);
});

test("repeated refreshes run the analysis once per fingerprint", async () => {
  const { state, context } = world();
  await runTeamRecovery(context);
  const second = await runTeamRecovery(context);
  const third = await runTeamRecovery(context);
  assert.equal(state.analyzeCalls, 1);
  assert.equal(second.reason, "already-handled");
  assert.equal(third.reason, "already-handled");
});

test("a human override carries over into the recovered team — recovery never discards the human's pick", async () => {
  const overridden = activeTeam([
    { role: "Builder", model: GO, fallback: CODEX, assignmentSource: "recommended" },
    { role: "Reviewer", model: { ...CODEX, candidateKey: "codex::human" , modelId: "human-pick", displayName: "Human pick" }, fallback: null, assignmentSource: "override", overrideEvidence: { accessMode: "automatic", available: true } }
  ]);
  const { state, context } = world({ strategy: overridden });
  const result = await runTeamRecovery(context);
  assert.equal(result.outcome, "activated");
  const reviewer = state.writes[0].projectTeam.find((entry) => entry.role === "Reviewer");
  assert.equal(reviewer.assignmentSource, "override");
  assert.equal(reviewer.model.modelId, "human-pick");
});

const MINUTE = 60_000;

test("REGRESSION: a failed recovery is retried on a later refresh after a backoff — never blocked forever by its fingerprint", async () => {
  let fail = true;
  const { state, context } = world({ analyze: () => {
    if (fail) throw new Error("Bootstrap Analyst did not answer: timeout");
    return { status: "suggested", projectTeam: [{ role: "Builder", model: CODEX, fallback: null, assignmentSource: "recommended" }] };
  } });
  const first = await runTeamRecovery(context);
  assert.equal(first.outcome, "kept-previous");
  assert.equal(state.records.at(-1).attempts, 1);

  state.clock += 5 * MINUTE;
  const tooSoon = await runTeamRecovery(context);
  assert.deepEqual({ outcome: tooSoon.outcome, reason: tooSoon.reason }, { outcome: "skipped", reason: "retry-later" });
  assert.equal(state.analyzeCalls, 1);

  fail = false;
  state.clock += 10 * MINUTE;
  const retried = await runTeamRecovery(context);
  assert.equal(retried.outcome, "activated");
  assert.equal(state.analyzeCalls, 2);
  assert.equal(state.records.at(-1).attempts, 2);
});

test("retries are bounded: after the last attempt the fingerprint reports retries-exhausted with the last reason", async () => {
  const { state, context } = world({ analyze: () => { throw new Error("Bootstrap Analyst did not answer: timeout"); } });
  await runTeamRecovery(context);
  state.clock += 10 * MINUTE;
  await runTeamRecovery(context);
  state.clock += 20 * MINUTE;
  await runTeamRecovery(context);
  assert.equal(state.analyzeCalls, 3);

  state.clock += 24 * 60 * MINUTE;
  const exhausted = await runTeamRecovery(context);
  assert.equal(exhausted.outcome, "skipped");
  assert.equal(exhausted.reason, "retries-exhausted");
  assert.equal(exhausted.lastOutcome, "analysis-failed");
  assert.equal(state.analyzeCalls, 3, "no fourth analysis for the same availability");
  assert.equal(state.writes.length, 0, "the previous team is still untouched");
});

test("an attempt left 'started' by a crashed process is retried after the backoff", async () => {
  const fingerprint = availabilityFingerprint(GO_LIMITED).key;
  const { state, context } = world({ record: { fingerprint, outcome: "started", attempts: 1, updatedAt: "2026-09-23T11:00:00.000Z" } });
  const result = await runTeamRecovery(context);
  assert.equal(result.outcome, "activated");
  assert.equal(state.records.at(-1).attempts, 2);
});

test("decide: activated and baseline close a fingerprint; failures only defer it", () => {
  const fingerprint = availabilityFingerprint(GO_LIMITED);
  const at = (minutesAgo) => new Date(Date.parse("2026-09-23T12:00:00.000Z") - minutesAgo * MINUTE).toISOString();
  const now = Date.parse("2026-09-23T12:00:00.000Z");
  const decide = (record) => decideTeamRecovery({ strategy: goTeam, fingerprint, record: { fingerprint: fingerprint.key, ...record }, eligibility: GO_LIMITED, now });
  assert.deepEqual(decide({ outcome: "activated", attempts: 1, updatedAt: at(600) }), { action: "skip", reason: "already-handled" });
  assert.deepEqual(decide({ outcome: "baseline", updatedAt: at(600) }), { action: "skip", reason: "already-handled" });
  assert.deepEqual(decide({ outcome: "no-usable-provider", attempts: 1, updatedAt: at(1) }), { action: "skip", reason: "retry-later" });
  assert.deepEqual(decide({ outcome: "no-usable-provider", attempts: 1, updatedAt: at(11) }), { action: "recover" });
  assert.deepEqual(decide({ outcome: "no-analyst", attempts: 3, updatedAt: at(600) }), { action: "skip", reason: "retries-exhausted", lastOutcome: "no-analyst" });
});
