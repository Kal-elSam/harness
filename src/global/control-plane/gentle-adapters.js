/**
 * Read-only Gentle adapters for control-plane workflow/review.
 * Negotiate capabilities before any workflow fetch. Never invent authority.
 */
import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { probeGentle, resolveGentleBinaryPath } from "../observability/gentle-probe.js";
import { WORKFLOW_KIND, PROVIDER } from "./constants.js";
import {
  emptyGentleWorkflow,
  mapGentleProviderState,
  providerError
} from "./provider.js";
import {
  argvFromBootstrap,
  bootstrapCommandFromProbe,
  mapOfficialReviewStatus
} from "./review-status.js";
import {
  SDD_STATUS_ARGS,
  applySddProjection,
  mapOfficialSddStatus
} from "./sdd-status.js";

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

function resolvedGentleBinary(probed, command) {
  if (typeof command === "string" && isAbsolute(command)) return command;
  const path = probed?.evidence?.find((row) => row?.kind === "binary")?.path;
  return typeof path === "string" && isAbsolute(path) ? path : resolveGentleBinaryPath();
}

export function runGentleCommand(args, {
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawn = spawnSync,
  command,
  strict = false
} = {}) {
  try {
    if (typeof command !== "string" || !isAbsolute(command)) {
      return { ok: false, error: "gentle_incompatible", payload: null };
    }
    const result = spawn(command, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 2 * 1024 * 1024,
      shell: false
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

  const parsed = argvFromBootstrap(bootstrapCommandFromProbe(probed), {
    repo: cwd ?? process.cwd(),
    binaryPath: resolvedGentleBinary(probed, command)
  });
  if (!parsed.ok) {
    const incompatible = PROVIDER.INCOMPATIBLE;
    return {
      ok: false, error: "gentle_incompatible", provider: incompatible,
      workflow: emptyGentleWorkflow({ provider: incompatible })
    };
  }

  const workflow = emptyGentleWorkflow({ provider });
  const sdd = runCommand([...SDD_STATUS_ARGS], {
    cwd, env, timeoutMs, spawn, command: parsed.binary, strict: true
  });
  if (sdd.ok) {
    const mappedSdd = mapOfficialSddStatus(sdd.payload);
    if (mappedSdd.ok) applySddProjection(workflow, mappedSdd.projection);
  }

  const reviewRun = runCommand(parsed.argv, {
    cwd, env, timeoutMs, spawn, command: parsed.binary, strict: true
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
