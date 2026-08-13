/**
 * Read-only Gentle adapters for control-plane workflow/review.
 * Never invents Direct/Delegated/SDD from agent prose — only Gentle payloads.
 */
import { spawnSync } from "node:child_process";
import { WORKFLOW_KIND, NO_ACTIVE_WORKFLOW } from "./constants.js";

const DEFAULT_TIMEOUT_MS = 8_000;

export function extractJsonPayload(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      return null;
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export function runGentleCommand(args, {
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawn = spawnSync,
  command = "gentle-ai"
} = {}) {
  try {
    const result = spawn(command, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024
    });
    if (result.error) {
      return { ok: false, error: result.error.message || "gentle_spawn_failed", payload: null };
    }
    const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const payload = extractJsonPayload(text);
    if (!payload) {
      return { ok: false, error: "gentle_parse_failed", payload: null, status: result.status };
    }
    return { ok: true, payload, status: result.status, error: null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      payload: null
    };
  }
}

function explicitRoute(payload) {
  const raw = payload?.route ?? payload?.workflowKind ?? payload?.kind ?? null;
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === WORKFLOW_KIND.DIRECT) return WORKFLOW_KIND.DIRECT;
  if (normalized === WORKFLOW_KIND.DELEGATED) return WORKFLOW_KIND.DELEGATED;
  if (normalized === WORKFLOW_KIND.SDD) return WORKFLOW_KIND.SDD;
  if (normalized === WORKFLOW_KIND.REVIEW) return WORKFLOW_KIND.REVIEW;
  return null;
}

/**
 * Map gentle-ai.sdd-status@1 (+ optional explicit route) into workflow section.
 */
export function mapSddStatusToWorkflow(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      kind: WORKFLOW_KIND.NONE,
      active: false,
      label: NO_ACTIVE_WORKFLOW,
      phase: null,
      nextTransition: null,
      changeName: null,
      review: null
    };
  }

  const route = explicitRoute(payload);
  const changeName = typeof payload.changeName === "string" && payload.changeName
    ? payload.changeName
    : null;
  const nextTransition = typeof payload.next === "string" && payload.next
    ? payload.next
    : (typeof payload.nextTransition === "string" ? payload.nextTransition : null);
  const phase = typeof payload.phase === "string"
    ? payload.phase
    : (typeof payload.currentPhase === "string" ? payload.currentPhase : null);
  const hasActiveChange = Boolean(changeName);

  if (route === WORKFLOW_KIND.DIRECT || route === WORKFLOW_KIND.DELEGATED) {
    return {
      kind: route,
      active: true,
      label: route === WORKFLOW_KIND.DIRECT ? "Direct" : "Delegated",
      phase,
      nextTransition,
      changeName,
      review: null
    };
  }

  if (hasActiveChange || route === WORKFLOW_KIND.SDD) {
    return {
      kind: WORKFLOW_KIND.SDD,
      active: hasActiveChange,
      label: hasActiveChange ? "SDD" : NO_ACTIVE_WORKFLOW,
      phase: phase ?? (hasActiveChange ? null : null),
      nextTransition,
      changeName,
      review: null
    };
  }

  return {
    kind: WORKFLOW_KIND.NONE,
    active: false,
    label: NO_ACTIVE_WORKFLOW,
    phase: null,
    nextTransition: nextTransition === "sdd-new" ? nextTransition : nextTransition,
    changeName: null,
    review: null
  };
}

/**
 * Only surface review when Gentle reports authoritative receipt/gate state.
 */
export function mapReviewStatusToReview(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.authoritative !== true) return null;
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const active = entries.find((row) =>
    row
    && typeof row === "object"
    && row.status !== "superseded"
    && (row.status === "active" || row.status === "current" || row.status === "recovered")
    && (row.receipt || row.revision || row.snapshot_identity || row.gate || row.state)
  ) ?? null;
  if (!active) return null;

  const receipt = active.receipt
    ?? active.revision
    ?? active.snapshot_identity
    ?? null;
  const gate = active.gate ?? payload.gate ?? null;
  // Prefer receipt/gate evidence; state alone is insufficient for panel receipt UI.
  if (!receipt && !gate) return null;

  return {
    lineageId: typeof active.lineage_id === "string" ? active.lineage_id : null,
    state: typeof active.state === "string" ? active.state : null,
    status: typeof active.status === "string" ? active.status : null,
    receipt: typeof receipt === "string" ? receipt : null,
    gate: typeof gate === "string" ? gate : null
  };
}

export function loadGentleWorkflow({
  cwd,
  env,
  timeoutMs,
  spawn,
  command,
  runCommand = runGentleCommand
} = {}) {
  const sdd = runCommand(["sdd-status"], { cwd, env, timeoutMs, spawn, command });
  if (!sdd.ok) {
    return {
      ok: false,
      error: sdd.error ?? "gentle_sdd_unavailable",
      workflow: {
        kind: WORKFLOW_KIND.NONE,
        active: false,
        label: NO_ACTIVE_WORKFLOW,
        phase: null,
        nextTransition: null,
        changeName: null,
        review: null
      }
    };
  }

  const workflow = mapSddStatusToWorkflow(sdd.payload);
  const reviewRun = runCommand(["review", "status"], { cwd, env, timeoutMs, spawn, command });
  if (reviewRun.ok) {
    const review = mapReviewStatusToReview(reviewRun.payload);
    if (review) {
      workflow.review = review;
      if (!workflow.active && workflow.kind === WORKFLOW_KIND.NONE) {
        workflow.kind = WORKFLOW_KIND.REVIEW;
        workflow.active = true;
        workflow.label = "Review";
      }
    }
  }

  return { ok: true, error: null, workflow };
}
