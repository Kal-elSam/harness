/**
 * Read-only Gentle adapters for control-plane workflow/review.
 * Negotiate capabilities before any workflow fetch. Never invent authority.
 */
import { spawnSync } from "node:child_process";
import { probeGentle } from "../observability/gentle-probe.js";
import { WORKFLOW_KIND, NO_ACTIVE_WORKFLOW, PROVIDER } from "./constants.js";
import {
  emptyGentleWorkflow,
  mapGentleProviderState,
  providerError
} from "./provider.js";
import {
  REVIEW_STATUS_ARGS,
  mapOfficialReviewStatus
} from "./review-status.js";

const DEFAULT_TIMEOUT_MS = 8_000;

export function parseStrictJson(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  try {
    const parsed = JSON.parse(text.trim());
    return parsed != null && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function extractJsonPayload(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const strict = parseStrictJson(text);
  if (strict) return strict;
  const trimmed = text.trim();
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
  command = "gentle-ai",
  strict = false
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
    const payload = strict
      ? parseStrictJson(result.stdout ?? "")
      : (extractJsonPayload(result.stdout ?? "") ?? extractJsonPayload(result.stderr ?? ""));
    if (!payload) {
      return { ok: false, error: "gentle_parse_failed", payload: null, status: result.status };
    }
    if (result.status !== 0 && result.status != null) {
      return { ok: false, error: "gentle_nonzero_status", payload, status: result.status };
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

function applyOfficialReview(workflow, mapped) {
  workflow.review = mapped.review;
  workflow.nextTransition = mapped.nextTransition;
  if (workflow.kind === WORKFLOW_KIND.NONE && mapped.nextTransition != null) {
    workflow.kind = WORKFLOW_KIND.REVIEW;
    workflow.active = mapped.nextTransition?.kind === "execute" || mapped.review != null;
    workflow.label = "Review";
  }
}

export async function loadGentleWorkflow({
  cwd,
  env,
  timeoutMs,
  spawn,
  command,
  probe = probeGentle,
  runCommand = runGentleCommand
} = {}) {
  const probed = await probe({ cwd, env });
  const provider = mapGentleProviderState(probed);
  if (provider !== PROVIDER.CONNECTED) {
    return {
      ok: false,
      error: providerError(provider, probed),
      provider,
      workflow: emptyGentleWorkflow({ provider })
    };
  }

  const sdd = runCommand(["sdd-status"], { cwd, env, timeoutMs, spawn, command });
  const workflow = sdd.ok
    ? { ...mapSddStatusToWorkflow(sdd.payload), provider }
    : emptyGentleWorkflow({ provider });

  const reviewRun = runCommand([...REVIEW_STATUS_ARGS], {
    cwd, env, timeoutMs, spawn, command, strict: true
  });
  if (reviewRun.ok) {
    const mapped = mapOfficialReviewStatus(reviewRun.payload);
    if (mapped.ok) applyOfficialReview(workflow, mapped);
  }

  if (!sdd.ok && workflow.kind === WORKFLOW_KIND.NONE && workflow.review == null) {
    return {
      ok: false,
      error: sdd.error ?? "gentle_sdd_unavailable",
      provider,
      workflow
    };
  }
  return {
    ok: true,
    error: sdd.ok ? null : (sdd.error ?? "gentle_sdd_unavailable"),
    provider,
    workflow
  };
}
