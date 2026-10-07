/**
 * Setup operations for the shared conversation layer (MCP + Pi).
 *
 * - `setup` (read): installed vs access-verified per provider, the analyzer
 *   catalog, the initial analyzer vs the permanent orchestrator, draft/active
 *   strategy semantics and a pending recovery proposal. Detection never
 *   selects a team, probes a provider, writes or launches anything.
 * - `planSetup` (read): preview of one setup mutation with a confirmation
 *   target (or a typed refusal). Selecting the initial analyzer is an explicit
 *   parameter of the analysis preview: the service has no place to persist it
 *   before analysis, so nothing is persisted here.
 * - `runAnalysis` / `approveTeam` / `setAssignment` (confirmed): the target is
 *   re-derived server-side from a fresh preview; missing, malformed or stale
 *   confirmation is refused before any effect. No retries, no silent
 *   provider/model substitution.
 *
 * Every action delegates to the existing conversation service flows.
 */
import { createHash } from "node:crypto";
import * as z from "zod";
import { ENTITLEMENT } from "../observability/claude-model-entitlement.js";
import { CURSOR_ACCESS_STATUS, classifyCursorPool } from "../observability/cursor-entitlement.js";
import { isCursorAutoModel } from "../observability/cursor-models.js";
import { safeText, scalar, ConversationOperationError } from "./operation-core.js";

export const SETUP_ACTIONS = Object.freeze(["run_analysis", "approve_team", "set_assignment"]);

const opaque = z.string().min(1).max(256).nullable();
export const setupConfirmationTargetSchema = z.object({
  action: z.enum(SETUP_ACTIONS),
  subject: opaque,
  candidateKey: opaque,
  stateFingerprint: z.string().min(1).max(256)
});
const parseTarget = (t) => {
  const parsed = setupConfirmationTargetSchema.safeParse(t);
  return parsed.success ? parsed.data : null;
};
const TARGET_KEYS = ["action", "subject", "candidateKey", "stateFingerprint"];
const sameTarget = (a, b) => a != null && b != null && TARGET_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null));

const STRATEGY_STATUS = { suggested: "draft", active: "active", stale: "stale" };
export const strategyStatusOf = (strategy) => (strategy ? STRATEGY_STATUS[strategy.status] ?? "unknown" : "none");

const BLOCKING_ACCESS = new Set(["unverified", "denied", "exhausted"]);
const keyOf = (ref) => ref?.candidateKey ?? (ref?.adapterId ? `${ref.adapterId}::${ref.modelId}` : null);
const pubRef = (ref) => (ref == null ? null : {
  provider: scalar(ref.adapterId ?? null), modelId: scalar(ref.modelId ?? null),
  model: safeText(ref.displayName ?? ref.modelId ?? null), candidateKey: safeText(keyOf(ref))
});

const EMPTY_PLAN = Object.freeze({ pendingCount: 0, reusableCount: 0, mayConsumeQuota: false, subscriptions: [], costStatement: null });
const planOf = (facts) => facts.verificationPlan ?? EMPTY_PLAN;
const subscriptionOf = (facts, adapterId) => planOf(facts).subscriptions.find((sub) => sub.adapterId === adapterId) ?? null;
const PLANNED = "planned, not run; running it needs explicit confirmation and may consume quota";

const verified = (reason) => ({ status: "verified", reason });
const access = (status, reason) => ({ status, reason: safeText(reason) });

/** Access evidence for one model. Installed never implies verified. */
function modelAccess(model, facts) {
  if (model.adapterId === "claude") {
    const known = facts.knownCandidates.find((c) => c.candidateKey === keyOf(model));
    const entry = facts.claudeEntitlement[model.modelId];
    const status = entry?.status ?? known?.entitlement;
    if (status === ENTITLEMENT.ALLOWED) return verified("Claude plan allows this model.");
    if (status === ENTITLEMENT.DENIED) return access("denied", entry?.reason ?? "Claude plan denies this model.");
    const check = subscriptionOf(facts, "claude")?.checks.find((c) => c.id === `claude::${model.modelId}`);
    return access("unverified", check?.state === "pending"
      ? `No fresh entitlement evidence for this model; its access check is pending (${PLANNED}).`
      : "No fresh entitlement evidence for this model.");
  }
  if (model.adapterId === "cursor" && !isCursorAutoModel(model.modelId)) {
    const pool = facts.cursorAccess[classifyCursorPool({ id: model.modelId, displayName: model.displayName })];
    if (pool?.status === CURSOR_ACCESS_STATUS.AVAILABLE) return verified("Cursor access probe succeeded.");
    if (pool?.status === CURSOR_ACCESS_STATUS.EXHAUSTED) return access("exhausted", pool.reason ?? "Cursor limit reached.");
    return access("unverified", pool?.reason ?? "Cursor access could not be verified automatically.");
  }
  return access("unknown", "No access probe exists for this provider; only local eligibility is known.");
}

