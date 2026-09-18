import { createExecutionAdapter, parseNdjsonLine } from "./create-execution-adapter.js";
import { isExecutableAvailable } from "../../cli-probe.js";

const EXECUTABLE = "opencode";

// Real, reproduced failure mode (2026-09-18): `opencode run -m
// opencode-go/<model>` genuinely hangs with ZERO stdout/stderr output for
// several real models, confirmed live against a real account — not a
// stale finding. Some other real models fail fast and cleanly instead
// (e.g. a real 403 region-lock error came back instantly). Since a real,
// legitimate task can genuinely run for minutes while still producing
// real output, this is an IDLE timeout (reset on every real chunk, see
// run-supervisor.js), never an absolute one — only genuine silence this
// long trips it.
export const OPENCODE_IDLE_TIMEOUT_MS = 60_000;

// Verified live (`opencode run --format json`) against a real account: the
// CLI genuinely emits parseable NDJSON events — step_start/step_finish,
// tool_use (with real tool name + status), text, and error — including
// real per-step `tokens` {input, output, reasoning, cache} and `cost` on
// step_finish. That earlier "does not emit auditable structured events"
// claim was wrong; structuredEvents below is now an accurate capability.
//
// `launchable: true` now — for Go specifically. This adapter is shared by
// both OpenCode Go (subscription, $10/mo) and OpenCode Zen (PAYG); the
// real, unresolved billing-attribution gap between them (no per-event way
// to prove which tier served a request) is still real, but
// execution-router.js's checkCandidate refuses "opencode-zen" outright
// regardless of this flag, so this flag only ever matters for
// "opencode-go" in practice — and for Go, that gap doesn't apply (its
// own dedicated `/zen/go/*` endpoint is a real, separate gateway, see
// model-candidate-catalog.js's own doc). The real remaining risk was a
// live-confirmed hang for some Go models, not billing — mitigated by this
// adapter's own idleTimeoutMs (see above) converting a genuine hang into
// a bounded real failure instead of an indefinite one.
function checkOpencodeAvailability(context = {}) {
  const available = isExecutableAvailable(EXECUTABLE, { env: context.env ?? process.env });
  if (!available) {
    return {
      available: false, compatible: false, launchable: false,
      reason: `OpenCode CLI "${EXECUTABLE}" is not on PATH.`
    };
  }
  return {
    available: true, compatible: true, launchable: true,
    reason: null
  };
}

function buildOpencodeLaunch({ task, cwd, model, permissions = [] }) {
  // Not the adapter's call to make: which provider prefix ("opencode/" vs
  // "opencode-go/") is safe for a given model id is exactly the unresolved
  // question above. Whatever fully-qualified model ref the caller supplies
  // is passed through unmodified, same as codex.js/claude.js do.
  const args = ["run", "--format", "json"];
  const normalized = permissions.map((entry) => String(entry).toLowerCase());
  if (normalized.includes("yolo") || normalized.includes("force") || normalized.includes("all")) {
    args.push("--auto");
  }
  if (model) args.push("--model", model);
  args.push(task);
  return { command: EXECUTABLE, args, cwd, env: process.env };
}

/**
 * Verified against real captured output (`opencode run --format json`),
 * not guessed: tool_use/tool -> tool_call, step_finish's real per-step
 * tokens+cost -> usage, error -> passed through raw (no invented shape
 * for a case never seen with a matching one here). Everything else
 * (step_start, text) passes through raw, same fallback as the other
 * adapters' parsers.
 */
export function parseOpencodeEventLine(line) {
  const parsed = parseNdjsonLine(line);
  if (!parsed || typeof parsed !== "object") return null;

  if (parsed.type === "tool_use" && parsed.part?.type === "tool") {
    return {
      type: "tool_call",
      tool_name: parsed.part.tool ?? "unknown",
      status: parsed.part.state?.status ?? "started"
    };
  }

  if (parsed.type === "step_finish" && parsed.part?.tokens) {
    const tokens = parsed.part.tokens;
    return {
      type: "usage",
      inputTokens: tokens.input ?? null,
      outputTokens: tokens.output ?? null,
      totalTokens: tokens.total ?? null,
      cost: parsed.part.cost ?? null
    };
  }

  return parsed;
}

export default createExecutionAdapter({
  id: "opencode",
  label: "OpenCode",
  executable: EXECUTABLE,
  capabilities: {
    structuredEvents: true,
    tokens: true,
    diff: false,
    cancel: true,
    transcript: true,
    permissionModes: ["force", "yolo"]
  },
  checkAvailability: checkOpencodeAvailability,
  buildLaunch: buildOpencodeLaunch,
  parseEventLine: parseOpencodeEventLine,
  idleTimeoutMs: OPENCODE_IDLE_TIMEOUT_MS
});
