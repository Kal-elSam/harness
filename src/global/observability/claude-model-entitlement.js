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

const DENIED_ERROR_CODES = new Set(["credits_required"]);
const DENIED_HTTP_STATUSES = new Set([402, 403, 429]);
const DEFAULT_TIMEOUT_MS = 30_000;
const PROBE_ARGS_PREFIX = Object.freeze(["-p", "hi", "--model"]);
const PROBE_ARGS_SUFFIX = Object.freeze(["--output-format", "json"]);

/**
 * Pure classifier for a parsed Claude CLI `--output-format json` result.
 * The only place that interprets the real JSON shape for entitlement.
 *
 * @param {object|null|undefined} parsed
 * @returns {{ status: string, reason: string|null }}
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
        probedAt: new Date().toISOString()
      });
    });
  });
}

/**
 * Probe many model ids sequentially (never Promise.all). Caps at maxProbes.
 * @param {{
 *   modelIds: string[],
 *   maxProbes?: number,
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
  onProgress = null,
  ...probeOpts
} = {}) {
  const ids = Array.isArray(modelIds) ? modelIds.slice(0, Math.max(0, maxProbes)) : [];
  const results = [];
  for (let index = 0; index < ids.length; index += 1) {
    const modelId = ids[index];
    const result = await probeClaudeModelEntitlement({ modelId, ...probeOpts });
    results.push(result);
    if (typeof onProgress === "function") {
      onProgress({ modelId, index, total: ids.length, result });
    }
  }
  return results;
}
