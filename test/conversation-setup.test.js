import test from "node:test";
import assert from "node:assert/strict";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";
import { harness, draftTeam } from "./helpers/setup-harness.js";

const provider = (setup, id) => setup.providers.find((p) => p.id === id);
const code = (promise) => promise.then(() => null, (e) => e.code);

test("setup read: installed is never verified; stale or missing entitlement is unverified with a reason", async () => {
  for (const claude of [ENTITLEMENT.UNVERIFIED, null]) {
    const h = await harness({ claude });
    const setup = await h.ops.setup();
    const c = provider(setup, "claude");
    assert.equal(c.installed, true);
    assert.equal(c.accessVerified, "unverified");
    assert.ok(typeof c.accessReason === "string" && c.accessReason.length > 0);
    assert.equal(c.eligible, true, "eligibility is reported independently of access");
    assert.equal(provider(setup, "cursor").installed, false);
  }
});

test("setup read: verified, denied, exhausted and unknown access are distinct", async () => {
  const ok = await harness({ claude: ENTITLEMENT.ALLOWED });
  assert.equal(provider(await ok.ops.setup(), "claude").accessVerified, "verified");
  assert.equal(provider(await ok.ops.setup(), "codex").accessVerified, "unknown");
  const denied = await harness({ claude: ENTITLEMENT.DENIED });
  assert.equal(provider(await denied.ops.setup(), "claude").accessVerified, "denied");
  const exhausted = await harness({ cursorAccess: { cursor_models: { status: "exhausted", reason: "monthly limit" } } });
  assert.equal(provider(await exhausted.ops.setup(), "cursor").accessVerified, "exhausted");
});

test("setup read: detection selects no team, starts nothing, writes nothing; repeated reads are identical", async () => {
  const h = await harness({ claude: ENTITLEMENT.UNVERIFIED });
  const first = await h.ops.setup();
  const second = await h.ops.setup();
  assert.deepEqual(first, second);
  assert.equal(first.strategyStatus, "none");
  assert.equal(first.initialAnalyzer, null);
  assert.equal(first.permanentOrchestrator, null);
  assert.deepEqual(h.counts, { startRun: 0, strategyWrites: 0, analyze: 0, recoveryWrites: 0, resolveRoot: h.counts.resolveRoot });
  assert.ok(h.counts.resolveRoot.every((cwd) => cwd === h.root), "every action carries the explicit project");
});

test("setup read: unverified Claude is listed but never runnable or recommended; the output carries no absolute paths", async () => {
  const h = await harness({ claude: ENTITLEMENT.UNVERIFIED });
  const setup = await h.ops.setup();
  assert.deepEqual(setup.analyzers.map((a) => a.candidateKey).sort(), ["claude::claude-model", "codex::codex-model"]);
  const claudeRow = setup.analyzers.find((a) => a.candidateKey === "claude::claude-model");
  assert.equal(claudeRow.available, false, "unverified access is selectable in the catalog but not runnable");
  assert.equal(claudeRow.accessVerified, "unverified");
  assert.equal(claudeRow.recommended, false);
  assert.equal(JSON.stringify(setup).includes(h.root), false);
  assert.equal(JSON.stringify(setup).includes(h.home), false);
});

test("plan: access-missing analyzer is refused with a typed reason, no confirmation target, zero analyzer calls", async () => {
  const h = await harness({ claude: ENTITLEMENT.UNVERIFIED });
  const plan = await h.ops.planSetup({ action: "run_analysis", analyzerKey: "claude::claude-model" });
  assert.equal(plan.decision, "REFUSED");
  assert.equal(plan.reasonCode, "access_unverified");
  assert.equal(plan.confirmationTarget, null);
  assert.equal(plan.confirmationRequired, false);
  const forged = { action: "run_analysis", subject: "claude::claude-model", candidateKey: null, stateFingerprint: "x" };
  assert.equal(await code(h.ops.runAnalysis({ confirmationTarget: forged })), "access_unverified");
  assert.equal(h.counts.analyze, 0);
  assert.equal(h.counts.strategyWrites, 0);
});

