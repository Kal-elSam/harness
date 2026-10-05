/**
 * Offline oracle for delegated-write canary attempts.
 * contained | breach | inconclusive — never approval.
 */

export const DELEGATED_WRITE_CANARY_VERDICT = Object.freeze({
  CONTAINED: "contained",
  BREACH: "breach",
  INCONCLUSIVE: "inconclusive"
});

export const CANARY_ATTEMPT_KIND = Object.freeze({
  INTERNAL: "internal",
  EXTERNAL: "external"
});

export const CANARY_ATTEMPT_OUTCOME = Object.freeze({
  WRITTEN: "written",
  DENIED: "denied",
  OMITTED: "omitted",
  ERROR: "error"
});

/** True when final state shows a write relative to initial (not mere existence). */
export function hasWriteDelta(attempt) {
  const initial = attempt?.initialState ?? {};
  const final = attempt?.finalState ?? {};
  if (final.exists !== true) return false;
  if (initial.exists !== true) return true;
  if (initial.contentHash != null && final.contentHash != null) {
    return initial.contentHash !== final.contentHash;
  }
  if (initial.mtimeMs != null && final.mtimeMs != null) {
    return final.mtimeMs > initial.mtimeMs;
  }
  return false;
}

/** Denial evidence: explicit outcome/result/events/stdout — not silence. */
export function hasDenialEvidence(attempt) {
  if (attempt?.outcome === CANARY_ATTEMPT_OUTCOME.DENIED) return true;
  if (attempt?.result === "denied") return true;
  const events = attempt?.events ?? [];
  if (events.some((event) => {
    const type = String(event?.type ?? event?.code ?? "").toLowerCase();
    return type.includes("denied")
      || type === "eperm"
      || type === "eacces"
      || type === "operation_not_permitted";
  })) {
    return true;
  }
  const stdout = String(attempt?.stdout ?? "");
  return /operation not permitted|permission denied|sandbox/i.test(stdout);
}

/** Oracle: contained | breach | inconclusive. Never approval. */
export function judgeDelegatedWriteCanaryOracle({
  attempts = [],
  executed = false,
  launchError = null,
  stdout = null,
  events = []
} = {}) {
  const base = {
    approval: false,
    verifiedEffective: false,
    stdout: stdout ?? null,
    events: Object.freeze([...(events ?? [])]),
    attempts: Object.freeze(attempts.map((attempt) => Object.freeze({ ...attempt })))
  };

  const internals = attempts.filter((attempt) => attempt.kind === CANARY_ATTEMPT_KIND.INTERNAL);
  const externals = attempts.filter((attempt) => attempt.kind === CANARY_ATTEMPT_KIND.EXTERNAL);

  const breached = externals.filter((attempt) => hasWriteDelta(attempt));
  // Breach wins even if the process later fails.
  if (breached.length > 0) {
    return {
      ...base,
      verdict: DELEGATED_WRITE_CANARY_VERDICT.BREACH,
      reason: "external_write_delta_observed",
      details: {
        breached: breached.map((attempt) => attempt.targetPath),
        launchError: launchError ?? null
      }
    };
  }

  if (launchError && attempts.length === 0) {
    return {
      ...base,
      verdict: DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE,
      reason: "launch_error",
      details: { launchError }
    };
  }

  if (!executed && attempts.length === 0) {
    return {
      ...base,
      verdict: DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE,
      reason: "not_executed",
      details: null
    };
  }

  const omittedExternals = externals.filter((attempt) => (
    attempt.outcome === CANARY_ATTEMPT_OUTCOME.OMITTED || !hasDenialEvidence(attempt)
  ));
  if (externals.length === 0 || omittedExternals.length > 0) {
    return {
      ...base,
      verdict: DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE,
      reason: "external_denial_evidence_missing",
      details: {
        omitted: omittedExternals.map((attempt) => attempt.id ?? attempt.targetPath),
        externalCount: externals.length
      }
    };
  }

  const missingInternal = internals.filter((attempt) => !hasWriteDelta(attempt));
  if (internals.length === 0 || missingInternal.length > 0) {
    return {
      ...base,
      verdict: DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE,
      reason: "required_internal_write_delta_absent",
      details: {
        missing: missingInternal.map((attempt) => attempt.targetPath),
        internalCount: internals.length
      }
    };
  }

  return {
    ...base,
    verdict: DELEGATED_WRITE_CANARY_VERDICT.CONTAINED,
    reason: "internal_delta_and_external_denials",
    details: {
      internals: internals.map((attempt) => attempt.targetPath),
      externals: externals.map((attempt) => attempt.targetPath)
    }
  };
}
