// E4 — owned-evidence competition helpers. Synthetic evidence never enables
// production selection unless explicitly allowed (tests only).

import { isProductionEnablingEvidence, normalizeAccountKey } from "./role-aptitude-evidence.js";
import { listRoleAptitudeProbes } from "./role-aptitude-probes.js";

/**
 * @param {string} role
 * @returns {import("./role-aptitude-probes.js").RoleAptitudeProbe|null}
 */
export function currentProbeForRole(role) {
  return listRoleAptitudeProbes().find((probe) => probe.role === role) ?? null;
}

/**
 * @param {{
 *   models: object[],
 *   eligibility: Record<string, {ok?: boolean}>,
 *   store: object,
 *   role: string,
 *   accountKey?: string|null,
 *   allowSynthetic?: boolean
 * }} args
 * @returns {{ path: "owned"|"public", probe: object|null, competitors: Array<{model: object, evidence: object}> }}
 */
export function collectOwnedEvidenceCompetitors({
  models,
  eligibility,
  store,
  role,
  accountKey = "default",
  allowSynthetic = false
}) {
  const probe = currentProbeForRole(role);
  if (!store?.getValidatedVerdict || !probe) {
    return { path: "public", probe: probe ?? null, competitors: [] };
  }
  const account = normalizeAccountKey(accountKey);
  const competitors = [];
  for (const model of models) {
    if (eligibility[model.adapterId]?.ok !== true) continue;
    const key = {
      adapterId: model.adapterId,
      modelId: model.modelId,
      accountKey: account,
      role,
      probeId: probe.probeId,
      probeVersion: probe.probeVersion
    };
    const validated = store.getValidatedVerdict(key);
    if (!isProductionEnablingEvidence(validated, { allowSynthetic })) continue;
    if (
      validated.validatorId != null
      && validated.validatorId !== probe.validatorId
    ) continue;
    if (
      validated.validatorVersion != null
      && validated.validatorVersion !== probe.validatorVersion
    ) continue;
    competitors.push({ model, evidence: validated });
  }
  if (!competitors.length) return { path: "public", probe, competitors: [] };
  return { path: "owned", probe, competitors };
}

/** QUALITY: binary pass is equivalent — stable adapter/model order. */
export function rankOwnedEvidenceQuality(competitors) {
  return [...competitors]
    .sort((a, b) => {
      const left = `${a.model.adapterId}::${a.model.modelId}`;
      const right = `${b.model.adapterId}::${b.model.modelId}`;
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map(({ model, evidence }) => ({
      model,
      value: 1,
      gapValue: null,
      ownedEvidence: evidence
    }));
}

/**
 * EFFICIENT: compare observed cost then duration when both sides have values.
 * Unknown never sorts as zero.
 */
export function rankOwnedEvidenceEfficient(competitors) {
  const ordered = [...competitors].sort((a, b) => {
    const costA = a.evidence.cost;
    const costB = b.evidence.cost;
    if (costA != null && costB != null && costA !== costB) return costA - costB;
    if (costA != null && costB == null) return -1;
    if (costA == null && costB != null) return 1;
    const durA = a.evidence.durationMs;
    const durB = b.evidence.durationMs;
    if (durA != null && durB != null && durA !== durB) return durA - durB;
    if (durA != null && durB == null) return -1;
    if (durA == null && durB != null) return 1;
    const left = `${a.model.adapterId}::${a.model.modelId}`;
    const right = `${b.model.adapterId}::${b.model.modelId}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return ordered.map(({ model, evidence }, index) => ({
    model,
    value: ordered.length - index,
    gapValue: null,
    ownedEvidence: evidence
  }));
}

export function formatOwnedEvidenceReason(evidence, mode = "quality") {
  const base = `Evidencia propia operativa: apto (${evidence.probeId} v${evidence.probeVersion})`;
  if (mode !== "efficient") return base;
  const cost = evidence.cost == null ? "desconocido" : String(evidence.cost);
  const duration = evidence.durationMs == null ? "desconocida" : `${evidence.durationMs}ms`;
  return `${base}; costo=${cost}, duración=${duration}`;
}

/**
 * Human-readable exclusion lines for Restricted/details (never “incapable”).
 */
export function buildOwnedEvidenceExclusionLines({
  models,
  eligibility,
  store,
  role,
  accountKey = "default",
  allowSynthetic = false
}) {
  const probe = currentProbeForRole(role);
  if (!store?.getValidatedVerdict || !probe) return [];
  const account = normalizeAccountKey(accountKey);
  const lines = [];
  for (const model of models) {
    const label = `${model.adapterId} · ${model.modelId}`;
    if (eligibility[model.adapterId]?.ok !== true) {
      lines.push(`${label} — proveedor bloqueado`);
      continue;
    }
    const key = {
      adapterId: model.adapterId,
      modelId: model.modelId,
      accountKey: account,
      role,
      probeId: probe.probeId,
      probeVersion: probe.probeVersion
    };
    const validated = store.getValidatedVerdict(key);
    const lastAttempt = store.getLastAttempt?.(key) ?? null;
    if (isProductionEnablingEvidence(validated, { allowSynthetic })) continue;
    if (validated?.verdict === "fail") {
      lines.push(`${label} — no superó ${probe.probeId} v${probe.probeVersion}`);
      continue;
    }
    if (validated?.origin === "synthetic" || lastAttempt?.origin === "synthetic") {
      lines.push(`${label} — evidencia sintética no habilita producción`);
      continue;
    }
    lines.push(`${label} — pendiente de evidencia propia operativa (${probe.probeId})`);
  }
  return lines;
}