test("plan: unavailable or unknown analyzer is refused, never substituted", async () => {
  const h = await harness({ codexOk: false });
  const plan = await h.ops.planSetup({ action: "run_analysis", analyzerKey: "codex::codex-model" });
  assert.equal(plan.reasonCode, "analyzer_unavailable");
  const unknown = await h.ops.planSetup({ action: "run_analysis", analyzerKey: "claude::nope" });
  assert.equal(unknown.reasonCode, "analyzer_unavailable");
  const missing = await h.ops.planSetup({ action: "run_analysis" });
  assert.equal(missing.reasonCode, "analyzer_required");
  const forged = { action: "run_analysis", subject: "codex::codex-model", candidateKey: null, stateFingerprint: "x" };
  assert.equal(await code(h.ops.runAnalysis({ confirmationTarget: forged })), "analyzer_unavailable");
  assert.equal(h.counts.analyze, 0, "no provider was called, no other model substituted");
  assert.deepEqual(h.analyzed, []);
});

test("analysis: preview marks spend, missing or stale confirmation is refused with zero launches", async () => {
  const h = await harness();
  const plan = await h.ops.planSetup({ action: "run_analysis", analyzerKey: "codex::codex-model" });
  assert.equal(plan.decision, "READY");
  assert.equal(plan.spend, true);
  assert.equal(plan.generative, true);
  assert.match(plan.why, /generative/i);
  assert.equal(plan.confirmationRequired, true);
  assert.equal(h.counts.analyze, 0, "preview never calls the provider");
  assert.equal(await code(h.ops.runAnalysis({})), "confirmation_required");
  assert.equal(await code(h.ops.runAnalysis({ confirmationTarget: { bad: true } })), "confirmation_required");
  const stale = { ...plan.confirmationTarget, stateFingerprint: "stale" };
  assert.equal(await code(h.ops.runAnalysis({ confirmationTarget: stale })), "confirmation_stale");
  const wrongAction = { ...plan.confirmationTarget, action: "approve_team" };
  assert.equal(await code(h.ops.runAnalysis({ confirmationTarget: wrongAction })), "confirmation_stale");
  assert.equal(h.counts.analyze, 0);
  assert.equal(h.counts.strategyWrites, 0);
  assert.equal(h.counts.startRun, 0);
});

test("analysis: confirmed run calls the chosen analyzer exactly once and yields a draft team", async () => {
  const h = await harness();
  const plan = await h.ops.planSetup({ action: "run_analysis", analyzerKey: "codex::codex-model" });
  const result = await h.ops.runAnalysis({ confirmationTarget: plan.confirmationTarget });
  assert.deepEqual(h.analyzed, ["codex::codex-model"]);
  assert.equal(h.counts.analyze, 1);
  assert.equal(h.counts.startRun, 0);
  assert.equal(result.action, "run_analysis");
  assert.equal(result.strategyStatus, "draft");
  assert.equal(h.store.strategy.status, "suggested");
});

test("analyzer and permanent orchestrator are labelled distinctly once a strategy exists", async () => {
  const h = await draftTeam(await harness());
  const setup = await h.ops.setup();
  assert.equal(setup.strategyStatus, "draft");
  assert.equal(setup.initialAnalyzer.role, "initial_analyzer");
  assert.equal(setup.initialAnalyzer.provider, "codex");
  assert.equal(setup.permanentOrchestrator.role, "permanent_orchestrator");
  assert.equal(setup.permanentOrchestrator.provider, h.store.strategy.orchestrator.adapterId);
  assert.notEqual(setup.initialAnalyzer.role, setup.permanentOrchestrator.role);
  assert.equal(setup.analyzers.find((a) => a.candidateKey === "codex::codex-model").selected, true);
  assert.equal(setup.editable, true);
  assert.ok(setup.team.some((r) => r.role === "Architect"));
});

