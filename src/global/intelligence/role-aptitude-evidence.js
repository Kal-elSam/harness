// Owned role-aptitude evidence store (E1 + E4 provenance). Separate from
// AA/benchmark CapabilityRegistry. lastAttempt and validatedVerdict are
// distinct heads per (adapterId, modelId, accountKey, role, probeId, probeVersion).
// In-memory only — no disk persistence.

/**
 * @typedef {"pending"|"pass"|"fail"|"error"} RoleAptitudeVerdict
 * @typedef {"synthetic"|"operational"|"unknown"} RoleAptitudeOrigin
 * @typedef {{
 *   adapterId: string,
 *   modelId: string,
 *   accountKey?: string|null,
 *   role: string,
 *   probeId: string,
 *   probeVersion: string,
 *   verdict: RoleAptitudeVerdict,
 *   origin?: RoleAptitudeOrigin,
 *   executionKind?: string|null,
 *   modelContext?: string|null,
 *   startedAt?: string|null,
 *   finishedAt?: string|null,
 *   durationMs?: number|null,
 *   cost?: number|null,
 *   error?: string|null,
 *   artifactRefs?: string[],
 *   validatorId?: string|null,
 *   validatorVersion?: string|null
 * }} RoleAptitudeAttempt
 */

const VALIDATED_VERDICTS = new Set(["pass", "fail"]);
const ORIGINS = new Set(["synthetic", "operational", "unknown"]);

function normalizeAccountKey(accountKey) {
  if (accountKey == null || accountKey === "") return "default";
  return String(accountKey);
}

function evidenceKey({ adapterId, modelId, accountKey, role, probeId, probeVersion }) {
  return `${adapterId}::${modelId}::${normalizeAccountKey(accountKey)}::${role}::${probeId}::${probeVersion}`;
}

/** @param {RoleAptitudeAttempt} attempt */
function cloneAttempt(attempt) {
  return {
    adapterId: attempt.adapterId,
    modelId: attempt.modelId,
    accountKey: normalizeAccountKey(attempt.accountKey),
    role: attempt.role,
    probeId: attempt.probeId,
    probeVersion: attempt.probeVersion,
    verdict: attempt.verdict,
    origin: ORIGINS.has(attempt.origin) ? attempt.origin : "unknown",
    executionKind: attempt.executionKind ?? null,
    modelContext: attempt.modelContext ?? null,
    startedAt: attempt.startedAt ?? null,
    finishedAt: attempt.finishedAt ?? null,
    durationMs: attempt.durationMs ?? null,
    cost: attempt.cost ?? null,
    error: attempt.error ?? null,
    artifactRefs: Array.isArray(attempt.artifactRefs) ? [...attempt.artifactRefs] : [],
    validatorId: attempt.validatorId ?? null,
    validatorVersion: attempt.validatorVersion ?? null
  };
}

/** @param {RoleAptitudeAttempt} validated */
function labelForValidated(validated) {
  const source = validated.origin === "operational"
    ? "operativa"
    : validated.origin === "synthetic"
      ? "sintética (no habilita producción)"
      : "origen desconocido";
  if (validated.verdict === "pass") {
    return `Evidencia propia: apto (${validated.probeId} v${validated.probeVersion}, ${source})`;
  }
  return `No superó la prueba ${validated.probeId} (${source})`;
}

/**
 * Whether a validated verdict may admit a real model into owned-evidence
 * competition. Labeling origin operational is not enough — only a
 * real-bridge executionKind enables production. Synthetic/unknown/test-double
 * never enable (unless allowSynthetic for offline harnesses).
 * @param {RoleAptitudeAttempt|null|undefined} attempt
 * @param {{ allowSynthetic?: boolean }} [options]
 */
export function isProductionEnablingEvidence(attempt, options = {}) {
  if (!attempt || attempt.verdict !== "pass") return false;
  if (attempt.origin === "operational" && attempt.executionKind === "real-bridge") return true;
  if (options.allowSynthetic === true && attempt.origin === "synthetic") return true;
  return false;
}

