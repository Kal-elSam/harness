// Owned role-aptitude evidence store (E1 + E4 provenance). Separate from
// AA/benchmark CapabilityRegistry. lastAttempt and validatedVerdict are
// distinct heads per (adapterId, modelId, accountKey, role, probeId, probeVersion).
// The in-memory API stays synchronous; persistent callers await flush at their
// async boundary before reporting completion.
import { readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { harnessHomePaths, resolveHomeDir } from "../paths.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

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
 *   tokens?: number|null,
 *   cost?: number|null,
 *   error?: string|null,
 *   failedChecks?: string[],
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
    tokens: Number.isFinite(attempt.tokens) && attempt.tokens >= 0 ? attempt.tokens : null,
    cost: attempt.cost ?? null,
    error: attempt.error ?? null,
    failedChecks: Array.isArray(attempt.failedChecks) ? attempt.failedChecks.map(failedCheckName).filter(Boolean).slice(0, 10) : [],
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

/**
 * Validator reasons may interpolate model-controlled values (written paths,
 * "got" values, thrown messages). Keep only the fixed rule text before them.
 * @param {unknown} reason
 */
export function failedCheckName(reason) {
  return String(reason ?? "")
    .split(/:\s| got |\s\(|\n/)[0]
    .replace(/^(forbidden edit|edited forbidden path) (?!outside editablePaths$).*$/, "$1")
    .trim()
    .slice(0, 120);
}

// Free-form errors, modelContext (authorization id), and artifact references may
// contain provider output or secrets. Only typed result metadata crosses disk.
function persistentAttempt(attempt) {
  const stored = cloneAttempt(attempt);
  const { modelContext, error, artifactRefs, ...metadata } = stored;
  const identifiers = ["adapterId", "modelId", "accountKey", "role", "probeId", "probeVersion"];
  if (identifiers.some(key => typeof metadata[key] !== "string" || !metadata[key]) ||
      !["pending", "pass", "fail", "error"].includes(metadata.verdict)) {
    throw new Error("role-aptitude-evidence: invalid persisted attempt");
  }
  for (const key of ["executionKind", "startedAt", "finishedAt", "validatorId", "validatorVersion"]) {
    if (metadata[key] !== null && typeof metadata[key] !== "string") {
      throw new Error(`role-aptitude-evidence: invalid ${key}`);
    }
  }
  for (const key of ["durationMs", "cost"]) {
    if (metadata[key] !== null && (!Number.isFinite(metadata[key]) || metadata[key] < 0)) {
      throw new Error(`role-aptitude-evidence: invalid ${key}`);
    }
  }
  return metadata;
}

async function readPersistentAttempts(path) {
  let bytes;
  try { bytes = await readFile(path, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const data = JSON.parse(bytes);
  if (data?.schemaVersion !== 1 || !Array.isArray(data.attempts)) {
    throw new Error("unsupported evidence schema");
  }
  return data.attempts.map(persistentAttempt);
}

/**
 * Same synchronous evidence interface, plus flush(): await it before exit or
 * opening a separate instance. Flush re-reads disk so sequential writers do not
 * discard evidence loaded since construction. Atomic publish is not a lock;
 * independent simultaneous processes must not write this file concurrently.
 */
export async function createPersistentRoleAptitudeEvidenceStore({
  homeDir = resolveHomeDir(), atomicWriteDeps
} = {}) {
  const path = harnessHomePaths(homeDir).roleAptitudeEvidencePath;
  const store = createRoleAptitudeEvidenceStore();
  let readError = null;
  try {
    for (const row of await readPersistentAttempts(path)) store.recordAttempt(row);
  } catch (error) { readError = error; }
  const refuse = cause => new Error(
    "role-aptitude-evidence: corrupt or unreadable evidence file; writes refused until fixed or moved",
    { cause }
  );
  let pending = [];
  let writing = Promise.resolve();
  return {
    ...store,
    recordAttempt(attempt) {
      if (readError) throw refuse(readError);
      const row = persistentAttempt(attempt);
      const recorded = store.recordAttempt(attempt);
      pending.push(row);
      return recorded;
    },
    flush() {
      const rows = pending;
      pending = [];
      writing = writing.then(async () => {
        if (!rows.length) return;
        let existing;
        try { existing = await readPersistentAttempts(path); }
        catch (error) { throw refuse(error); }
        await mkdir(dirname(path), { recursive: true });
        await writeAtomicJson(path, { schemaVersion: 1, attempts: [...existing, ...rows] }, atomicWriteDeps);
      });
      return writing;
    }
  };
}