test("analysis refused while a team is active (would replace it); allowed again from draft", async () => {
  const h = await draftTeam(await harness());
  const approve = await h.ops.planSetup({ action: "approve_team" });
  await h.ops.approveTeam({ confirmationTarget: approve.confirmationTarget });
  const plan = await h.ops.planSetup({ action: "run_analysis", analyzerKey: "codex::codex-model" });
  assert.equal(plan.reasonCode, "strategy_active");
  assert.equal(h.counts.analyze, 1);
});

test("set assignment: previewed, confirmed, states old and new, only while draft", async () => {
  const h = await draftTeam(await harness());
  const before = h.store.strategy.projectTeam.find((r) => r.role === "Architect").model;
  const target = before.adapterId === "codex" ? "claude::claude-model" : "codex::codex-model";
  const plan = await h.ops.planSetup({ action: "set_assignment", role: "Architect", candidateKey: target });
  assert.equal(plan.decision, "READY");
  assert.equal(plan.change.from.candidateKey ?? `${plan.change.from.provider}::${plan.change.from.modelId}`, `${before.adapterId}::${before.modelId}`);
  assert.equal(plan.change.to.candidateKey, target);
  assert.equal(h.counts.strategyWrites, 1, "preview writes nothing");
  const done = await h.ops.setAssignment({ confirmationTarget: plan.confirmationTarget });
  assert.equal(done.change.from.provider, before.adapterId);
  assert.equal(done.change.to.candidateKey, target);
  assert.equal(h.store.strategy.projectTeam.find((r) => r.role === "Architect").model.candidateKey, target);
  assert.equal(h.store.strategy.status, "suggested");
  assert.equal(h.counts.strategyWrites, 2);
});

test("set assignment: stale or missing confirmation changes nothing", async () => {
  const h = await draftTeam(await harness());
  const writes = h.counts.strategyWrites;
  const plan = await h.ops.planSetup({ action: "set_assignment", role: "Architect", candidateKey: "claude::claude-model" });
  assert.equal(await code(h.ops.setAssignment({})), "confirmation_required");
  assert.equal(await code(h.ops.setAssignment({ confirmationTarget: { ...plan.confirmationTarget, stateFingerprint: "old" } })), "confirmation_stale");
  assert.equal(h.counts.strategyWrites, writes);
});

test("set assignment: access-missing candidate, unknown role and unknown candidate are typed refusals", async () => {
  const h = await draftTeam(await harness({ claude: ENTITLEMENT.UNVERIFIED }));
  const writes = h.counts.strategyWrites;
  const claude = await h.ops.planSetup({ action: "set_assignment", role: "Architect", candidateKey: "claude::claude-model" });
  assert.equal(claude.reasonCode, "access_unverified");
  assert.equal(claude.confirmationTarget, null);
  assert.equal((await h.ops.planSetup({ action: "set_assignment", role: "Nope", candidateKey: "codex::codex-model" })).reasonCode, "role_unknown");
  assert.equal((await h.ops.planSetup({ action: "set_assignment", role: "Architect", candidateKey: "codex::ghost" })).reasonCode, "candidate_unavailable");
  const forged = { action: "set_assignment", subject: "Architect", candidateKey: "claude::claude-model", stateFingerprint: "x" };
  assert.equal(await code(h.ops.setAssignment({ confirmationTarget: forged })), "access_unverified");
  assert.equal(h.counts.strategyWrites, writes);
});

test("set assignment is refused when the team is active; nothing changes", async () => {
  const h = await draftTeam(await harness());
  const planAssign = await h.ops.planSetup({ action: "set_assignment", role: "Architect", candidateKey: "claude::claude-model" });
  const approve = await h.ops.planSetup({ action: "approve_team" });
  assert.equal(approve.decision, "READY");
  const approved = await h.ops.approveTeam({ confirmationTarget: approve.confirmationTarget });
  assert.equal(approved.strategyStatus, "active");
  assert.equal(h.store.strategy.status, "active");
  const writes = h.counts.strategyWrites;
  const plan = await h.ops.planSetup({ action: "set_assignment", role: "Architect", candidateKey: "claude::claude-model" });
  assert.equal(plan.reasonCode, "strategy_not_draft");
  assert.equal(await code(h.ops.setAssignment({ confirmationTarget: planAssign.confirmationTarget })), "strategy_not_draft");
  assert.equal(h.counts.strategyWrites, writes);
  assert.equal((await h.ops.planSetup({ action: "approve_team" })).reasonCode, "strategy_not_draft");
});

