// Live per-model Claude entitlement probe. Kept separate from
// claude-models.js on purpose: that module is sync, free, and pure, and
// three of its four callers sit on hot paths. This module is the only
// place that interprets the real `claude -p … --output-format json`
// response for account access — fail-closed, never inventing allowed.

import { spawn as defaultSpawn } from "node:child_process";
import { buildClaudeExecutionEnv } from "../runtime/execution-adapters/claude.js";

export const ENTITLEMENT = Object.freeze({
  ALLOWED: "allowed",
  DENIED: "denied",
  UNVERIFIED: "unverified",
  // Non-Claude providers: their live/documented catalog IS access proof.
  NOT_APPLICABLE: "not_applicable"
});

// Explicit denials only. A bare 429 is a TEMPORARY limit, not a permission
// denial (see classifyClaudeEntitlementResponse).
const DENIED_ERROR_CODES = new Set(["credits_required"]);
const DENIED_HTTP_STATUSES = new Set([402, 403]);
const DENIED_MESSAGE_PATTERN = /requires usage credits/i;

// Marker carried on an UNVERIFIED result: the access state is unknown only
// because of a temporary limit. Consumers gating on DENIED/UNVERIFIED keep
// failing closed; the evidence just expires quickly (retryAfterMs).
export const TEMPORARY_LIMIT = "temporary";
export const TEMPORARY_LIMIT_DEFAULT_RETRY_MS = 5 * 60 * 1000;
export const TEMPORARY_LIMIT_MAX_RETRY_MS = 60 * 60 * 1000;
const TEMPORARY_LIMIT_MIN_RETRY_MS = 5 * 1000;

/** Default in-flight Claude entitlement probes (Round 3 — conservative). */
export const DEFAULT_PROBE_CONCURRENCY = 2;
/** Analyze-scope probe timeout from measured p95 (~14.3s) + margin. */
export const ANALYZE_PROBE_TIMEOUT_MS = 20_000;

/** Retry-After (seconds, as number or numeric string) -> clamped ms; default when absent/invalid. */
export function clampRetryAfterMs(retryAfterSeconds) {
  const seconds = typeof retryAfterSeconds === "string" ? Number(retryAfterSeconds) : retryAfterSeconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return TEMPORARY_LIMIT_DEFAULT_RETRY_MS;
  }
  return Math.min(TEMPORARY_LIMIT_MAX_RETRY_MS, Math.max(TEMPORARY_LIMIT_MIN_RETRY_MS, Math.round(seconds * 1000)));
}
const DEFAULT_TIMEOUT_MS = 30_000;
const PROBE_ARGS_PREFIX = Object.freeze(["-p", "hi", "--model"]);
const PROBE_ARGS_SUFFIX = Object.freeze(["--output-format", "json"]);

/**
 * Pure classifier for a parsed Claude CLI `--output-format json` result.
 * The only place that interprets the real JSON shape for entitlement.
 *
 * @param {object|null|undefined} parsed
 * 429 without an explicit denial code/text is a temporary limit: status
 * UNVERIFIED + `limit: "temporary"` + `retryAfterMs`, never DENIED/ALLOWED.
 *
 * @returns {{ status: string, reason: string|null, limit?: string, retryAfterMs?: number }}
 */
export function classifyClaudeEntitlementResponse(parsed) {
  if (!parsed || typeof parsed !== "object") {
    return { status: ENTITLEMENT.UNVERIFIED, reason: null };
  }

  const isError = parsed.is_error === true;
  const status = parsed.api_error_status;
  const code = parsed.api_error_code;
  const message = typeof parsed.result === "string" && parsed.result.trim()
    ? parsed.result
    : null;

  if (
    isError
    && (DENIED_ERROR_CODES.has(code) || DENIED_HTTP_STATUSES.has(status))
  ) {
    return { status: ENTITLEMENT.DENIED, reason: message };
  }

  if (isError && status === 429) {
    if (message && DENIED_MESSAGE_PATTERN.test(message)) {
      return { status: ENTITLEMENT.DENIED, reason: message };
    }
    return {
      status: ENTITLEMENT.UNVERIFIED,
      reason: message,
      limit: TEMPORARY_LIMIT,
      retryAfterMs: clampRetryAfterMs(parsed.retry_after ?? parsed.retry_after_seconds)
    };
  }

  if (parsed.is_error === false && (status === null || status === undefined)) {
    return { status: ENTITLEMENT.ALLOWED, reason: null };
  }

  return { status: ENTITLEMENT.UNVERIFIED, reason: message };
}

function probeArgv(modelId) {
  return [...PROBE_ARGS_PREFIX, modelId, ...PROBE_ARGS_SUFFIX];
}

function unverifiedResult(modelId, reason = null) {
  return {
    modelId,
    status: ENTITLEMENT.UNVERIFIED,
    reason: reason == null ? null : String(reason),
    probedAt: new Date().toISOString()
  };
}

/**
 * Probe a single Claude model id via the measured CLI shape.
 * @param {{ modelId: string, spawn?: typeof defaultSpawn, cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number }} options
 */
