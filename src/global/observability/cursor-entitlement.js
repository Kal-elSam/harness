// Real, minimal, non-destructive probe for Cursor's own real access state —
// Cursor exposes no usage/quota data via its CLI at all (confirmed by
// cursor-models.js's own header comment and the total absence of any
// usage-reading code for it anywhere in this codebase; it's only ever
// surfaced in Cursor's own web dashboard). This mirrors
// claude-model-entitlement.js's own probeClaudeModelEntitlement pattern —
// the same real justification applies: there is no cheaper way to know.
//
// Cursor's catalog mixes two real, independent classes of model: its own
// proprietary line ("Composer") and third-party models it proxies (GPT,
// Claude/Fable, Gemini, …). A single global boolean would incorrectly
// couple their access state — a Composer-pool exhaustion must never make
// Kairo think a proxied Claude model is unavailable too, and vice versa.

import { spawn as defaultSpawn } from "node:child_process";

export const CURSOR_POOL = Object.freeze({
  CURSOR_MODELS: "cursor_models",
  OTHER_MODELS: "other_models"
});

export const CURSOR_ACCESS_STATUS = Object.freeze({
  AVAILABLE: "available",
  EXHAUSTED: "exhausted",
  UNVERIFIED: "unverified"
});

// Cursor's own proprietary model line — confirmed via the real captured
// catalog fixture (cursor-models.test.js: "composer-2.5"). A revisable,
// documented heuristic, never asserted as Cursor's own official taxonomy:
// if Cursor ever ships a second proprietary line under a different name,
// this needs updating.
const CURSOR_OWN_MODEL_PATTERN = /composer/i;

/**
 * Which real pool a Cursor catalog model belongs to. `auto` has no real
 * pool of its own — it's the opaque, manual-only fallback (see
 * cursor-models.js's own isCursorAutoModel) and callers should never probe
 * it; this classifier is only meaningful for real, named models.
 * @param {{id: string, displayName?: string}} model
 * @returns {"cursor_models"|"other_models"}
 */
export function classifyCursorPool(model) {
  const text = `${model?.id ?? ""} ${model?.displayName ?? ""}`;
  return CURSOR_OWN_MODEL_PATTERN.test(text) ? CURSOR_POOL.CURSOR_MODELS : CURSOR_POOL.OTHER_MODELS;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const PROBE_PROMPT = "hi";

// Cursor's own `-p --output-format json` shape only ever exposes a real
// boolean (`is_error`) plus a free-text `result` message — no structured
// error code/status the way Claude's own probe response does (see
// classifyClaudeEntitlementResponse's own doc). An explicit quota/limit
// hit is real evidence a human would recognize in that same text — these
// patterns are Kairo's current best real knowledge of that wording, not a
// documented, stable Cursor contract; anything that doesn't clearly match
// stays UNVERIFIED, never guessed EXHAUSTED.
const LIMIT_TEXT_PATTERN = /(usage limit|rate limit|quota|out of credits|insufficient credits|monthly limit|spending limit)/i;

/** Shared with detectCursorLimitFromOutput below — one real classifier, never two separate heuristics for the same wording. */
function isLimitMessage(text) {
  return typeof text === "string" && LIMIT_TEXT_PATTERN.test(text);
}

function unverifiedResult(pool, reason = null) {
  return { pool, status: CURSOR_ACCESS_STATUS.UNVERIFIED, reason: reason == null ? null : String(reason), probedAt: new Date().toISOString() };
}

/**
 * A single real, minimal, non-destructive probe against one representative
 * model of a real pool — never a batch, never more than the caller's own
 * one real request. Fails closed: only an explicit success or an explicit,
 * recognized limit/quota error ever resolves to something other than
 * UNVERIFIED.
 * @param {object} args
 * @param {string} args.pool - a CURSOR_POOL value
 * @param {string} args.modelId - a real, representative model id for this pool (never "auto")
 * @param {string} [args.cwd]
 * @param {Function} [args.spawn]
 * @param {number} [args.timeoutMs]
 * @param {object} [args.env]
 */
export async function probeCursorPoolAccess({
  pool, modelId, cwd = process.cwd(), spawn = defaultSpawn, timeoutMs = DEFAULT_TIMEOUT_MS, env = process.env
} = {}) {
  if (typeof modelId !== "string" || !modelId) {
    return unverifiedResult(pool, "modelId is required");
  }
  const args = ["-p", PROBE_PROMPT, "--mode", "ask", "--model", modelId, "--output-format", "json"];

  let child;
  try {
    child = spawn("cursor-agent", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return unverifiedResult(pool, error?.message ?? error);
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;
    const timer = setTimeout(() => finish(unverifiedResult(pool, `cursor access probe timed out after ${timeoutMs}ms`)), timeoutMs);

    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { child.kill?.(); } catch { /* best effort */ }
      resolve(result);
    }

    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once?.("error", (error) => finish(unverifiedResult(pool, error?.message ?? error)));
    child.once?.("close", (code, signal) => {
      if (signal) {
        return finish(unverifiedResult(pool, `cursor-agent was killed by signal ${signal}${stderr ? `: ${stderr.trim()}` : ""}`));
      }
      let parsed;
      try { parsed = JSON.parse(stdout); } catch {
        return finish(unverifiedResult(pool, stderr.trim() || `cursor-agent exited ${code} with no parseable output`));
      }
      if (parsed?.is_error === true) {
        const message = typeof parsed.result === "string" ? parsed.result : (stderr.trim() || null);
        if (isLimitMessage(message)) {
          return finish({ pool, status: CURSOR_ACCESS_STATUS.EXHAUSTED, reason: message, probedAt: new Date().toISOString() });
        }
        return finish(unverifiedResult(pool, message ?? "cursor-agent returned an unrecognized error"));
      }
      if (typeof parsed?.result !== "string") {
        return finish(unverifiedResult(pool, "cursor-agent returned no real answer"));
      }
      finish({ pool, status: CURSOR_ACCESS_STATUS.AVAILABLE, reason: null, probedAt: new Date().toISOString() });
    });
  });
}

/**
 * Real, reactive limit detection for one real output line from an actual
 * (non-probe) Cursor execution — reuses the exact same isLimitMessage
 * classifier the probe itself uses, never a second heuristic. Deliberately
 * narrow: a stdout line is only ever trusted when it parses as real JSON
 * with `is_error: true` and a real `result` message matching the
 * classifier — arbitrary assistant text can legitimately mention "usage
 * limit" without representing a real failure, so plain stdout text is
 * never scanned. A stderr line has no such structured shape to lean on, so
 * an explicit matching message there is accepted directly.
 * @param {{line: string, stream: "stdout"|"stderr"}} args
 * @returns {{reason: string}|null}
 */
export function detectCursorLimitFromOutput({ line, stream }) {
  const trimmed = typeof line === "string" ? line.trim() : "";
  if (!trimmed) return null;

  if (stream === "stderr") {
    return isLimitMessage(trimmed) ? { reason: trimmed } : null;
  }

  let parsed;
  try { parsed = JSON.parse(trimmed); } catch { return null; }
  if (parsed?.is_error !== true) return null;
  const message = typeof parsed.result === "string" ? parsed.result : null;
  return isLimitMessage(message) ? { reason: message } : null;
}
