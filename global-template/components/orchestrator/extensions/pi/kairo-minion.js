/**
 * Kairo Pi extension under ~/.harness (explicit --extension load only).
 * Parent: kairo_delegate. Child (KAIRO_MINION_BRIEF): path guard only.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MINION_CONCURRENCY = 2;
export const MINION_ABORT_GRACE_MS = 5_000;
export const MINION_TOOLS = "read,grep,find,ls";
export const PATH_DENIED = "KAIRO_PATH_DENIED";
export const GUARDED_TOOLS = new Set(["read", "grep", "find", "ls"]);
export const GENERIC_MINION_TASK =
  "Read brief JSON at KAIRO_MINION_BRIEF. Return JSON only: "
  + "{\"taskId\",\"summary\",\"decisions\",\"files\",\"risks\",\"evidence\",\"usage\",\"compact\"}.";

export function resolveSelfExtensionPath() {
  return fileURLToPath(import.meta.url);
}

export function isChildMinionMode(env = process.env) {
  return typeof env.KAIRO_MINION_BRIEF === "string" && env.KAIRO_MINION_BRIEF.trim() !== "";
}

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

/** Child argv: no ambient discovery; load this extension for the path guard. */
export function buildMinionArgs({ extensionPath = resolveSelfExtensionPath() } = {}) {
  return [
    "--mode", "json", "-p", "--no-session",
    "--tools", MINION_TOOLS,
    "--no-extensions", "--extension", extensionPath,
    "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve",
    GENERIC_MINION_TASK
  ];
}

function hasDotDot(path) {
  return /(^|[\\/])\.\.([\\/]|$)/.test(String(path ?? ""));
}

export function extractToolPaths(input) {
  if (!input || typeof input !== "object") return [];
  const out = [];
  for (const key of ["path", "file", "target", "directory", "dir", "root"]) {
    if (typeof input[key] === "string" && input[key].trim()) out.push(input[key]);
  }
  for (const key of ["paths", "files"]) {
    if (!Array.isArray(input[key])) continue;
    for (const entry of input[key]) {
      if (typeof entry === "string" && entry.trim()) out.push(entry);
    }
  }
  return out;
}

export async function resolveAdmittedRoots(admittedPaths, cwd) {
  if (!Array.isArray(admittedPaths) || admittedPaths.length === 0) return null;
  const roots = [];
  for (const raw of admittedPaths) {
    if (typeof raw !== "string" || !raw.trim() || hasDotDot(raw)) return null;
    const abs = isAbsolute(raw) ? raw : resolve(cwd, raw);
    try { roots.push(await realpath(abs)); }
    catch { return null; }
  }
  return roots.length ? roots : null;
}

export async function isPathAdmitted(targetPath, roots, cwd) {
  if (!Array.isArray(roots) || roots.length === 0) return false;
  if (typeof targetPath !== "string" || !targetPath.trim() || hasDotDot(targetPath)) return false;
  const abs = isAbsolute(targetPath) ? targetPath : resolve(cwd, targetPath);
  let real;
  try { real = await realpath(abs); }
  catch { return false; }
  for (const root of roots) {
    if (real === root) return true;
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
    if (real.startsWith(prefix)) return true;
  }
  return false;
}

export async function evaluateToolPathAccess({
  toolName, input, admittedPaths, cwd = process.cwd()
}) {
  if (!GUARDED_TOOLS.has(toolName)) return { allow: true };
  const roots = await resolveAdmittedRoots(admittedPaths, cwd);
  if (!roots) return { allow: false, reason: PATH_DENIED };
  const paths = extractToolPaths(input);
  const targets = paths.length ? paths : [cwd];
  for (const target of targets) {
    if (!(await isPathAdmitted(target, roots, cwd))) {
      return { allow: false, reason: PATH_DENIED };
    }
  }
  return { allow: true };
}

export function registerPathGuard(pi, {
  briefPath = process.env.KAIRO_MINION_BRIEF,
  cwd = process.cwd(),
  loadBrief = async (path) => JSON.parse(await readFile(path, "utf8"))
} = {}) {
  let admittedPromise = null;
  const loadAdmitted = () => {
    if (!admittedPromise) {
      admittedPromise = (async () => {
        if (typeof briefPath !== "string" || !briefPath.trim()) return [];
        try {
          const brief = await loadBrief(briefPath);
          return Array.isArray(brief?.admittedPaths) ? brief.admittedPaths : [];
        } catch {
          return [];
        }
      })();
    }
    return admittedPromise;
  };

  pi.on("tool_call", async (event) => {
    const toolName = event?.toolName ?? event?.name;
    if (!GUARDED_TOOLS.has(toolName)) return;
    const admittedPaths = await loadAdmitted();
    const verdict = await evaluateToolPathAccess({
      toolName, input: event?.input ?? {}, admittedPaths, cwd
    });
    if (!verdict.allow) return { block: true, reason: PATH_DENIED };
  });
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

/** Last assistant message_end + usage. Fail-closed on stream/stop errors (no raw payload). */
export function parseMinionNdjson(stdout) {
  let lastText = null;
  let usage = {};
  let streamError = null;
  for (const line of String(stdout ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { continue; }
    if (parsed?.type === "error") {
      streamError = "Minion stream error.";
      continue;
    }
    if (parsed?.type === "message_end" && parsed.message?.role === "assistant") {
      const stop = parsed.message.stopReason;
      if (stop === "error" || stop === "aborted") {
        streamError = `Minion stopReason ${stop}.`;
      } else {
        const text = assistantText(parsed.message);
        if (text) lastText = text;
      }
    }
    if (parsed?.type === "turn_end" && parsed.usage) usage = normalizeUsage(parsed.usage, usage);
  }
  if (streamError) failHandoff(streamError);
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
  abortGraceMs = MINION_ABORT_GRACE_MS, gate = defaultGate,
  extensionPath = resolveSelfExtensionPath()
} = {}) {
  return gate.run(async () => {
    const dir = await mkdtemp(join(tmpdir(), "kairo-minion-"));
    const briefPath = join(dir, "brief.json");
    let child = null;
    let abortListener = null;
    let killTimer = null;
    try {
      await writeFile(briefPath, JSON.stringify(brief), { mode: 0o600 });
      child = spawnImpl("pi", buildMinionArgs({ extensionPath }), {
        cwd, env: { ...env, KAIRO_MINION_BRIEF: briefPath },
        shell: false, stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      child.stdout?.on("data", (c) => { stdout += c; });
      child.stderr?.on("data", () => {});
      const closed = new Promise((resolveClose, reject) => {
        child.on("error", (error) => {
          const err = new Error(`Minion spawn failed: ${error.message}`);
          err.code = "invalid_handoff";
          reject(err);
        });
        child.on("close", (status, sig) => resolveClose({ status, signal: sig, stdout }));
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

function registerDelegate(pi) {
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

/** Parent registers delegate; child (brief env) registers path guard only. */
export default function registerKairoMinion(pi, env = process.env) {
  if (isChildMinionMode(env)) {
    registerPathGuard(pi);
    return { mode: "child" };
  }
  registerDelegate(pi);
  return { mode: "parent" };
}
