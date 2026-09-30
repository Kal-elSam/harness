// Read-only explanation of how the analyst picker ranks a catalog.
//
// Runs the REAL pipeline (scoreAvailableModels -> candidate catalog/pools ->
// computeBootstrapAnalystCatalog -> curateAnalystCatalogForPicker) over a
// caller-supplied provider catalog and AA snapshot, then reports per
// candidate: identity, benchmark evidence, where it was excluded (if at all)
// and its final position. It invents nothing: every number comes from the AA
// rows handed in, and an absent value stays null.

import { scoreAvailableModels } from "../intelligence/model-intelligence.js";
import { buildCompleteCandidateCatalog, buildScoredCandidatePools } from "../intelligence/model-candidate-catalog.js";
import { ENTITLEMENT } from "../observability/claude-model-entitlement.js";
import { createCapabilityRegistry } from "../intelligence/model-capability-registry.js";
import { computeBootstrapAnalystCatalog } from "./project-strategy.js";
import { curateAnalystCatalogForPicker } from "../host/project-team-sidecar.js";

/**
 * Controlled catalog mirroring real shapes: ids as the providers expose them
 * (Claude documented ids, Cursor re-exposures with effort suffixes, the same
 * model through several subscriptions, OpenCode Go ids). Access is stated,
 * never probed.
 */
export const CONTROLLED_TRACE_CATALOG = Object.freeze({
  providerCatalogs: [
    { adapterId: "codex", models: [{ id: "gpt-5-6-sol" }, { id: "gpt-5-6-terra" }, { id: "gpt-5-5" }] },
    { adapterId: "claude", models: [{ id: "claude-opus-5" }, { id: "claude-sonnet-5" }, { id: "claude-opus-4-8" }, { id: "claude-fable-5-1" }] },
    { adapterId: "cursor", models: [
      { id: "claude-opus-5-thinking-high", displayName: "Claude Opus 5 Thinking High" },
      { id: "claude-sonnet-5-thinking-high", displayName: "Claude Sonnet 5 Thinking High" },
      { id: "gpt-5-6-sol-high", displayName: "GPT-5.6 Sol High" },
      { id: "gpt-5-6-sol", displayName: "GPT-5.6 Sol" }
    ] },
    { adapterId: "opencode-go", models: [{ id: "kimi-k3" }, { id: "glm-5-3" }, { id: "deepseek-v4-pro" }] }
  ],
  modelEntitlement: {
    claude: {
      "claude-opus-5": { status: "allowed", reason: null },
      "claude-sonnet-5": { status: "allowed", reason: null },
      "claude-opus-4-8": { status: "allowed", reason: null },
      "claude-fable-5-1": { status: "denied", reason: "requires usage credits" }
    },
    cursor: Object.fromEntries([
      "claude-opus-5-thinking-high", "claude-sonnet-5-thinking-high", "gpt-5-6-sol-high", "gpt-5-6-sol"
    ].map((id) => [id, { status: "allowed", reason: null }]))
  }
});

const BENCHMARK_FIELDS = ["intelligenceIndex", "codingIndex", "gpqa", "hle", "mmluPro", "sciCode", "liveCodeBench"];

/**
 * @param {object} input
 * @param {Array<{adapterId: string, models: Array<{id: string, displayName?: string}>}>} input.providerCatalogs
 * @param {Array<object>} input.aaModels - Artificial Analysis rows (real snapshot or a labelled fixture)
 * @param {Record<string, {ok: boolean}>} [input.eligibility] - per adapter; default every adapter ok
 * @param {Record<string, Record<string, {status: string, reason?: string|null}>>} [input.modelEntitlement] - adapterId -> modelId -> status
 * @returns {{rows: object[], curated: object}}
 */
