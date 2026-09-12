import { createExecutionAdapter, parseNdjsonLine } from "./create-execution-adapter.js";
import { isExecutableAvailable } from "../../cli-probe.js";

const EXECUTABLE = "opencode";

// Verified live (`opencode run --format json`) against a real account: the
// CLI genuinely emits parseable NDJSON events — step_start/step_finish,
// tool_use (with real tool name + status), text, and error — including
// real per-step `tokens` {input, output, reasoning, cache} and `cost` on
// step_finish. That earlier "does not emit auditable structured events"
// claim was wrong; structuredEvents below is now an accurate capability.
//
// It stays `launchable: false` anyway, for a different, harder reason:
// this adapter is shared by both OpenCode Go (subscription, $10/mo) and
// OpenCode Zen (PAYG) — same `opencode` executable, same event shapes,
// no field in any event that names which product tier actually served
// the request. A live invocation with `-m opencode/<id>` for a model that
// exists on BOTH tiers was confirmed to be ambiguous — no way to prove
// after the fact whether it ran on Go or silently billed against Zen. A
// second invocation with the Go-specific `opencode-go/<id>` prefix simply
// hung. Per explicit decision: Kairo must not route real tasks through
// this adapter until it can prove, from the run's own evidence, both (1)
// the effective provider actually used was opencode-go, and (2) Zen was
// not touched. Until that receipt-level proof exists, this stays blocked
// — no more paid trial invocations to "just check" this again.
function checkOpencodeAvailability(context = {}) {
  const available = isExecutableAvailable(EXECUTABLE, { env: context.env ?? process.env });
  if (!available) {
    return {
      available: false, compatible: false, launchable: false,
      reason: `OpenCode CLI "${EXECUTABLE}" is not on PATH.`
    };
  }
  return {
    available: true, compatible: true, launchable: false,
    reason: "OpenCode Go/Zen share one executable with no per-event way to prove which product tier actually served a run — blocked until that provider-isolation evidence exists."
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
  parseEventLine: parseOpencodeEventLine
});