export async function probeClaudeModelEntitlement({
  modelId,
  spawn = defaultSpawn,
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (typeof modelId !== "string" || !modelId) {
    return unverifiedResult(modelId ?? "", "modelId is required");
  }

  let child;
  try {
    child = spawn("claude", probeArgv(modelId), {
      cwd,
      env: buildClaudeExecutionEnv(env),
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    return unverifiedResult(modelId, error?.message ?? error);
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;
    const timer = setTimeout(
      () => finish(unverifiedResult(modelId, `claude entitlement probe timed out after ${timeoutMs}ms`)),
      timeoutMs
    );

    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { child.kill?.(); } catch { /* best effort */ }
      resolve(result);
    }

    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once?.("error", (error) => finish(unverifiedResult(modelId, error?.message ?? error)));
    child.once?.("close", (code, signal) => {
      if (signal) {
        return finish(unverifiedResult(
          modelId,
          `claude entitlement probe was killed by signal ${signal}${stderr ? `: ${stderr.trim()}` : ""}`
        ));
      }

      let parsed = null;
      try {
        const trimmed = String(stdout ?? "").trim();
        parsed = trimmed ? JSON.parse(trimmed) : null;
      } catch {
        return finish(unverifiedResult(
          modelId,
          `claude entitlement probe returned invalid JSON${stderr ? `: ${stderr.trim()}` : ""}`
        ));
      }

      const classified = classifyClaudeEntitlementResponse(parsed);
      // A non-zero exit with a classifiable JSON body still trusts the body —
      // the measured denied probe exits 0, but broken/unknown shapes stay
      // unverified regardless of exit code. Never promote a failed spawn to
      // allowed just because exit was 0 with empty stdout (parsed null →
      // unverified above).
      if (classified.status === ENTITLEMENT.ALLOWED && code !== 0) {
        return finish(unverifiedResult(
          modelId,
          `claude entitlement probe exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`
        ));
      }

      finish({
        modelId,
        status: classified.status,
        reason: classified.reason,
        ...(classified.limit ? { limit: classified.limit, retryAfterMs: classified.retryAfterMs } : {}),
        probedAt: new Date().toISOString()
      });
    });
  });
}

/**
 * Bounded concurrent probe batch. Default concurrency 2 (analyze Round 3).
 * On a temporary 429 (`limit: temporary`), abort the rest of the sweep: no new
 * launches, in-flight probes finish, not-yet-started ids become unverified
 * (temporary) without a spawn. Result array stays in catalog order even when
 * completions arrive out of order. Caps at maxProbes.
 * @param {{
 *   modelIds: string[],
 *   maxProbes?: number,
 *   concurrency?: number,
 *   onProgress?: (event: { modelId: string, index: number, total: number, result: object }) => void,
 *   spawn?: typeof defaultSpawn,
 *   cwd?: string,
 *   env?: NodeJS.ProcessEnv,
 *   timeoutMs?: number
 * }} options
 */
export async function probeClaudeModelEntitlements({
  modelIds = [],
  maxProbes = 12,
  concurrency = DEFAULT_PROBE_CONCURRENCY,
  onProgress = null,
  ...probeOpts
} = {}) {
  const ids = Array.isArray(modelIds) ? modelIds.slice(0, Math.max(0, maxProbes)) : [];
  const total = ids.length;
  if (total === 0) return [];

  const results = new Array(total);
  let next = 0;
  let active = 0;
  let maxInFlight = Math.max(1, Math.floor(Number(concurrency)) || DEFAULT_PROBE_CONCURRENCY);
  let aborted = false;

  const emitProgress = (modelId, index, result) => {
    if (typeof onProgress !== "function") return;
    try {
      onProgress({ modelId, index, total, result });
    } catch {
      /* a progress listener never breaks the run */
    }
  };

  const skipRemainingAfterTemporary = (source) => {
    if (aborted) return;
    aborted = true;
    maxInFlight = 0;
    const retryAfterMs = source?.retryAfterMs;
    while (next < total) {
      const index = next;
      next += 1;
      const modelId = ids[index];
      const skipped = {
        modelId,
        status: ENTITLEMENT.UNVERIFIED,
        reason: "skipped after temporary Claude rate limit",
        limit: TEMPORARY_LIMIT,
        ...(typeof retryAfterMs === "number" ? { retryAfterMs } : {}),
        probedAt: new Date().toISOString()
      };
      results[index] = skipped;
      emitProgress(modelId, index, skipped);
    }
  };

  await new Promise((resolve) => {
    const pump = () => {
      while (active < maxInFlight && next < total) {
        const index = next;
        next += 1;
        active += 1;
        const modelId = ids[index];
        Promise.resolve()
          .then(() => probeClaudeModelEntitlement({ modelId, ...probeOpts }))
          .then((result) => {
            results[index] = result;
            emitProgress(modelId, index, result);
            if (result?.limit === TEMPORARY_LIMIT) skipRemainingAfterTemporary(result);
          })
          .catch((error) => {
            results[index] = unverifiedResult(modelId, error?.message ?? String(error));
            emitProgress(modelId, index, results[index]);
          })
          .finally(() => {
            active -= 1;
            if (next >= total && active === 0) resolve();
            else pump();
          });
      }
      if (next >= total && active === 0) resolve();
    };
    pump();
  });

  return results;
}