export function traceAnalystRanking({ providerCatalogs, aaModels, eligibility = null, modelEntitlement = {} }) {
  const effectiveEligibility = eligibility ?? Object.fromEntries(providerCatalogs.map(({ adapterId }) => [adapterId, { ok: true }]));
  const scoredAllRaw = scoreAvailableModels(providerCatalogs, aaModels);
  const complete = buildCompleteCandidateCatalog(providerCatalogs, aaModels, { modelEntitlement });
  const { recommendationPool, manualSelectionPool } = buildScoredCandidatePools(scoredAllRaw, complete);
  const analystUnscored = complete
    .filter((candidate) => (
      candidate.evidenceStatus === "unscored" && candidate.lifecycle !== "superseded" && candidate.entitlement !== ENTITLEMENT.DENIED
    ))
    .map((candidate) => ({
      adapterId: candidate.adapterId, modelId: candidate.modelId, displayName: candidate.rawDisplayName,
      candidateKey: candidate.candidateKey, accessMode: candidate.accessMode, lifecycle: candidate.lifecycle,
      entitlement: candidate.entitlement, entitlementReason: candidate.entitlementReason
    }));
  const catalog = computeBootstrapAnalystCatalog({
    scoredAll: recommendationPool, manualSelectionScoredPool: manualSelectionPool, eligibility: effectiveEligibility,
    registry: createCapabilityRegistry(), providerCapacity: null, unscoredModels: analystUnscored
  });
  const curated = curateAnalystCatalogForPicker(catalog);

  const scoredByKey = new Map(scoredAllRaw.map((row) => [`${row.adapterId}::${row.modelId}`, row]));
  const catalogByKey = new Map(catalog.models.map((row) => [row.candidateKey, row]));
  const exclusionByKey = new Map(catalog.exclusions.map((row) => [row.candidateKey, row]));
  const curatedOrder = [
    ...curated.models.map((row, index) => ({ row, listing: "main", position: index + 1 })),
    ...curated.alternatives.map((row, index) => ({ row, listing: "manual", position: index + 1 }))
  ];
  const positionByKey = new Map(curatedOrder.map((entry) => [entry.row.candidateKey, entry]));

  const rows = complete.map((identity) => {
    const scored = scoredByKey.get(identity.candidateKey) ?? null;
    const catalogRow = catalogByKey.get(identity.candidateKey) ?? null;
    const exclusion = exclusionByKey.get(identity.candidateKey) ?? null;
    const placed = positionByKey.get(identity.candidateKey) ?? null;
    let stage = "main";
    let reason = null;
    if (identity.lifecycle === "superseded") { stage = "excluded"; reason = "superseded by a newer generation in the same lineage"; }
    else if (identity.entitlement === ENTITLEMENT.DENIED) { stage = "excluded"; reason = "access denied (verified)"; }
    else if (!catalogRow) { stage = "excluded"; reason = exclusion ? `excluded: ${exclusion.cause}` : "not in the ask-supported catalog"; }
    else if (!placed) { stage = "not_listed"; reason = catalogRow.accessVerified === false ? "access unverified" : catalogRow.cause ?? "not available now"; }
    else stage = placed.listing;
    return {
      candidateKey: identity.candidateKey,
      adapterId: identity.adapterId,
      modelId: identity.modelId,
      identity: { modelName: identity.modelName, lineageKey: identity.lineageKey, generation: identity.generation, lifecycle: identity.lifecycle },
      evidenceStatus: identity.evidenceStatus,
      aaSlug: scored?.slug ?? null,
      benchmarks: Object.fromEntries(BENCHMARK_FIELDS.map((field) => [field, scored?.[field] ?? null])),
      entitlement: identity.entitlement,
      catalog: catalogRow ? {
        available: catalogRow.available, accessVerified: catalogRow.accessVerified, cause: catalogRow.cause,
        rank: catalogRow.rank ?? null, qualification: catalogRow.qualification ?? null,
        identityKey: catalogRow.identityKey ?? null, evaluation: catalogRow.evaluation ?? null,
        tags: catalogRow.recommendationTags
      } : null,
      stage,
      position: placed?.position ?? null,
      starred: curated.recommendedModel?.candidateKey === identity.candidateKey,
      reason
    };
  });
  return { rows, curated };
}

function cell(value) {
  if (value == null) return "-";
  return typeof value === "number" ? String(Math.round(value * 1000) / 1000) : String(value);
}

/** Plain-text table for the trace (docs and the CLI script). */
export function formatAnalystTrace({ rows }) {
  const order = { main: 0, manual: 1, not_listed: 2, excluded: 3 };
  const sorted = [...rows].sort((a, b) => order[a.stage] - order[b.stage] || (a.position ?? 99) - (b.position ?? 99) || a.candidateKey.localeCompare(b.candidateKey));
  const lines = ["stage      pos star catalogRank candidateKey                          identity                 qualification         reason/coding(pool pct) confidence  evidence(gpqa/hle/sci/int/cod)  note"];
  for (const row of sorted) {
    const b = row.benchmarks;
    const evaluation = row.catalog?.evaluation;
    lines.push([
      row.stage.padEnd(10), cell(row.position).padEnd(3), (row.starred ? "*" : " ").padEnd(4),
      cell(row.catalog?.rank).padEnd(11), row.candidateKey.padEnd(37),
      cell(row.catalog?.identityKey).padEnd(24), cell(row.catalog?.qualification).padEnd(21),
      `${cell(evaluation?.capabilities?.reasoning)}/${cell(evaluation?.capabilities?.coding)}`.padEnd(23),
      cell(evaluation?.confidence).padEnd(11),
      `${cell(b.gpqa)}/${cell(b.hle)}/${cell(b.sciCode)}/${cell(b.intelligenceIndex)}/${cell(b.codingIndex)}`.padEnd(31),
      row.reason ?? (row.evidenceStatus === "unscored" ? "unscored (no AA match)" : "")
    ].join(" "));
  }
  return lines.join("\n");
}
