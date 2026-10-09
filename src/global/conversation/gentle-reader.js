/**
 * Production Gentle reader for the conversation service.
 *
 * Read-only by construction: it probes capabilities and runs exactly the
 * `gentle-ai review status ... --next-transition` bootstrap the probe
 * advertises (a preflight that never starts, grants, declines, acknowledges
 * or otherwise mutates review authority). Every failure is a typed result;
 * nothing here throws. The result is project context only: association in
 * `composeTaskResult` deliberately never turns a project receipt into task
 * approval.
 */
import { PROVIDER } from "../control-plane/constants.js";
import { runGentleCommand } from "../control-plane/gentle-adapters.js";
import { mapGentleProviderState } from "../control-plane/provider.js";
import {
  argvFromBootstrap, bootstrapCommandFromProbe, mapOfficialReviewStatus
} from "../control-plane/review-status.js";
import { probeGentle, resolveGentleBinaryPath } from "../observability/gentle-probe.js";
import { createGuardedRunner, createRddModeReader, mapRunError } from "./rdd-mode-reader.js";

export const GENTLE_READ_TIMEOUT_MS = 8_000;

const TIMEOUT = /timeout|timed out|etimedout/i;
const MUTATING_VERB = /^(start|grant|decline|acknowledge|consent|disable|enable|abandon|invalidate|recover|capture|capture-unachievable|finalize)/;

const unavailable = (error, provider = PROVIDER.UNAVAILABLE) => ({
  provider, mappedStatus: null, rddMode: "unknown", rddSource: null, error
});

function probeError(probed) {
  if (probed?.state === "missing") return "gentle_binary_missing";
  const blob = `${probed?.error ?? ""} ${(probed?.diagnostics ?? []).join(" ")}`;
  if (TIMEOUT.test(blob)) return "gentle_timeout";
  return "gentle_unavailable";
}

const RDD_MODES = new Set(["on", "off"]);

// `unknown` never means permission: only an exact "on"/"off" survives.
const modeOf = (value) => (typeof value === "string" && RDD_MODES.has(value) ? value : "unknown");

// Accepts the structured production result or a legacy plain string from fakes.
async function readMode(readRddMode, input) {
  const none = { rddMode: "unknown", rddSource: null, rddError: null };
  if (typeof readRddMode !== "function") return none;
  try {
    const out = await readRddMode(input);
    if (out != null && typeof out === "object") {
      return {
        rddMode: modeOf(out.mode),
        rddSource: typeof out.source === "string" ? out.source : null,
        rddError: typeof out.error === "string" ? out.error : null
      };
    }
    return { ...none, rddMode: modeOf(out) };
  } catch {
    return none;
  }
}

/**
 * @param {{
 *   probe?: Function, runCommand?: Function, readRddMode?: Function,
 *   env?: object, timeoutMs?: number, spawn?: Function
 * }} [deps] injection seam; tests stay offline with simulated Gentle.
 */
export function createGentleReader(deps = {}) {
  const probe = deps.probe ?? probeGentle;
  const runCommand = deps.runCommand ?? runGentleCommand;
  const env = deps.env ?? process.env;
  const timeoutMs = deps.timeoutMs ?? GENTLE_READ_TIMEOUT_MS;
  // Every command goes through the allow-list guard (read-only shapes only).
  const guarded = createGuardedRunner(runCommand);
  // The production mode reader is the default only when nothing is faked; tests
  // that inject probe/runCommand/spawn stay offline unless they opt in.
  const injected = deps.probe || deps.runCommand || deps.spawn;
  const readRddMode = deps.readRddMode
    ?? (!injected || deps.useProductionRddReader
      ? createRddModeReader({ runCommand, env, timeoutMs, spawn: deps.spawn })
      : undefined);

  return async function readGentleContext({ projectRoot } = {}) {
    try {
      const probed = await probe({ cwd: projectRoot, env });
      const provider = mapGentleProviderState(probed);
      if (provider !== PROVIDER.CONNECTED) {
        return unavailable(provider === PROVIDER.UNAVAILABLE ? probeError(probed) : "gentle_incompatible", provider);
      }
      const binaryPath = probed?.evidence?.find((row) => row?.kind === "binary")?.path
        ?? resolveGentleBinaryPath("gentle-ai", env);
      const parsed = argvFromBootstrap(bootstrapCommandFromProbe(probed), { repo: projectRoot, binaryPath });
      if (!parsed.ok || MUTATING_VERB.test(parsed.argv[1] ?? "") || parsed.argv[0] !== "review" || parsed.argv[1] !== "status") {
        return unavailable("gentle_incompatible", PROVIDER.INCOMPATIBLE);
      }
      const run = guarded([...parsed.argv], {
        cwd: projectRoot, env, timeoutMs, spawn: deps.spawn, command: parsed.binary, strict: true
      });
      if (!run?.ok) {
        return { provider, mappedStatus: null, rddMode: "unknown", rddSource: null, error: mapRunError(run?.error) };
      }
      const mapped = mapOfficialReviewStatus(run.payload);
      if (!mapped.ok) {
        return { provider: PROVIDER.INCOMPATIBLE, mappedStatus: null, rddMode: "unknown", error: mapped.error };
      }
      return {
        provider, mappedStatus: mapped, ...(await readMode(readRddMode, { projectRoot, binaryPath })), error: null
      };
    } catch {
      return unavailable("gentle_reader_failed");
    }
  };
}