/** Provider-level access: the best evidence across its known models/pools. */
function providerAccess(adapterId, facts) {
  const noEvidence = (id) => {
    const pending = subscriptionOf(facts, id)?.pendingCount ?? 0;
    return pending > 0 ? `No access evidence yet; ${pending} access check${pending === 1 ? " is" : "s are"} pending (${PLANNED}).` : "No access evidence yet.";
  };
  const pick = (entries, ok, exhausted, denied, reasonOf) => {
    if (entries.some((e) => e?.status === ok)) return verified(`${entries.filter((e) => e?.status === ok).length} of ${entries.length} entries verified.`);
    if (exhausted && entries.some((e) => e?.status === exhausted)) return access("exhausted", reasonOf(entries.find((e) => e?.status === exhausted)) ?? "Limit reached.");
    if (denied && entries.some((e) => e?.status === denied)) return access("denied", reasonOf(entries.find((e) => e?.status === denied)) ?? "Access denied.");
    return access("unverified", entries.length ? (reasonOf(entries[0]) ?? "Access not verified.") : noEvidence(adapterId));
  };
  if (adapterId === "claude") {
    return pick(Object.values(facts.claudeEntitlement), ENTITLEMENT.ALLOWED, null, ENTITLEMENT.DENIED, (e) => e?.reason);
  }
  if (adapterId === "cursor") {
    return pick(Object.values(facts.cursorAccess), CURSOR_ACCESS_STATUS.AVAILABLE, CURSOR_ACCESS_STATUS.EXHAUSTED, null, (e) => e?.reason);
  }
  return access("unknown", "No access probe exists for this provider; only local eligibility is known.");
}

const eligibilityFor = (facts, adapterId) => (
  facts.eligibility[adapterId]
  ?? facts.eligibility[Object.keys(facts.eligibility).find((k) => k.startsWith(`${adapterId}-`))]
  ?? null
);

function pubProvider(adapter, facts) {
  const acc = providerAccess(adapter.id, facts);
  const check = eligibilityFor(facts, adapter.id);
  const eligible = check == null ? null : check.ok === true;
  let blockedReason = null;
  if (adapter.available !== true) blockedReason = adapter.reason ?? `${adapter.label} is not installed.`;
  else if (BLOCKING_ACCESS.has(acc.status)) blockedReason = acc.reason;
  else if (eligible === false) blockedReason = check.reason ?? "Not eligible.";
  return {
    id: scalar(adapter.id ?? null), label: safeText(adapter.label), installed: adapter.available === true,
    launchable: adapter.launchable === true, accessVerified: acc.status, accessReason: acc.reason,
    eligible, blockedReason: safeText(blockedReason)
  };
}

const sameRef = (a, b) => a != null && b != null && keyOf(a) === keyOf(b);

/**
 * Projection of the EXISTING read-only access verification plan (service
 * `verificationPlan`: pending vs reusable checks per subscription). Showing it
 * runs nothing and establishes no access; executing the checks stays a
 * separate, explicitly confirmed flow that may consume quota.
 */
function pubVerification(plan) {
  return {
    pendingCount: Number(plan.pendingCount) || 0, reusableCount: Number(plan.reusableCount) || 0,
    mayConsumeQuota: plan.mayConsumeQuota === true, costStatement: plan.costStatement == null ? null : safeText(plan.costStatement),
    executed: false,
    subscriptions: (plan.subscriptions ?? []).map((sub) => ({
      provider: scalar(sub.adapterId ?? null), label: safeText(sub.provider), granularity: scalar(sub.granularity ?? null),
      pendingCount: Number(sub.pendingCount) || 0, reusableCount: Number(sub.reusableCount) || 0,
      checks: (sub.checks ?? []).map((c) => ({
        id: safeText(c.id), label: safeText(c.label), state: scalar(c.state ?? null),
        reason: scalar(c.reason ?? null), cachedStatus: scalar(c.cachedStatus ?? null)
      }))
    }))
  };
}

