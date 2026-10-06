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

export const GENTLE_READ_TIMEOUT_MS = 8_000;

const TIMEOUT = /timeout|timed out|etimedout/i;
const MUTATING_VERB = /^(start|grant|decline|acknowledge|consent|disable|enable|abandon|invalidate|recover|capture|capture-unachievable|finalize)/;

const unavailable = (error, provider = PROVIDER.UNAVAILABLE) => ({
  provider, mappedStatus: null, rddMode: "unknown", error
});

function probeError(probed) {
  if (probed?.state === "missing") return "gentle_binary_missing";
  const blob = `${probed?.error ?? ""} ${(probed?.diagnostics ?? []).join(" ")}`;
  if (TIMEOUT.test(blob)) return "gentle_timeout";
  return "gentle_unavailable";
}

function runError(code) {
  if (typeof code !== "string" || !code) return "gentle_reader_failed";
  if (/^gentle_(nonzero_status|parse_failed|incompatible)$/.test(code)) return code;
  if (TIMEOUT.test(code)) return "gentle_timeout";
  return "gentle_spawn_failed";
}

async function safeRddMode(readRddMode, projectRoot) {
  if (typeof readRddMode !== "function") return "unknown";
  try {
    return (await readRddMode({ projectRoot })) ?? "unknown";
  } catch {
    return "unknown";
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
      const run = runCommand([...parsed.argv], {
        cwd: projectRoot, env, timeoutMs, spawn: deps.spawn, command: parsed.binary, strict: true
      });
      if (!run?.ok) {
        return { provider, mappedStatus: null, rddMode: "unknown", error: runError(run?.error) };
      }
      const mapped = mapOfficialReviewStatus(run.payload);
      if (!mapped.ok) {
        return { provider: PROVIDER.INCOMPATIBLE, mappedStatus: null, rddMode: "unknown", error: mapped.error };
      }
      return {
        provider, mappedStatus: mapped, rddMode: await safeRddMode(deps.readRddMode, projectRoot), error: null
      };
    } catch {
      return unavailable("gentle_reader_failed");
    }
  };
}