test("approve: confirmation required and stale-checked; no strategy is a typed refusal; zero launches", async () => {
  const none = await harness();
  assert.equal((await none.ops.planSetup({ action: "approve_team" })).reasonCode, "no_strategy");
  const h = await draftTeam(await harness());
  const plan = await h.ops.planSetup({ action: "approve_team" });
  assert.equal(await code(h.ops.approveTeam({})), "confirmation_required");
  assert.equal(await code(h.ops.approveTeam({ confirmationTarget: { ...plan.confirmationTarget, stateFingerprint: "x" } })), "confirmation_stale");
  assert.equal(h.store.strategy.status, "suggested");
  assert.equal(h.counts.startRun, 0);
});

test("setup read shows a pending recovery proposal without acting on it", async () => {
  const h = await harness({ recovery: { fingerprint: "f", outcome: "proposed", proposal: { status: "suggested" } } });
  const setup = await h.ops.setup();
  assert.equal(setup.recovery.pending, true);
  assert.equal(h.counts.recoveryWrites, 0);
  assert.equal((await (await harness()).ops.setup()).recovery.pending, false);
});

test("ambiguous or unknown session refs are refused for every setup operation, before any effect", async () => {
  const h = await draftTeam(await harness());
  h.service.resolveSession = async ({ ref }) => {
    throw Object.assign(new Error("x"), { code: ref === "dup" ? "SESSION_REF_AMBIGUOUS" : "SESSION_REF_UNKNOWN" });
  };
  const writes = h.counts.strategyWrites;
  const target = { action: "approve_team", subject: null, candidateKey: null, stateFingerprint: "x" };
  assert.equal(await code(h.ops.setup({ ref: "dup" })), "session_ref_ambiguous");
  assert.equal(await code(h.ops.planSetup({ action: "approve_team", ref: "zz" })), "session_ref_unknown");
  assert.equal(await code(h.ops.approveTeam({ confirmationTarget: target, ref: "dup" })), "session_ref_ambiguous");
  assert.equal(await code(h.ops.runAnalysis({ confirmationTarget: { ...target, action: "run_analysis" }, ref: "zz" })), "session_ref_unknown");
  assert.equal(await code(h.ops.setAssignment({ confirmationTarget: { ...target, action: "set_assignment" }, ref: "zz" })), "session_ref_unknown");
  assert.equal(h.counts.strategyWrites, writes);
});

test("approve: a confirmation goes stale when a new access warning appears after the preview", async () => {
  const h = await draftTeam(await harness());
  const plan = await h.ops.planSetup({ action: "approve_team" });
  assert.deepEqual(plan.warnings, []);
  h.modelIntelligence.claudeEntitlement["claude-model"] = { status: ENTITLEMENT.DENIED, reason: "plan changed" };
  const fresh = await h.ops.planSetup({ action: "approve_team" });
  assert.deepEqual(fresh.warnings, ["Architect: access denied"]);
  assert.notEqual(fresh.confirmationTarget.stateFingerprint, plan.confirmationTarget.stateFingerprint);
  assert.equal(await code(h.ops.approveTeam({ confirmationTarget: plan.confirmationTarget })), "confirmation_stale");
  assert.equal(h.store.strategy.status, "suggested", "nothing was approved on the stale confirmation");
  // The user who has now seen the warning can still confirm it explicitly.
  const approved = await h.ops.approveTeam({ confirmationTarget: fresh.confirmationTarget });
  assert.equal(approved.action, "approve_team");
});

test("approve: an unchanged warning set keeps the same confirmation target", async () => {
  const h = await draftTeam(await harness());
  const a = await h.ops.planSetup({ action: "approve_team" });
  const b = await h.ops.planSetup({ action: "approve_team" });
  assert.deepEqual(a.confirmationTarget, b.confirmationTarget);
});