/** The public setup projection from raw service facts. */
export function projectSetup(facts) {
  const strategy = facts.strategy ?? null;
  const strategyStatus = strategyStatusOf(strategy);
  const recommendedKey = facts.analystCatalog?.recommendedModel?.candidateKey ?? null;
  const analyzers = (facts.analystCatalog?.models ?? []).map((m) => ({
    candidateKey: safeText(m.candidateKey), provider: scalar(m.adapterId ?? null), modelId: scalar(m.modelId ?? null),
    model: safeText(m.displayName ?? m.modelId), available: m.available === true,
    evidenceStatus: scalar(m.evidenceStatus ?? null), recommended: m.candidateKey === recommendedKey,
    tags: (m.recommendationTags ?? []).map(scalar), accessVerified: modelAccess(m, facts).status,
    selected: strategy?.bootstrapAnalyst != null && sameRef(strategy.bootstrapAnalyst, m)
  }));
  const initialAnalyzer = strategy?.bootstrapAnalyst
    ? { role: "initial_analyzer", ...pubRef(strategy.bootstrapAnalyst), selectionSource: scalar(strategy.bootstrapAnalystSelectionSource ?? null) }
    : null;
  const permanentOrchestrator = strategy?.orchestrator
    ? { role: "permanent_orchestrator", ...pubRef(strategy.orchestrator) }
    : null;
  const team = (strategy?.projectTeam ?? []).map((entry) => ({
    role: safeText(entry.role), ...pubRef(entry.model), assignmentSource: scalar(entry.assignmentSource ?? null),
    accessVerified: entry.model ? modelAccess(entry.model, facts).status : "unknown"
  }));
  const assignmentOptions = Object.fromEntries(Object.entries(facts.editCatalogs ?? {}).map(([role, models]) => [
    role, models.map((m) => ({
      candidateKey: safeText(m.candidateKey), provider: scalar(m.adapterId ?? null), model: safeText(m.displayName ?? m.modelId),
      available: m.available === true, accessVerified: modelAccess(m, facts).status
    }))
  ]));
  return {
    strategyStatus, editable: strategyStatus === "draft",
    accessVerification: pubVerification(planOf(facts)),
    providers: facts.adapters.map((a) => pubProvider(a, facts)),
    analyzers, initialAnalyzer, permanentOrchestrator,
    analyzerIsOrchestrator: initialAnalyzer != null && permanentOrchestrator != null && sameRef(strategy.bootstrapAnalyst, strategy.orchestrator),
    team, assignmentOptions,
    recovery: { pending: facts.recovery?.pending === true, outcome: scalar(facts.recovery?.outcome ?? null) }
  };
}

const fingerprint = (parts) => createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
const refused = (action, reasonCode, why) => ({ action, decision: "REFUSED", reasonCode, why, target: null });
const ACCESS_CODE = { unverified: "access_unverified", denied: "access_denied", exhausted: "access_exhausted" };
const baseState = (strategy) => [strategy?.status ?? null, strategy?.profileFingerprint ?? null, strategy?.approvedAt ?? null];

function planAnalysis(facts, { analyzerKey, profile }) {
  const action = "run_analysis";
  if (!analyzerKey) return refused(action, "analyzer_required", "Choose the initial analyzer explicitly (analyzerKey); none is selected automatically.");
  const strategy = facts.strategy;
  if (strategy?.status === "active") {
    return refused(action, "strategy_active", "An active team exists; a new analysis would replace it. Analysis is only allowed with no team, a draft or a stale one.");
  }
  const entry = (facts.analystCatalog?.models ?? []).find((m) => m.candidateKey === analyzerKey);
  if (!entry) {
    const known = facts.knownCandidates.find((c) => c.candidateKey === analyzerKey);
    const acc = known ? modelAccess(known, facts) : null;
    if (acc && ACCESS_CODE[acc.status]) return refused(action, ACCESS_CODE[acc.status], `The chosen analyzer is not usable: ${acc.reason}`);
    return refused(action, "analyzer_unavailable", "The chosen analyzer is not in the current analyzer catalog; it will not be replaced by another model.");
  }
  if (entry.available !== true && entry.cause === "access_unknown") {
    // Base catalog keeps unverified-access models selectable but not runnable; setup never verifies access itself.
    return refused(action, "access_unverified", "The chosen analyzer's access is not verified; verifying it needs explicit confirmation and may consume quota, so setup will not run it.");
  }
  if (entry.available !== true) {
    return refused(action, "analyzer_unavailable", "The chosen analyzer's provider is not eligible right now; it will not be replaced by another model.");
  }
  const model = { adapterId: entry.adapterId, modelId: entry.modelId, displayName: entry.displayName, candidateKey: entry.candidateKey };
  const state = fingerprint(["analysis", analyzerKey, profile?.fingerprint ?? null, ...baseState(strategy)]);
  return {
    action, decision: "READY", reasonCode: null, spend: true, generative: true,
    why: `GENERATIVE and spends provider usage: runs ${entry.displayName} (${entry.adapterId}) once, read-only, against a sanitized snapshot of this project to propose a draft team. No retries, no fallback model.`,
    change: { initialAnalyzer: pubRef(model) },
    target: { action, subject: analyzerKey, candidateKey: null, stateFingerprint: state },
    run: { model, entry }
  };
}

