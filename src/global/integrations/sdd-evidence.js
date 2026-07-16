export const SDD_PLAN_ACTIONS = Object.freeze({
  CREATE: "create",
  NOOP: "noop",
  UPDATE: "update",
  CONFLICT: "conflict"
});

export const SDD_HEALTH = Object.freeze({
  CONFIGURED: "configured",
  MISSING: "missing",
  DRIFTED: "drifted",
  CONFLICT: "conflict"
});

/**
 * Classify one destination file against canonical bytes and optional tracked hash.
 * Untracked or user-modified files are conflicts and must never be overwritten.
 */
export function classifySddSkillFile({
  exists,
  canonicalHash,
  diskHash = null,
  trackedHash = null
} = {}) {
  if (!exists) {
    return {
      action: SDD_PLAN_ACTIONS.CREATE,
      reason: "Destination missing; physical copy planned."
    };
  }

  if (trackedHash == null) {
    return {
      action: SDD_PLAN_ACTIONS.CONFLICT,
      reason: "Pre-existing untracked file; preserving byte-for-byte."
    };
  }

  if (trackedHash !== diskHash) {
    return {
      action: SDD_PLAN_ACTIONS.CONFLICT,
      reason: "User-modified after materialization; preserving byte-for-byte."
    };
  }

  if (diskHash === canonicalHash) {
    return {
      action: SDD_PLAN_ACTIONS.NOOP,
      reason: "Already matches canonical skill bytes."
    };
  }

  return {
    action: SDD_PLAN_ACTIONS.UPDATE,
    reason: "Managed file drifted from canonical skill bytes."
  };
}

/** Map plan classification to verify health, separating canonical vs disk drift. */
export function classifySddVerifyHealth({
  exists,
  canonicalHash,
  diskHash = null,
  trackedHash = null
} = {}) {
  if (!exists) {
    return { status: SDD_HEALTH.MISSING, drift: null, reason: "Destination missing on disk." };
  }
  if (trackedHash == null) {
    return { status: SDD_HEALTH.CONFLICT, drift: null, reason: "Pre-existing untracked file." };
  }
  if (trackedHash !== diskHash) {
    return { status: SDD_HEALTH.CONFLICT, drift: "disk", reason: "Disk drifted from tracked hash." };
  }
  if (diskHash !== canonicalHash) {
    return { status: SDD_HEALTH.DRIFTED, drift: "canonical", reason: "Managed bytes drifted from canonical." };
  }
  return { status: SDD_HEALTH.CONFIGURED, drift: null, reason: "Matches tracked and canonical bytes." };
}

