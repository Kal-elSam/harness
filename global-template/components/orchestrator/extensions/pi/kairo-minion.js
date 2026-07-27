/**
 * Kairo Pi extension under ~/.harness (explicit --extension load only).
 * Children spawn with --no-extensions (no recursive depth).
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MINION_CONCURRENCY = 2;
export const MINION_ABORT_GRACE_MS = 5_000;
export const MINION_TOOLS = "read,grep,find,ls";
export const GENERIC_MINION_TASK =
  "Read brief JSON at KAIRO_MINION_BRIEF. Return JSON only: "
  + "{\"taskId\",\"summary\",\"decisions\",\"files\",\"risks\",\"evidence\",\"usage\",\"compact\"}.";

export function createConcurrencyGate(limit = MINION_CONCURRENCY) {
  let inFlight = 0;
  const queue = [];
  return {
    async run(fn) {
      if (inFlight >= limit) await new Promise((r) => queue.push(r));
      inFlight += 1;
      try { return await fn(); }
      finally {
        inFlight -= 1;
        queue.shift()?.();
      }
    },
    get active() { return inFlight; }
  };
}

const defaultGate = createConcurrencyGate();

export function buildMinionArgs() {
  return [
    "--mode", "json", "-p", "--no-session",
    "--tools", MINION_TOOLS, "--no-extensions",
    GENERIC_MINION_TASK
  ];
}

function assistantText(message) {
  if (!Array.isArray(message?.content)) return null;
  const text = message.content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text).join("");
  return text.trim() === "" ? null : text;
}

function normalizeUsage(usage, acc = {}) {
  if (!usage || typeof usage !== "object") return acc;
  const add = (key, ...alts) => {
    for (const a of alts) {
      if (Number.isFinite(usage[a])) { acc[key] = (acc[key] ?? 0) + usage[a]; return; }
    }
  };
  add("inputTokens", "input", "inputTokens", "input_tokens");
  add("outputTokens", "output", "outputTokens", "output_tokens");
  if (Number.isFinite(usage.totalTokens)) acc.totalTokens = (acc.totalTokens ?? 0) + usage.totalTokens;
  else if (Number.isFinite(usage.total)) acc.totalTokens = (acc.totalTokens ?? 0) + usage.total;
  const cost = typeof usage.cost === "number" ? usage.cost
    : typeof usage.cost?.total === "number" ? usage.cost.total : null;
  if (cost != null) acc.cost = (acc.cost ?? 0) + cost;
  return acc;
}

function failHandoff(message) {
  const err = new Error(message);
  err.code = "invalid_handoff";
  throw err;
}

/** Last assistant message_end + aggregated turn_end usage. No raw streams retained. */
export function parseMinionNdjson(stdout) {
  let lastText = null;
  let usage = {};
  for (const line of String(stdout ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { continue; }
    if (parsed?.type === "message_end" && parsed.message?.role === "assistant") {
      const text = assistantText(parsed.message);
      if (text) lastText = text;
    }
    if (parsed?.type === "turn_end" && parsed.usage) usage = normalizeUsage(parsed.usage, usage);
  }
  return { text: lastText, usage: Object.keys(usage).length ? usage : null };
}

export function parseMinionResultJson(text, { taskId }) {
  if (typeof text !== "string" || !text.trim()) failHandoff("Minion returned no assistant message.");
  let parsed;
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    parsed = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch {
    failHandoff("Minion returned invalid JSON handoff.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    failHandoff("Minion handoff must be an object.");
  }
  if (parsed.taskId && parsed.taskId !== taskId) failHandoff("Minion handoff taskId mismatch.");
  if (typeof parsed.summary !== "string" || !parsed.summary.trim()) {
    failHandoff("Minion handoff requires summary.");
  }
  for (const key of ["prompt", "stdout", "stderr", "transcript", "conversation", "toolArgs"]) {
    if (key in parsed) failHandoff(`Minion handoff forbids field "${key}".`);
  }
  return {
    taskId,
    summary: parsed.summary.trim(),
    decisions: (parsed.decisions ?? []).map(String),
    files: (parsed.files ?? []).map(String),
    risks: (parsed.risks ?? []).map(String),
    evidence: (parsed.evidence ?? []).map(String),
    usage: {
      inputTokens: parsed.usage?.inputTokens ?? null,
      outputTokens: parsed.usage?.outputTokens ?? null,
      totalTokens: parsed.usage?.totalTokens ?? null,
      cost: parsed.usage?.cost ?? null
    },
    compact: Boolean(parsed.compact)
  };
}

function safeKill(child, signal) {
  try { if (!child.killed) child.kill(signal); } catch { /* ignore */ }
}

export function spawnMinionProcess({
  brief, cwd, env = process.env, signal = null, spawnImpl = spawn,
  abortGraceMs = MINION_ABORT_GRACE_MS, gate = defaultGate
} = {}) {
  return gate.run(async () => {
    const dir = await mkdtemp(join(tmpdir(), "kairo-minion-"));
    const briefPath = join(dir, "brief.json");
    let child = null;
    let abortListener = null;
    let killTimer = null;
    try {
      await writeFile(briefPath, JSON.stringify(brief), { mode: 0o600 });
      child = spawnImpl("pi", buildMinionArgs(), {
        cwd, env: { ...env, KAIRO_MINION_BRIEF: briefPath },
        shell: false, stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      child.stdout?.on("data", (c) => { stdout += c; });
      child.stderr?.on("data", () => {});
      const closed = new Promise((resolve, reject) => {
        child.on("error", (error) => {
          const err = new Error(`Minion spawn failed: ${error.message}`);
          err.code = "invalid_handoff";
          reject(err);
        });
        child.on("close", (status, sig) => resolve({ status, signal: sig, stdout }));
      });
      if (signal) {
        const onAbort = () => {
          safeKill(child, "SIGTERM");
          killTimer = setTimeout(() => safeKill(child, "SIGKILL"), abortGraceMs);
        };
        if (signal.aborted) onAbort();
        else {
          abortListener = onAbort;
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }
      const result = await closed;
      if (signal?.aborted || result.signal) failHandoff("Minion aborted.");
      if (result.status !== 0) failHandoff(`Minion exited with status ${result.status}.`);
      const parsed = parseMinionNdjson(result.stdout);
      const handoff = parseMinionResultJson(parsed.text, { taskId: brief.taskId });
      if (parsed.usage) {
        handoff.usage = {
          inputTokens: handoff.usage.inputTokens ?? parsed.usage.inputTokens ?? null,
          outputTokens: handoff.usage.outputTokens ?? parsed.usage.outputTokens ?? null,
          totalTokens: handoff.usage.totalTokens ?? parsed.usage.totalTokens ?? null,
          cost: handoff.usage.cost ?? parsed.usage.cost ?? null
        };
      }
      return handoff;
    } finally {
      if (abortListener && signal) signal.removeEventListener("abort", abortListener);
      if (killTimer) clearTimeout(killTimer);
      await rm(dir, { recursive: true, force: true });
    }
  });
}

export default function registerKairoMinion(pi) {
  pi.registerTool({
    name: "kairo_delegate",
    label: "Kairo Delegate",
    description: "Delegate a bounded read-only subtask to an ephemeral Pi minion.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        parentTaskId: { type: "string" },
        objective: { type: "string" },
        constraints: { type: "array", items: { type: "string" } },
        admittedPaths: { type: "array", items: { type: "string" } },
        exitCriteria: { type: "array", items: { type: "string" } }
      },
      required: ["taskId", "parentTaskId", "objective"]
    },
    async execute(_id, params, signal) {
      return spawnMinionProcess({
        brief: {
          taskId: params.taskId,
          parentTaskId: params.parentTaskId,
          objective: params.objective,
          constraints: params.constraints ?? [],
          admittedPaths: params.admittedPaths ?? [],
          exitCriteria: params.exitCriteria ?? []
        },
        cwd: process.cwd(),
        signal
      });
    }
  });
}