function planApproval(facts) {
  const action = "approve_team";
  const strategy = facts.strategy;
  if (!strategy) return refused(action, "no_strategy", "There is no team to approve yet; run the analysis first.");
  if (strategy.status !== "suggested") return refused(action, "strategy_not_draft", `Only a draft team can be approved; this one is ${strategyStatusOf(strategy)}.`);
  const roles = (strategy.projectTeam ?? []).map((e) => [e.role, keyOf(e.model), e.assignmentSource ?? null]);
  const warnings = (strategy.projectTeam ?? [])
    .map((e) => ({ role: e.role, acc: e.model ? modelAccess(e.model, facts) : null }))
    .filter((r) => r.acc && BLOCKING_ACCESS.has(r.acc.status))
    .map((r) => `${r.role}: access ${r.acc.status}`);
  return {
    action, decision: "READY", reasonCode: null, spend: false, generative: false,
    why: "Approving makes this draft team the active team that governs Kairo executions; it launches nothing and changes no assignment.",
    warnings: warnings.map(safeText),
    target: { action, subject: null, candidateKey: null, stateFingerprint: fingerprint(["approve", roles, ...baseState(strategy)]) }
  };
}

function planAssignment(facts, { role, candidateKey }) {
  const action = "set_assignment";
  const strategy = facts.strategy;
  if (!strategy) return refused(action, "no_strategy", "There is no team to edit yet; run the analysis first.");
  if (strategy.status !== "suggested") return refused(action, "strategy_not_draft", `Assignments can only change while the team is a draft; this one is ${strategyStatusOf(strategy)}.`);
  const current = (strategy.projectTeam ?? []).find((e) => e.role === role);
  if (!current) return refused(action, "role_unknown", "That role is not part of this project's team.");
  if (!candidateKey) return refused(action, "candidate_unavailable", "Choose the new assignment explicitly (candidateKey).");
  const option = (facts.editCatalogs?.[role] ?? []).find((m) => m.candidateKey === candidateKey);
  if (!option) {
    const known = facts.knownCandidates.find((c) => c.candidateKey === candidateKey);
    const acc = known ? modelAccess(known, facts) : null;
    if (acc && ACCESS_CODE[acc.status]) return refused(action, ACCESS_CODE[acc.status], `The candidate is not usable: ${acc.reason}`);
    return refused(action, "candidate_unavailable", "That candidate is not a current option for this role; nothing was changed.");
  }
  const to = { adapterId: option.adapterId, modelId: option.modelId, displayName: option.displayName, candidateKey: option.candidateKey };
  const state = fingerprint(["assign", role, keyOf(current.model), current.assignmentSource ?? null, candidateKey, ...baseState(strategy)]);
  return {
    action, decision: "READY", reasonCode: null, spend: false, generative: false,
    why: "Changes this role's assignment in the draft team only; nothing is launched and no other role changes.",
    warnings: option.available === true ? [] : [safeText(`${option.displayName} is not eligible right now.`)],
    change: { role: safeText(role), from: { ...pubRef(current.model), source: scalar(current.assignmentSource ?? null) }, to: pubRef(to) },
    target: { action, subject: role, candidateKey, stateFingerprint: state }
  };
}

const pubTargetOut = (t) => (t == null ? null : {
  action: scalar(t.action), subject: safeText(t.subject), candidateKey: safeText(t.candidateKey), stateFingerprint: scalar(t.stateFingerprint)
});
const pubSetupPreview = (p) => ({
  action: p.action, decision: p.decision, reasonCode: p.reasonCode ?? null, why: safeText(p.why),
  spend: p.spend === true, generative: p.generative === true, warnings: p.warnings ?? [],
  change: p.change ?? null, confirmationTarget: pubTargetOut(p.target), confirmationRequired: p.target != null
});

