import { createExecutionAdapter, parseNdjsonLine } from "./create-execution-adapter.js";
import { verifyCodexSubscriptionAuth } from "../../architect/architect-codex.js";
import { codexAgentMessageText } from "../codex-agent-message.js";
import { assertReadOnlyExclusive } from "../run-permissions.js";
import { isReadOnlyPermissions, verifyCodexReadOnlySandbox } from "../readonly-containment.js";

const EXECUTABLE = "codex";

function buildCodexPermissionsArgs(permissions = []) {
  const normalized = new Set(permissions.map((entry) => String(entry).toLowerCase()));

  if (
    normalized.has("yolo")
    || normalized.has("dangerously-skip-permissions")
    || normalized.has("dangerously-bypass-approvals-and-sandbox")
  ) {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }

  // Safe headless default for the *installed* Codex CLI:
  // `--approve-for-me` alone selects the workspace-write sandbox and
  // auto-reviews approvals (non-interactive). Combining
  // `--sandbox workspace-write` with `--approve-for-me` is rejected by
  // the real parser (`cannot be used with`). This flag fix is CLI
  // compatibility only — not verified_effective containment.
  return ["--approve-for-me"];
}

// Read-only: Codex's own read-only sandbox, never --approve-for-me (workspace-write)
// and never a dangerous bypass. --ignore-user-config keeps a user config.toml from
// loosening the policy (auth still resolves through CODEX_HOME).
function buildCodexReadOnlyArgs() {
  return ["--sandbox", "read-only", "--ignore-user-config"];
}

function buildCodexLaunch({ task, cwd, model, permissions = [] }) {
  const readOnly = isReadOnlyPermissions(permissions);
  if (readOnly) assertReadOnlyExclusive(permissions);
  const args = [
    "exec",
    "--json",
    ...(readOnly ? buildCodexReadOnlyArgs() : buildCodexPermissionsArgs(permissions)),
    task
  ];

  if (model) {
    args.unshift("--model", model);
  }

  return {
    command: EXECUTABLE,
    args,
    cwd,
    env: process.env
  };
}

function parseCodexEventLine(line) {
  const parsed = parseNdjsonLine(line);
  if (!parsed || typeof parsed !== "object") return null;

  // `codex exec --json` reports each assistant message as a completed item. Mapping it to
  // an assistant event feeds the transcript, so the last message becomes the run summary.
  // Other items (command_execution, ...) keep falling through to the generic system event.
  if (codexAgentMessageText(parsed) !== null) {
    return { type: "assistant", text: parsed.item.text };
  }

  if (parsed.type === "tool" || parsed.type === "tool_call") {
    return {
      type: "tool_call",
      tool_name: parsed.tool ?? parsed.name ?? "unknown",
      status: parsed.status ?? "started"
    };
  }

  if (parsed.usage || parsed.token_usage) {
    const usage = parsed.usage ?? parsed.token_usage;
    return {
      type: "usage",
      inputTokens: usage.input_tokens ?? usage.input ?? null,
      outputTokens: usage.output_tokens ?? usage.output ?? null,
      totalTokens: usage.total_tokens ?? usage.total ?? null,
      cost: usage.cost ?? null
    };
  }

  return parsed;
}

export async function preflightCodex(context = {}) {
  const { verifyAuth = verifyCodexSubscriptionAuth, verifyReadOnlySandbox = verifyCodexReadOnlySandbox } = context;
  if (isReadOnlyPermissions(context.permissions)) await verifyReadOnlySandbox({ cwd: context.cwd });
  return verifyAuth(context);
}

export default createExecutionAdapter({
  id: "codex",
  label: "Codex",
  executable: EXECUTABLE,
  capabilities: {
    structuredEvents: true,
    tokens: true,
    diff: false,
    cancel: true,
    transcript: true,
    reviewCompatible: true,
    permissionModes: ["yolo"]
  },
  buildLaunch: buildCodexLaunch,
  parseEventLine: parseCodexEventLine,
  preflight: preflightCodex
});
