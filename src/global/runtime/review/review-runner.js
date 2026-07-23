import {
  REVIEW_AGENTS, REVIEW_EXIT_CODES, REVIEW_SEVERITIES, REVIEW_STATES
} from "./review-types.js";
import {
  resolveReviewSnapshot, detectReviewSnapshotDrift
} from "./review-git.js";
import {
  buildReviewReceipt, createReviewId, saveReviewReceipt
} from "./review-receipts.js";
import { ReviewValidationError } from "./review-validate.js";
import { runCodexReview } from "./review-codex.js";
import { runPiReview } from "./review-pi.js";

export const REVIEW_RUNNER_ERROR_CODES = Object.freeze({
  UNKNOWN_AGENT: "unknown_agent",
  CANCELLED: "cancelled"
});

const SEVERITY_RANK = Object.freeze({
  [REVIEW_SEVERITIES.HIGH]: 3,
  [REVIEW_SEVERITIES.MEDIUM]: 2,
  [REVIEW_SEVERITIES.LOW]: 1
});

export class ReviewRunnerError extends Error {
  constructor(message, { code, details = null } = {}) {
    super(message);
    this.name = "ReviewRunnerError";
    this.code = code;
    this.details = details;
  }
}

/** Reject unknown agents before any Git snapshot work. */
export function resolveReviewAgent(agent) {
  const id = String(agent ?? "").trim().toLowerCase();
  if (id === REVIEW_AGENTS.CODEX || id === REVIEW_AGENTS.PI) return id;
  throw new ReviewRunnerError(
    `Unknown review agent "${agent ?? ""}". Use --agent codex|pi.`,
    { code: REVIEW_RUNNER_ERROR_CODES.UNKNOWN_AGENT, details: { agent } }
  );
}

export function resolveReviewExitCode({ state, findings = [], failOn = null } = {}) {
  if (state !== REVIEW_STATES.COMPLETED) return REVIEW_EXIT_CODES.ERROR;
  if (!failOn) return REVIEW_EXIT_CODES.OK;
  const threshold = SEVERITY_RANK[failOn] ?? 0;
  if (threshold === 0) return REVIEW_EXIT_CODES.OK;
  const hit = findings.some((f) => (SEVERITY_RANK[f.severity] ?? 0) >= threshold);
  return hit ? REVIEW_EXIT_CODES.THRESHOLD : REVIEW_EXIT_CODES.OK;
}

function classifyAgentError(error) {
  if (error instanceof ReviewValidationError) return REVIEW_STATES.INVALID;
  return REVIEW_STATES.FAILED;
}

/**
 * Snapshot → Codex|Pi → drift revalidation → write-once receipt.
 * Never returns/persists prompt, patch, JSONL, or transcript.
 */
export async function runReview({
  cwd, agent, base = null, commit = null, model = null,
  includePrivate = false, privateConfirmed = false, failOn = null,
  homeDir, cliVersion = null,
  resolveSnapshot = resolveReviewSnapshot,
  detectDrift = detectReviewSnapshotDrift,
  runCodex = runCodexReview, runPi = runPiReview,
  saveReceipt = saveReviewReceipt, createId = createReviewId,
  now = () => new Date().toISOString()
} = {}) {
  const agentId = resolveReviewAgent(agent);
  const reviewId = createId();
  const startedAt = now();
  const snapshot = await resolveSnapshot({
    cwd, base, commit, includePrivate, privateConfirmed
  });

  let state = REVIEW_STATES.COMPLETED;
  let findings = [];
  let warnings = [];
  let usage = null;
  let resolvedModel = model == null || model === "" ? null : String(model);

  try {
    const result = agentId === REVIEW_AGENTS.CODEX
      ? await runCodex({ snapshot, model: resolvedModel })
      : await runPi({ snapshot, model: resolvedModel });
    findings = Array.isArray(result.findings) ? result.findings : [];
    warnings = Array.isArray(result.warnings) ? result.warnings : [];
    usage = result.usage ?? null;
    resolvedModel = result.model ?? resolvedModel;
  } catch (error) {
    state = classifyAgentError(error);
    warnings = [String(error?.message ?? error)];
  }

  const drift = await detectDrift(snapshot, { includePrivate, privateConfirmed });
  if (drift.stale) state = REVIEW_STATES.STALE;

  const finishedAt = now();
  const durationMs = Date.parse(finishedAt) - Date.parse(startedAt);
  const receipt = buildReviewReceipt({
    reviewId, agentId, model: resolvedModel, snapshot, state,
    findings, warnings, usage,
    timings: {
      startedAt, finishedAt,
      durationMs: Number.isFinite(durationMs) ? durationMs : null
    },
    cliVersion
  });
  await saveReceipt(receipt, { homeDir });

  return {
    receipt,
    exitCode: resolveReviewExitCode({ state, findings, failOn }),
    stale: Boolean(drift.stale)
  };
}