/**
 * In-memory owned-evidence store.
 */
export function createRoleAptitudeEvidenceStore() {
  /** @type {Map<string, {history: RoleAptitudeAttempt[], lastAttempt: RoleAptitudeAttempt|null, validatedVerdict: RoleAptitudeAttempt|null}>} */
  const entries = new Map();

  function entryFor(keyParts) {
    const key = evidenceKey(keyParts);
    let entry = entries.get(key);
    if (!entry) {
      entry = { history: [], lastAttempt: null, validatedVerdict: null };
      entries.set(key, entry);
    }
    return entry;
  }

  function keyPartsFrom(identity, role, probeId, probeVersion, accountKey) {
    return {
      adapterId: identity.adapterId,
      modelId: identity.modelId,
      accountKey: accountKey ?? identity.accountKey,
      role,
      probeId,
      probeVersion
    };
  }

  return {
    /** @param {RoleAptitudeAttempt} attempt */
    recordAttempt(attempt) {
      if (!attempt?.adapterId || !attempt?.modelId || !attempt?.role || !attempt?.probeId || !attempt?.probeVersion) {
        throw new Error("role-aptitude-evidence: attempt missing identity or probe fields");
      }
      if (!["pending", "pass", "fail", "error"].includes(attempt.verdict)) {
        throw new Error(`role-aptitude-evidence: invalid verdict "${attempt.verdict}"`);
      }
      const stored = cloneAttempt(attempt);
      const entry = entryFor(stored);
      entry.history.push(stored);
      entry.lastAttempt = stored;
      if (VALIDATED_VERDICTS.has(stored.verdict)) {
        entry.validatedVerdict = stored;
      }
      return cloneAttempt(stored);
    },

    getLastAttempt(keyParts) {
      const entry = entries.get(evidenceKey(keyParts));
      return entry?.lastAttempt ? cloneAttempt(entry.lastAttempt) : null;
    },

    getValidatedVerdict(keyParts) {
      const entry = entries.get(evidenceKey(keyParts));
      return entry?.validatedVerdict ? cloneAttempt(entry.validatedVerdict) : null;
    },

    /**
     * Validated pass that may enable production competition for this exact
     * account/probe version. Synthetic/unknown never qualify unless explicitly allowed.
     */
    getProductionEnablingPass(keyParts, options = {}) {
      const validated = this.getValidatedVerdict(keyParts);
      return isProductionEnablingEvidence(validated, options) ? validated : null;
    },

    listHistory(keyParts) {
      const entry = entries.get(evidenceKey(keyParts));
      if (!entry) return [];
      return entry.history.map(cloneAttempt);
    },

    projectRoleEvidence(identity, role, probeId, probeVersion, accountKey = null) {
      const keyParts = keyPartsFrom(identity, role, probeId, probeVersion, accountKey);
      const entry = entries.get(evidenceKey(keyParts));
      const validated = entry?.validatedVerdict ? cloneAttempt(entry.validatedVerdict) : null;
      const lastAttempt = entry?.lastAttempt ? cloneAttempt(entry.lastAttempt) : null;

      if (validated) {
        return {
          status: validated.verdict,
          labelEs: labelForValidated(validated),
          validated,
          lastAttempt,
          productionEnabling: isProductionEnablingEvidence(validated)
        };
      }

      if (lastAttempt?.verdict === "error") {
        return {
          status: "error",
          labelEs: "Evaluación interrumpida — sigue pendiente",
          validated: null,
          lastAttempt,
          productionEnabling: false
        };
      }

      return {
        status: "pending",
        labelEs: "Sin evidencia propia aún",
        validated: null,
        lastAttempt,
        productionEnabling: false
      };
    }
  };
}

export { evidenceKey, normalizeAccountKey };
