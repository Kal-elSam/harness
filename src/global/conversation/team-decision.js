/**
 * Pure, UI-free "why this assignment" text — shared by the cockpit overlay
 * and the workspace snapshot / Project proposal table. Never invents
 * metrics; existing `reason` always wins.
 */

/** Plain-language description of what each role optimizes for — mirrors
 * buildAiTeamRoleDefinitions()'s real compute functions in
 * model-intelligence.js, never a per-model claim. */
export const ROLE_CAPABILITY_BLURB = {
  Explorer: "general reasoning capability",
  Architect: "general reasoning capability",
  Builder: "coding capability",
  Debugger: "reasoning and terminal-debugging capability",
  Tester: "coding and terminal-execution capability",
  Reviewer: "independent reasoning and coding review"
};

const OVERRIDE_DECISION_TEXT = "Manual override — not the automatic ranking's own pick.";

const PROVIDER_LABEL = Object.freeze({
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  "opencode-go": "OpenCode Go",
  "opencode-zen": "OpenCode Zen",
  opencode: "OpenCode",
  pi: "Pi"
});

const BLOCK_CAUSE_ES = Object.freeze({
  model_cap: "límite de concentración del modelo",
  provider_cap: "límite técnico del proveedor",
  reviewer_independence: "independencia Builder/Reviewer"
});

const CURSOR_POOL_LABEL = Object.freeze({
  cursor_models: "Cursor models",
  other_models: "Other models"
});

/**
 * Compact "Descartados" lines for one role from selection.evaluated —
 * only peers blocked by a concentration cause. Never invents quota/billing.
 * @param {{evaluated?: Array<{adapterId?: string, modelId?: string, blockedBy?: string|null}>}|null|undefined} selection
 * @returns {string[]}
 */
export function formatDiscardedAlternatives(selection) {
  const evaluated = Array.isArray(selection?.evaluated) ? selection.evaluated : [];
  const lines = [];
  const seen = new Set();
  for (const row of evaluated) {
    if (!row?.blockedBy) continue;
    const cause = BLOCK_CAUSE_ES[row.blockedBy] ?? row.blockedBy;
    const provider = PROVIDER_LABEL[row.adapterId] ?? String(row.adapterId ?? "provider");
    const model = row.modelId ?? "modelo";
    const line = `${provider} · ${model} — ${cause}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

/**
 * Provider-level exclusions from snapshot eligibility / Cursor pool access —
 * why automatic routing never offered Claude/Go/Cursor (cuota, rate-limit,
 * unverified). Uses real `{ok, reason}` and cursorAccess statuses only.
 * @param {{eligibility?: Record<string, {ok?: boolean, reason?: string|null}>, cursorAccess?: Record<string, {status?: string, reason?: string|null}>}|null|undefined} intelligence
 * @returns {string[]}
 */
export function formatEligibilityExclusions(intelligence) {
  const eligibility = intelligence?.eligibility && typeof intelligence.eligibility === "object"
    ? intelligence.eligibility
    : {};
  const cursorAccess = intelligence?.cursorAccess && typeof intelligence.cursorAccess === "object"
    ? intelligence.cursorAccess
    : {};
  const lines = [];
  const seen = new Set();
  const push = (line) => {
    if (!line || seen.has(line)) return;
    seen.add(line);
    lines.push(line);
  };
  for (const [adapterId, check] of Object.entries(eligibility)) {
    if (check?.ok !== false) continue;
    const provider = PROVIDER_LABEL[adapterId] ?? String(adapterId);
    push(`${provider} — ${check.reason ?? "not eligible"}`);
  }
  for (const [pool, access] of Object.entries(cursorAccess)) {
    const status = access?.status;
    if (status === "available") continue;
    const poolLabel = CURSOR_POOL_LABEL[pool] ?? pool;
    if (status === "exhausted") {
      push(`Cursor · ${poolLabel} — límite alcanzado${access?.reason ? ` (${access.reason})` : ""}`);
      continue;
    }
    // unverified / missing / anything else fail-closed as sin verificar
    push(`Cursor · ${poolLabel} — sin verificar${access?.reason ? ` (${access.reason})` : ""}`);
  }
  return lines;
}

/**
 * Full Descartados list for a role: concentration peers + eligibility exclusions.
 * @param {object|null|undefined} selection
 * @param {object|null|undefined} intelligence
 * @returns {string[]}
 */
export function formatRoleDiscarded(selection, intelligence) {
  const lines = [];
  const seen = new Set();
  for (const line of [
    ...formatEligibilityExclusions(intelligence),
    ...formatDiscardedAlternatives(selection)
  ]) {
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}

/**
 * Pure, human-readable why for one team assignment — from real
 * `reason` / `decisionEvidence` only, never invented metrics.
 * Existing `entry.reason` always wins; overrides use a single formulation.
 * @param {{role?: string, reason?: string|null, assignmentSource?: string|null, decisionEvidence?: object|null}|null|undefined} entry
 * @returns {string}
 */
export function explainTeamDecision(entry) {
  if (!entry) return `Selected for ${ROLE_CAPABILITY_BLURB.Explorer ?? "this role's capability requirement"}.`;
  if (entry.assignmentSource === "override") return OVERRIDE_DECISION_TEXT;
  if (entry.reason) return entry.reason;

  const blurb = ROLE_CAPABILITY_BLURB[entry.role] ?? "this role's capability requirement";
  const decisionType = entry.decisionEvidence?.decisionType ?? null;
  if (decisionType === "leader") {
    const floor = entry.decisionEvidence?.requiredFloor;
    const risk = entry.decisionEvidence?.riskLevel;
    if (floor != null && risk != null) {
      const floorPct = Math.round(floor * 100);
      return `Ranked first for ${blurb} among eligible candidates — nothing cheaper or faster displaced it at the ${floorPct}% capability floor (${risk}-risk role).`;
    }
    return `Ranked first for ${blurb} among eligible candidates.`;
  }
  return `Selected for ${blurb}.`;
}
