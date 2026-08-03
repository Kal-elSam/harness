import { CONTROL_PLANE_HEALTH } from "../control-plane-snapshot.js";
import { buildObservabilitySnapshot as defaultObs } from "./build-observability-snapshot.js";
import { createGentleProbe } from "./gentle-probe.js";
import { createGraphifyProbe } from "./graphify-probe.js";
import { getObservabilityProbe, registerObservabilityProbe } from "./probe-registry.js";

export const SOFT_LINK_WINDOW_MS = 60 * 60 * 1000;
const RUN_TS = ["updatedAt", "endedAt", "startedAt"];
const REVIEW_TS = ["updatedAt", "createdAt", "capturedAt", "startedAt"];
const GOV_PRIMARY = new Set([
  CONTROL_PLANE_HEALTH.NOT_CONFIGURED,
  CONTROL_PLANE_HEALTH.ACTION_REQUIRED,
  CONTROL_PLANE_HEALTH.CHECK_FAILED
]);

function defaultEnsure() {
  if (!getObservabilityProbe("gentle")) registerObservabilityProbe(createGentleProbe());
  if (!getObservabilityProbe("graphify")) registerObservabilityProbe(createGraphifyProbe());
}

export function parseCompanionTimestamp(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function firstTs(obj, keys) {
  for (const key of keys) {
    const ms = parseCompanionTimestamp(obj?.[key]);
    if (ms != null) return ms;
  }
  return null;
}

export const resolveRunTimestamp = (run) => firstTs(run, RUN_TS);
export const resolveReviewTimestamp = (review) => firstTs(review, REVIEW_TS);

/** Soft/display-only — never authority evidence. */
export function softLinkReviewToRun(review, runs = []) {
  const agentId = review?.agentId;
  const reviewAt = resolveReviewTimestamp(review);
  if (typeof agentId !== "string" || !agentId || reviewAt == null) return null;
  const eligible = [];
  for (const run of runs) {
    if (run?.agentId !== agentId) continue;
    const runAt = resolveRunTimestamp(run);
    if (runAt == null || !(reviewAt > runAt)) continue;
    const deltaMs = reviewAt - runAt;
    if (deltaMs > SOFT_LINK_WINDOW_MS) continue;
    const runId = String(run.runId ?? "");
    if (!runId) continue;
    eligible.push({ runId, runAt, deltaMs });
  }
  if (!eligible.length) return null;
  eligible.sort((a, b) => (b.runAt - a.runAt) || a.runId.localeCompare(b.runId));
  const best = eligible[0];
  return {
    kind: "soft", displayOnly: true, agentId,
    reviewId: String(review.reviewId ?? ""), runId: best.runId,
    deltaMs: best.deltaMs, runAt: best.runAt, reviewAt
  };
}

export function summarizeCompanionProbes(probes = []) {
  const byId = Object.fromEntries((probes ?? []).map((p) => [p.id, p]));
  const gentle = byId.gentle ?? { state: "missing", diagnostics: [], error: null };
  const graphify = byId.graphify ?? { state: "missing", diagnostics: [], error: null };
  const graph = (graphify.evidence ?? []).find((e) => e?.kind === "graph") ?? null;
  return {
    gentle: { state: gentle.state, error: gentle.error ?? null, diagnostics: gentle.diagnostics ?? [] },
    graphify: {
      state: graphify.state, error: graphify.error ?? null,
      diagnostics: graphify.diagnostics ?? [], graphStatus: graph?.status ?? null
    }
  };
}

function rankNext({ controlPlaneHealth, signals, engram }) {
  const gentleState = signals?.gentle?.state;
  const graphState = signals?.graphify?.state;
  const graphStatus = signals?.graphify?.graphStatus;
  const engramStatus = engram?.status ?? "missing";
  let kind = "idle";
  let title = "Companion signals quiet";
  let detail = "No companion follow-up required.";
  if (gentleState === "error" || graphState === "error" || graphStatus === "error"
    || engramStatus === "conflict" || engramStatus === "unsupported") {
    kind = "investigate";
    title = "Investigate companion diagnostics";
    detail = "Optional tools reported a hard failure; inspect Gentle/Graphify/Engram read-only.";
  } else if (gentleState === "missing" || graphState === "missing" || engramStatus === "missing") {
    kind = "missing";
    title = "Optional companion tool not detected";
    detail = "Governance may still be healthy; missing tools are diagnostic only.";
  } else if (graphStatus === "stale") {
    kind = "inform";
    title = "Graphify graph looks stale";
    detail = "Informational only — stale does not block read-only ops.";
  }
  return {
    kind, title, detail, secondary: true,
    governancePrimary: GOV_PRIMARY.has(controlPlaneHealth), displayOnly: true
  };
}

function emptyCompanion(error = null) {
  return {
    ok: false, error: error == null ? null : String(error),
    generatedAt: new Date().toISOString(),
    signals: {
      gentle: { state: "error", error: null, diagnostics: [] },
      graphify: { state: "error", error: null, diagnostics: [], graphStatus: null }
    },
    engram: { status: "error", binary: null },
    links: [], alertsCount: null,
    nextSafeAction: {
      kind: "investigate", title: "Investigate companion diagnostics",
      detail: String(error ?? "companion snapshot failed"),
      secondary: true, governancePrimary: false, displayOnly: true
    }
  };
}

/** Fail-soft companion snapshot for Cockpit overlay — never throws. */
export async function buildCompanionSnapshot({
  controlPlaneHealth = null, runs = [], reviews = [], alerts = null,
  buildObservability = defaultObs, inspectEngram = null,
  ensureRegistered = defaultEnsure, loadReviews = null, loadAlerts = null,
  observabilityContext = {}
} = {}) {
  try {
    ensureRegistered();
    let obs;
    try { obs = await buildObservability(observabilityContext); }
    catch (err) { return emptyCompanion(err?.message ?? err); }

    let engram = { status: "missing", binary: null };
    if (typeof inspectEngram === "function") {
      try { engram = inspectEngram(observabilityContext) ?? engram; }
      catch (err) { engram = { status: "error", binary: null, error: err?.message ?? String(err) }; }
    }

    const reviewList = Array.isArray(reviews) ? reviews
      : (typeof loadReviews === "function" ? await loadReviews() : []);
    const alertList = Array.isArray(alerts) ? alerts
      : (typeof loadAlerts === "function" ? await loadAlerts() : null);
    const signals = summarizeCompanionProbes(obs?.probes ?? []);
    const links = [];
    for (const review of reviewList ?? []) {
      const link = softLinkReviewToRun(review, runs);
      if (link) links.push(link);
    }
    return {
      ok: true, error: null, generatedAt: new Date().toISOString(), signals,
      engram: { status: engram.status ?? "missing", binary: engram.binary?.path ?? null, error: engram.error ?? null },
      links,
      alertsCount: Array.isArray(alertList)
        ? alertList.filter((a) => a?.state === "open" || a?.state === "pending").length
        : null,
      nextSafeAction: rankNext({ controlPlaneHealth, signals, engram })
    };
  } catch (err) {
    return emptyCompanion(err?.message ?? err);
  }
}
