import test from "node:test";
import assert from "node:assert/strict";
import {
  approveRecoveryProposal, decideTeamRecovery, pickRecoveryAnalyst, recoveryProposalId, rejectRecoveryProposal, runTeamRecovery
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
  const entry = (model, extra = {}) => ({ ...model, evidenceStatus: "scored", entitlement: null, entitlementReason: null, available: true, qualification: "qualified", recommendationTags: [], ...extra });
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

test("T21a: pickRecoveryAnalyst never blind-picks an untagged model", () => {
  const entry = (model, extra = {}) => ({ ...model, evidenceStatus: "scored", entitlement: null, entitlementReason: null, available: true, qualification: "qualified", recommendationTags: [], ...extra });
  assert.equal(pickRecoveryAnalyst({ recommendedModel: null, models: [entry(CLAUDE), entry(CODEX)] }), null);
});

test("T21a (T24, rewritten from the confidence threshold): pickRecoveryAnalyst applies the shared qualification rule (qualified, comparable required evidence)", () => {
  const entry = (model, extra = {}) => ({ ...model, evidenceStatus: "scored", entitlement: null, entitlementReason: null, available: true, qualification: "qualified", recommendationTags: ["quality"], ...extra });
  for (const qualification of ["partial_evidence", "insufficient_evidence", "no_evidence", undefined]) {
    const thin = entry(CLAUDE, { qualification });
    assert.equal(pickRecoveryAnalyst({ recommendedModel: thin, models: [thin] }), null, String(qualification));
  }
  const ok = entry(CLAUDE);
  assert.equal(pickRecoveryAnalyst({ recommendedModel: ok, models: [ok] }).model.modelId, "claude-opus-5");
  const thinQuality = entry(CLAUDE, { qualification: "partial_evidence" });
  const okEfficient = entry(CODEX, { recommendationTags: ["efficient"] });
  assert.equal(pickRecoveryAnalyst({ recommendedModel: thinQuality, models: [thinQuality, okEfficient] }).model.modelId, "gpt-6-astra");
});

test("T21a: pickRecoveryAnalyst skips accessVerified:false even when tagged and confident", () => {
  const unverified = { ...CLAUDE, evidenceStatus: "scored", available: true, recommendationTags: ["quality"], qualification: "qualified", accessVerified: false };
  assert.equal(pickRecoveryAnalyst({ recommendedModel: unverified, models: [unverified] }), null);
});

test("T20: pickRecoveryAnalyst never picks an unverified-access model, however it is flagged or ranked", () => {
  const entry = (model, extra = {}) => ({ ...model, evidenceStatus: "scored", entitlement: null, entitlementReason: null, available: true, qualification: "qualified", recommendationTags: [], ...extra });
  const shapes = [
    { entitlement: "unverified", available: false, selectable: true, accessVerified: false, cause: "access_unknown" },
    { entitlement: "unverified", available: true },
    { entitlement: null, available: true, accessVerified: false },
    { entitlement: null, available: false, selectable: true }
  ];
  for (const shape of shapes) {
    const unverified = entry(CLAUDE, { recommendationTags: ["quality"], ...shape });
    assert.equal(pickRecoveryAnalyst({ recommendedModel: unverified, models: [unverified] }), null, JSON.stringify(shape));
    const verified = entry(CODEX, { recommendationTags: ["efficient"] });
    assert.equal(pickRecoveryAnalyst({ recommendedModel: unverified, models: [unverified, verified] }).model.modelId, verified.modelId);
  }
});

// A controllable world for runTeamRecovery: eligibility can change between
// calls, and every write is observable.
const CHOSEN_CLAUDE = { model: { adapterId: "claude", modelId: "claude-opus-5", displayName: "Claude Opus 5" }, selectionSource: "manual", recommendationTags: [], choice: null };

function world({ strategy = goTeam, record = null, eligibilitySequence = [GO_LIMITED], analyze, lock = true, analystCatalog, analystChoice = CHOSEN_CLAUDE } = {}) {
  const state = { strategy, record, writes: [], records: [], released: false, analyzeCalls: 0, locks: 0, events: [], analysts: [], clock: Date.parse("2026-09-23T12:00:00.000Z") };
  let eligibilityCalls = 0;
  const nextEligibility = () => eligibilitySequence[Math.min(eligibilityCalls++, eligibilitySequence.length - 1)];
  const catalogEntry = (model) => ({ ...model, evidenceStatus: "scored", entitlement: null, entitlementReason: null, available: true, qualification: "qualified", recommendationTags: ["quality"] });
  const context = {
    readStrategy: async () => state.strategy,
    writeStrategy: async (next) => { state.writes.push(next); state.strategy = next; },
    readRecord: async () => state.record,
    // Mirrors the real store, which stamps updatedAt on every write.
    writeRecord: async (next) => {
      state.events.push(`write:${next.outcome}`);
      const stored = { ...next, updatedAt: new Date(state.clock).toISOString() };
      state.records.push(stored);
      state.record = stored;
    },
    analystChoice,
    acquireLock: async () => (lock
      ? (state.locks += 1, { acquired: true, release: async () => { state.released = true; } })
      : { acquired: false, holder: { owner: "manual", startedAt: "2026-09-23T10:00:00.000Z" } }),
    currentEligibility: async () => nextEligibility(),
    preflight: async () => {
      state.events.push("preflight");
      const eligibility = nextEligibility();
      const catalog = analystCatalog ?? { recommendedModel: catalogEntry(CLAUDE), models: [catalogEntry(CLAUDE)] };
      return { profile: { fingerprint: "fp-2" }, candidates: { eligibility }, analystCatalog: catalog };
    },
    analyze: async ({ analyst } = {}) => {
      state.events.push("analyze");
      state.analysts.push(analyst);
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

test("recovery success: Go limited with Codex/Claude available proposes a team without Go and never activates it", async () => {
  const { state, context } = world();
  const result = await runTeamRecovery(context);
  assert.equal(result.outcome, "proposed");
  assert.equal(state.writes.length, 0, "the active team file is never touched by a proposal");
  assert.equal(state.strategy, goTeam, "the previous team stays active");
  assert.deepEqual(state.records.map((r) => r.outcome), ["started", "proposed"]);
  const record = state.records.at(-1);
  assert.equal(record.proposal.status, "suggested", "the proposal is suggested, never active");
  assert.ok(record.proposal.projectTeam.every((entry) => entry.model.adapterId !== "opencode-go"), "no proposed assignment uses the limited provider");
  assert.deepEqual(record.basedOn, { profileFingerprint: "fp-1", approvedAt: null }, "the proposal pins the base it was built against");
  assert.deepEqual(record.affected, result.affected, "the cause is persisted on the record, not just returned");
  assert.deepEqual(result.affected, [{ role: "Builder", model: "GLM-5.3", reason: "OpenCode Go monthly window is rate-limited" }], "the cause rides along");
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

test("D3: no analyst qualifies (e.g. unverified entitlement only) opens the selection with the cause — no fallback, no record, no retry consumed", async () => {
  const unverified = { ...CLAUDE, evidenceStatus: "scored", entitlement: "unverified", available: false, recommendationTags: ["quality"] };
  const { state, context } = world({ analystCatalog: { recommendedModel: unverified, models: [unverified] }, analystChoice: null });
  const result = await runTeamRecovery(context);
  assert.equal(result.outcome, "analyst_selection_required");
  assert.equal(result.suggestedAnalyst, null);
  assert.deepEqual(result.analystCatalog.models, [], "access requirements are not relaxed to fill the list");
  assert.match(result.reason, /No analyst/i);
  assert.equal(state.records.length, 0, "nothing is recorded, so no retry is consumed");
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
  assert.equal(result.outcome, "proposed");
  const reviewer = state.records.at(-1).proposal.projectTeam.find((entry) => entry.role === "Reviewer");
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
  const tooSoon = await runTeamRecovery({ ...context, analystChoice: null });
  assert.deepEqual({ outcome: tooSoon.outcome, reason: tooSoon.reason }, { outcome: "skipped", reason: "retry-later" });
  assert.equal(state.analyzeCalls, 1);

  fail = false;
  state.clock += 10 * MINUTE;
  const retried = await runTeamRecovery(context);
  assert.equal(retried.outcome, "proposed");
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
  const exhausted = await runTeamRecovery({ ...context, analystChoice: null });
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
  assert.equal(result.outcome, "proposed");
  assert.equal(state.records.at(-1).attempts, 2);
});

test("decide: activated and baseline close a fingerprint; failures only defer it", () => {
  const fingerprint = availabilityFingerprint(GO_LIMITED);
  const at = (minutesAgo) => new Date(Date.parse("2026-09-23T12:00:00.000Z") - minutesAgo * MINUTE).toISOString();
  const now = Date.parse("2026-09-23T12:00:00.000Z");
  const decide = (record) => decideTeamRecovery({ strategy: goTeam, fingerprint, record: { fingerprint: fingerprint.key, ...record }, eligibility: GO_LIMITED, now });
  assert.deepEqual(decide({ outcome: "proposed", attempts: 1, updatedAt: at(600) }), { action: "skip", reason: "already-handled" });
  assert.deepEqual(decide({ outcome: "activated", attempts: 1, updatedAt: at(600) }), { action: "skip", reason: "already-handled" });
  assert.deepEqual(decide({ outcome: "baseline", updatedAt: at(600) }), { action: "skip", reason: "already-handled" });
  assert.deepEqual(decide({ outcome: "no-usable-provider", attempts: 1, updatedAt: at(1) }), { action: "skip", reason: "retry-later" });
  assert.deepEqual(decide({ outcome: "no-usable-provider", attempts: 1, updatedAt: at(11) }), { action: "recover" });
  assert.deepEqual(decide({ outcome: "analyst_selection_required", attempts: 3, updatedAt: at(600) }), { action: "skip", reason: "retries-exhausted", lastOutcome: "analyst_selection_required" });
});

// A controllable world for approve/reject: one proposed record, observable writes.
function proposalWorld({ recordOutcome = "proposed", eligibility = GO_LIMITED } = {}) {
  const fingerprint = availabilityFingerprint(GO_LIMITED).key;
  const proposal = {
    status: "suggested", profileFingerprint: "fp-2",
    projectTeam: [
      { role: "Builder", model: CODEX, fallback: CLAUDE, assignmentSource: "recommended" },
      { role: "Reviewer", model: CLAUDE, fallback: null, assignmentSource: "recommended" }
    ]
  };
  const state = { strategy: goTeam, writes: [], records: [] };
  const context = {
    readRecord: async () => ({ fingerprint, outcome: recordOutcome, attempts: 1, basedOn: { profileFingerprint: "fp-1", approvedAt: null }, ...(recordOutcome === "proposed" ? { proposal, affected: [{ role: "Builder", model: "GLM-5.3", reason: "limited" }] } : {}) }),
    writeRecord: async (next) => { state.records.push(next); },
    readStrategy: async () => state.strategy,
    writeStrategy: async (next) => { state.writes.push(next); state.strategy = next; },
    currentEligibility: async () => eligibility,
    now: () => Date.parse("2026-09-23T12:00:00.000Z")
  };
  return { state, context, fingerprint, proposal };
}

test("approve activates the verified proposal and closes the fingerprint", async () => {
  const { state, context, fingerprint } = proposalWorld();
  const result = await approveRecoveryProposal(context);
  assert.equal(result.outcome, "approved");
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].status, "active");
  assert.deepEqual(state.writes[0].activation, { source: "recovery-approved", fingerprint });
  assert.deepEqual(state.records, [{ fingerprint, outcome: "approved" }]);
});

test("approve refuses a stale proposal instead of activating unverified models", async () => {
  const allDown = {
    "opencode-go": GO_LIMITED["opencode-go"],
    codex: { ok: false, reason: "Codex weekly window is limited" },
    claude: { ok: false, reason: "Claude Current session window is limited" }
  };
  const { state, context } = proposalWorld({ eligibility: allDown });
  await assert.rejects(() => approveRecoveryProposal(context), /stale/);
  assert.equal(state.writes.length, 0, "a stale proposal is never activated");
  assert.equal(state.records.length, 0, "the proposal stays pending for a fresh look");
});

test("approve refuses when the active team changed since the proposal was built", async () => {
  const { state, context } = proposalWorld();
  state.strategy = { ...goTeam, approvedAt: "2026-09-24T12:00:00.000Z" };
  await assert.rejects(() => approveRecoveryProposal(context), /changed since the proposal/);
  assert.equal(state.writes.length, 0, "a late approval never overwrites an edited team");
  assert.equal(state.records.length, 0, "the proposal stays pending for a fresh look");
});

test("approve refuses when the active team is no longer active", async () => {
  const { state, context } = proposalWorld();
  state.strategy = { ...goTeam, status: "stale" };
  await assert.rejects(() => approveRecoveryProposal(context), /no longer active/);
  assert.equal(state.writes.length, 0);
});

test("approve without a pending proposal fails loudly", async () => {
  const { context } = proposalWorld({ recordOutcome: "baseline" });
  await assert.rejects(() => approveRecoveryProposal(context), /No proposed recovery/);
});

test("reject closes the fingerprint and never touches the active team", async () => {
  const { state, context, fingerprint } = proposalWorld();
  const result = await rejectRecoveryProposal(context);
  assert.equal(result.outcome, "rejected");
  assert.equal(state.writes.length, 0, "rejection never writes a strategy");
  assert.equal(state.strategy, goTeam, "the previous team stays active");
  assert.deepEqual(state.records, [{ fingerprint, outcome: "rejected" }]);
});

test("reject without a pending proposal fails loudly", async () => {
  const { context } = proposalWorld({ recordOutcome: "rejected" });
  await assert.rejects(() => rejectRecoveryProposal(context), /No proposed recovery/);
});

test("D1: approve and reject bind to the viewed proposal id — any other id refuses and writes nothing", async () => {
  const { state, context } = proposalWorld();
  const viewed = recoveryProposalId(await context.readRecord());
  assert.match(viewed, /^[0-9a-f]{24}$/, "ids are derived from proposal + base even for records written before ids existed");
  for (const proposalId of ["other", "", null]) {
    await assert.rejects(() => approveRecoveryProposal({ ...context, proposalId }), /not the pending proposal you viewed/, String(proposalId));
    await assert.rejects(() => rejectRecoveryProposal({ ...context, proposalId }), /not the pending proposal you viewed/, String(proposalId));
  }
  assert.equal(state.writes.length, 0);
  assert.equal(state.records.length, 0);
  const approved = await approveRecoveryProposal({ ...context, proposalId: viewed });
  assert.equal(approved.outcome, "approved");
});

test("D1: a new recovery proposal record carries the proposal id the human will approve by", async () => {
  const { state, context } = world();
  const result = await runTeamRecovery(context);
  assert.equal(result.proposalId, recoveryProposalId(state.records.at(-1)));
  assert.equal(state.records.at(-1).proposalId, result.proposalId);
});

// ---- D3: recovery never analyzes without the human's own choice --------

test("D3: without a chosen analyst recovery only suggests one — no lock, no record, no analysis", async () => {
  const { state, context } = world({ analystChoice: null });
  const result = await runTeamRecovery(context);
  assert.equal(result.outcome, "analyst_selection_required");
  assert.equal(result.suggestedAnalyst.modelId, "claude-opus-5", "the eligible suggestion is highlighted for the human");
  assert.equal(result.analystCatalog.models.length, 1);
  assert.ok(result.affected.length > 0, "the cause rides along");
  assert.equal(state.locks, 0);
  assert.equal(state.records.length, 0);
  assert.equal(state.analyzeCalls, 0);
  assert.equal(state.writes.length, 0);
});

test("D3: opening and cancelling the selection any number of times never consumes a retry", async () => {
  const { state, context } = world({ analystChoice: null });
  for (let i = 0; i < 6; i += 1) await runTeamRecovery(context);
  assert.equal(state.records.length, 0);
  // The first REAL analysis is still attempt 1 of 3.
  const started = await runTeamRecovery({ ...context, analystChoice: CHOSEN_CLAUDE, analyze: async () => { throw new Error("timeout"); } });
  assert.equal(started.outcome, "kept-previous");
  assert.equal(state.records.at(-1).attempts, 1);
});

test("D3: the attempt is recorded right before the analysis, after the revalidation, and the human's pick is what runs", async () => {
  const { state, context } = world();
  await runTeamRecovery(context);
  const tail = state.events.slice(state.events.indexOf("preflight"));
  assert.deepEqual(tail.slice(0, 3), ["preflight", "write:started", "analyze"], tail.join(","));
  assert.deepEqual(state.records[0], { ...state.records[0], outcome: "started", attempts: 1 });
  assert.equal(state.analysts[0].model.modelId, "claude-opus-5");
  assert.equal(state.analysts[0].selectionSource, "manual", "a human pick, not 'automatic-recovery'");
});

test("D3: a chosen analyst that vanished or lost access is never substituted and costs no retry", async () => {
  const ghost = { model: { adapterId: "claude", modelId: "claude-ghost", displayName: "Ghost" }, selectionSource: "manual" };
  const { state, context } = world({ analystChoice: ghost });
  const result = await runTeamRecovery(context);
  assert.deepEqual({ outcome: result.outcome, reason: result.reason }, { outcome: "kept-previous", reason: "analyst-unavailable" });
  assert.equal(state.records.length, 0, "no attempt was recorded");
  assert.equal(state.analyzeCalls, 0, "no other analyst ran in its place");
  assert.equal(state.writes.length, 0);
});

test("D3: availability that moved before the analysis starts costs no retry and nothing runs", async () => {
  const { state, context } = world({ eligibilitySequence: [GO_LIMITED, ALL_OK] });
  const result = await runTeamRecovery(context);
  assert.deepEqual({ outcome: result.outcome, reason: result.reason }, { outcome: "kept-previous", reason: "availability-changed" });
  assert.equal(state.records.length, 0);
  assert.equal(state.analyzeCalls, 0);
});

test("D3: a started analysis that fails counts as one attempt; one that dies mid-analysis keeps its claim", async () => {
  const failed = world({ analyze: () => { throw new Error("timeout"); } });
  await runTeamRecovery(failed.context);
  assert.deepEqual(failed.state.records.map((r) => [r.outcome, r.attempts]), [["started", 1], ["analysis-failed", 1]]);

  // The process dies inside the analysis: only the claim written before it survives.
  const crashing = world();
  crashing.context.analyze = async () => { throw Object.assign(new Error("killed"), { fatal: true }); };
  const originalWrite = crashing.context.writeRecord;
  let afterAnalysis = false;
  crashing.context.writeRecord = async (next) => { if (afterAnalysis) throw new Error("process gone"); return originalWrite(next); };
  const innerAnalyze = crashing.context.analyze;
  crashing.context.analyze = async (input) => { afterAnalysis = true; return innerAnalyze(input); };
  await assert.rejects(runTeamRecovery(crashing.context), /process gone/);
  assert.deepEqual(crashing.state.records.map((r) => [r.outcome, r.attempts]), [["started", 1]], "the claim survives the crash");
});

// D4: a fresh manual analyst choice bypasses ONLY the internal retry-later /
// retries-exhausted throttle. Everything else (lock, availability, the chosen
// analyst's eligibility, terminal outcomes) still applies.
const fingerprintKey = () => availabilityFingerprint(GO_LIMITED).key;
const failedRecord = (state, attempts, outcome = "analysis-failed") => ({
  fingerprint: fingerprintKey(), outcome, attempts, updatedAt: new Date(state.clock - MINUTE).toISOString()
});

test("D4: a manual choice during an active backoff runs exactly one analysis and records the manual origin", async () => {
  const { state, context } = world();
  state.record = failedRecord(state, 1);
  const auto = await runTeamRecovery({ ...context, analystChoice: null });
  assert.deepEqual({ outcome: auto.outcome, reason: auto.reason }, { outcome: "skipped", reason: "retry-later" }, "automatic refresh keeps the throttle");

  const result = await runTeamRecovery(context);
  assert.equal(result.outcome, "proposed");
  assert.equal(state.analyzeCalls, 1);
  assert.deepEqual(state.records.map((r) => [r.outcome, r.attempts, r.origin]), [["started", 2, "manual"], ["proposed", 2, "manual"]]);
  assert.equal(state.writes.length, 0, "the active team stays untouched until approval");
});

test("D4: the bypass also holds under the lock when the record flips into backoff after the first gate", async () => {
  const { state, context } = world();
  const stale = { fingerprint: fingerprintKey(), outcome: "analysis-failed", attempts: 1, updatedAt: new Date(state.clock - 60 * MINUTE).toISOString() };
  const racing = failedRecord(state, 2);
  let reads = 0;
  context.readRecord = async () => (reads++ === 0 ? stale : racing);
  const result = await runTeamRecovery(context);
  assert.equal(result.outcome, "proposed", "the recheck under the lock must not throttle a manual choice");
  assert.equal(state.analyzeCalls, 1);
  assert.equal(state.records[0].attempts, 3, "counts continue from the fresh record");
});

test("D4: a manual choice after the 3rd failed attempt runs one analysis; attempts becomes 4, history is kept", async () => {
  const { state, context } = world();
  state.record = failedRecord(state, 3);
  const auto = await runTeamRecovery({ ...context, analystChoice: null });
  assert.deepEqual({ outcome: auto.outcome, reason: auto.reason }, { outcome: "skipped", reason: "retries-exhausted" }, "automatic refresh keeps the bound");

  const result = await runTeamRecovery(context);
  assert.equal(result.outcome, "proposed");
  assert.equal(state.analyzeCalls, 1);
  assert.deepEqual(state.records.map((r) => [r.outcome, r.attempts, r.origin]), [["started", 4, "manual"], ["proposed", 4, "manual"]]);

  const again = await runTeamRecovery(context);
  assert.deepEqual({ outcome: again.outcome, reason: again.reason }, { outcome: "skipped", reason: "already-handled" }, "terminal outcomes keep their behavior");
  assert.equal(state.analyzeCalls, 1);
});

test("D4: a manual failed attempt keeps counting and the next AUTOMATIC refresh stays throttled", async () => {
  const { state, context } = world({ analyze: () => { throw new Error("timeout"); } });
  state.record = failedRecord(state, 3);
  const failed = await runTeamRecovery(context);
  assert.equal(failed.reason, "timeout");
  assert.deepEqual(state.records.map((r) => [r.outcome, r.attempts, r.origin]), [["started", 4, "manual"], ["analysis-failed", 4, "manual"]]);
  const decision = decideTeamRecovery({
    strategy: goTeam, fingerprint: availabilityFingerprint(GO_LIMITED), record: state.record, eligibility: GO_LIMITED, now: state.clock
  });
  assert.deepEqual(decision, { action: "skip", reason: "retries-exhausted", lastOutcome: "analysis-failed" });
});

test("D4: automatic refreshes (no analystChoice) keep retry-later and retries-exhausted", () => {
  const fingerprint = availabilityFingerprint(GO_LIMITED);
  const now = Date.parse("2026-09-23T12:00:00.000Z");
  const recent = (attempts) => ({ fingerprint: fingerprint.key, outcome: "analysis-failed", attempts, updatedAt: new Date(now - MINUTE).toISOString() });
  const decide = (record, extra = {}) => decideTeamRecovery({ strategy: goTeam, fingerprint, record, eligibility: GO_LIMITED, now, ...extra });
  assert.deepEqual(decide(recent(1)), { action: "skip", reason: "retry-later" });
  assert.deepEqual(decide(recent(3)), { action: "skip", reason: "retries-exhausted", lastOutcome: "analysis-failed" });
  assert.deepEqual(decide(recent(1), { manual: true }), { action: "recover" });
  assert.deepEqual(decide(recent(3), { manual: true }), { action: "recover" });
  assert.deepEqual(decide({ ...recent(1), outcome: "proposed" }, { manual: true }), { action: "skip", reason: "already-handled" });
  assert.deepEqual(decideTeamRecovery({ strategy: null, fingerprint, record: recent(1), eligibility: GO_LIMITED, now, manual: true }), { action: "skip", reason: "no-active-team" });
});

test("D4: a blocked, ineligible or excluded analyst still blocks under a manual choice", async () => {
  const exhausted = (state) => failedRecord(state, 3);
  const blockedRow = (extra) => ({ ...CLAUDE, evidenceStatus: "scored", entitlement: null, entitlementReason: null, available: true, qualification: "qualified", recommendationTags: ["quality"], ...extra });
  const shapes = [
    { available: false },                       // provider limited / cooldown: catalog marks it unavailable
    { accessVerified: false },                  // access not verified
    { entitlement: "denied" },                  // quota / entitlement
    { qualification: "no_evidence" }            // not eligible
  ];
  for (const shape of shapes) {
    const row = blockedRow(shape);
    const { state, context } = world({ analystCatalog: { recommendedModel: row, models: [row] } });
    state.record = exhausted(state);
    const result = await runTeamRecovery(context);
    assert.deepEqual({ outcome: result.outcome, reason: result.reason }, { outcome: "kept-previous", reason: "analyst-unavailable" }, JSON.stringify(shape));
    assert.equal(state.analyzeCalls, 0, JSON.stringify(shape));
    assert.equal(state.records.length, 0, "nothing was claimed");
  }
  // Availability moving (fingerprint revalidation) also still blocks.
  const moved = world({ eligibilitySequence: [GO_LIMITED, ALL_OK] });
  moved.state.record = exhausted(moved.state);
  const result = await runTeamRecovery(moved.context);
  assert.equal(result.reason, "availability-changed");
  assert.equal(moved.state.analyzeCalls, 0);
});

test("D4: double submit never runs two analyses (the lock serializes; the second is refused, not queued)", async () => {
  const { state, context } = world();
  state.record = failedRecord(state, 3);
  let held = false;
  context.acquireLock = async () => {
    if (held) return { acquired: false, holder: { owner: "manual" } };
    held = true;
    return { acquired: true, release: async () => { held = false; } };
  };
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  const innerAnalyze = context.analyze;
  context.analyze = async (input) => { const result = await innerAnalyze(input); await gate; return result; };

  const first = runTeamRecovery(context);
  const second = await runTeamRecovery(context);
  assert.deepEqual({ outcome: second.outcome, reason: second.reason }, { outcome: "skipped", reason: "analysis-in-progress" });
  finish();
  const done = await first;
  assert.equal(done.outcome, "proposed");
  assert.equal(state.analyzeCalls, 1, "analyze ran once");

  const third = await runTeamRecovery(context);
  assert.deepEqual({ outcome: third.outcome, reason: third.reason }, { outcome: "skipped", reason: "already-handled" });
  assert.equal(state.analyzeCalls, 1);
});