const pubStrategy = (strategy) => ({
  strategyStatus: strategyStatusOf(strategy),
  initialAnalyzer: strategy?.bootstrapAnalyst ? { role: "initial_analyzer", ...pubRef(strategy.bootstrapAnalyst) } : null,
  permanentOrchestrator: strategy?.orchestrator ? { role: "permanent_orchestrator", ...pubRef(strategy.orchestrator) } : null,
  team: (strategy?.projectTeam ?? []).map((e) => ({ role: safeText(e.role), ...pubRef(e.model), assignmentSource: scalar(e.assignmentSource ?? null) }))
});

/**
 * @param {{cwd: string, run: Function, sessionIdFor: Function}} args
 */
export function createSetupOperations({ cwd, run, sessionIdFor }) {
  const fail = (code) => new ConversationOperationError(code);
  // Fresh server-side preview: the only source of truth for what may happen.
  const preview = async (service, { action, analyzerKey = null, role = null, candidateKey = null }, sessionId) => {
    const facts = await service.readSetup({ cwd, sessionId });
    if (action === "run_analysis") {
      const pre = await service.preflightProject({ cwd });
      const plan = planAnalysis(facts, { analyzerKey, profile: pre.profile });
      return plan.decision === "READY" ? { ...plan, run: { ...plan.run, pre } } : plan;
    }
    if (action === "approve_team") return planApproval(facts);
    if (action === "set_assignment") return planAssignment(facts, { role, candidateKey });
    throw fail("setup_action_invalid");
  };
  const confirmed = (action, fallback, apply) => ({ confirmationTarget, ref } = {}) => run(fallback, async (service) => {
    const target = parseTarget(confirmationTarget);
    if (!target) throw fail("confirmation_required");
    const sessionId = await sessionIdFor(service, ref);
    if (target.action !== action) throw fail("confirmation_stale");
    const fresh = await preview(service, {
      action, analyzerKey: action === "run_analysis" ? target.subject : null,
      role: action === "set_assignment" ? target.subject : null, candidateKey: target.candidateKey
    }, sessionId);
    if (fresh.decision !== "READY") throw fail(fresh.reasonCode);
    if (!sameTarget(target, fresh.target)) throw fail("confirmation_stale");
    return apply(service, fresh);
  });
  return {
    setup: ({ ref } = {}) => run("read_failed", async (service) => (
      projectSetup(await service.readSetup({ cwd, sessionId: await sessionIdFor(service, ref) }))
    )),
    planSetup: ({ action, analyzerKey, role, candidateKey, ref } = {}) => run("setup_failed", async (service) => {
      const sessionId = await sessionIdFor(service, ref);
      return pubSetupPreview(await preview(service, { action, analyzerKey: analyzerKey ?? null, role: role ?? null, candidateKey: candidateKey ?? null }, sessionId));
    }),
    runAnalysis: confirmed("run_analysis", "analysis_failed", async (service, plan) => {
      const { model, entry, pre } = plan.run;
      const recommended = pre.analystCatalog?.recommendedModel?.candidateKey ?? null;
      const tags = entry.recommendationTags ?? [];
      const strategy = await service.runBootstrapAnalysis({
        cwd, profile: pre.profile, candidates: pre.candidates,
        analyst: {
          model: { adapterId: model.adapterId, modelId: model.modelId, displayName: model.displayName },
          selectionSource: model.candidateKey === recommended ? "recommended" : "manual",
          recommendationTags: tags,
          choice: tags.includes("quality") ? "quality" : tags.includes("efficient") ? "efficient" : null
        }
      });
      return { action: "run_analysis", ...pubStrategy(strategy) };
    }),
    approveTeam: confirmed("approve_team", "approval_failed", async (service) => (
      { action: "approve_team", ...pubStrategy(await service.approveProjectStrategy({ cwd })) }
    )),
    setAssignment: confirmed("set_assignment", "assignment_failed", async (service, plan) => {
      const updated = await service.setProjectTeamAssignment({ cwd, role: plan.target.subject, candidateKey: plan.target.candidateKey });
      return { action: "set_assignment", change: plan.change, ...pubStrategy(updated) };
    })
  };
}
