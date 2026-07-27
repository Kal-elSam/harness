/**
 * Kairo Pi extension under ~/.harness (explicit --extension load only).
 * Parent: kairo_delegate + cascade cancel. Child: path + budget guards.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, realpath, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const MINION_CONCURRENCY = 2;
export const MINION_ABORT_GRACE_MS = 5_000;
export const MINION_TOOLS = "read,grep,find,ls";
export const MAX_TASK_ATTEMPTS = 2;
export const BUDGET_COMPACT_RATIO = 0.7;
export const BUDGET_STOP_RATIO = 0.9;
export const PATH_DENIED = "KAIRO_PATH_DENIED";
export const BUDGET_EXCEEDED = "budget_exceeded";
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

export function minionStatusPath(briefPath) {
  return `${briefPath}.status.json`;
}

/** Cancelable concurrency: cancel rejects queued work and blocks new runs. */
export function createConcurrencyGate(limit = MINION_CONCURRENCY) {
  let inFlight = 0;
  const queue = [];
  let cancelled = false;
  const abortErr = () => Object.assign(new Error("Minion cancelled."), { code: "aborted" });
  return {
    get cancelled() { return cancelled; },
    get active() { return inFlight; },
    get queued() { return queue.length; },
    cancel() {
      cancelled = true;
      while (queue.length) queue.shift().reject(abortErr());
    },
    async run(fn) {
      if (cancelled) throw abortErr();
      if (inFlight >= limit) {
        await new Promise((resolve, reject) => queue.push({ resolve, reject }));
        if (cancelled) throw abortErr();
      }
      inFlight += 1;
      try { return await fn(); }
      finally {
        inFlight -= 1;
        queue.shift()?.resolve();
      }
    }
  };
}

export function createProcessRegistry({ abortGraceMs = MINION_ABORT_GRACE_MS } = {}) {
  const active = new Set();
  let cancelled = false;
  return {
    get cancelled() { return cancelled; },
    get size() { return active.size; },
    track(child) {
      if (cancelled) {
        safeKill(child, "SIGTERM");
        return false;
      }
      active.add(child);
      child.on?.("close", () => active.delete(child));
      return true;
    },
    async cancelAll() {
      cancelled = true;
      for (const child of [...active]) safeKill(child, "SIGTERM");
      if (abortGraceMs > 0) await new Promise((r) => setTimeout(r, abortGraceMs));
      for (const child of [...active]) safeKill(child, "SIGKILL");
    }
  };
}

const defaultGate = createConcurrencyGate();
const defaultRegistry = createProcessRegistry();

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

/** Ratio from percent (0–100) or tokens/contextWindow. */
export function contextUsageRatio(usage) {
  if (!usage || typeof usage !== "object") return 0;
  if (Number.isFinite(usage.percent)) return Math.max(0, usage.percent) / 100;
  const tokens = Number(usage.tokens ?? usage.contextTokens ?? 0);
  const limit = Number(usage.contextWindow ?? usage.contextLimit ?? 0);
  return limit > 0 ? Math.max(0, tokens) / limit : 0;
}

export function evaluateContextBudget(usage, {
  compactRatio = BUDGET_COMPACT_RATIO, stopRatio = BUDGET_STOP_RATIO
} = {}) {
  const ratio = contextUsageRatio(usage);
  if (ratio >= stopRatio) return { ratio, action: "stop" };
  if (ratio >= compactRatio) return { ratio, action: "compact" };
  return { ratio, action: "continue" };
}

export function createBudgetAttemptState() {
  return { compactedThisAttempt: false, compactObserved: false, stopReason: null };
}

async function writeMinionStatus(statusPath, payload) {
  if (!statusPath) return;
  await writeFile(statusPath, JSON.stringify(payload), { mode: 0o600 });
}

/** Child: after each turn, compact once in [70,90) or abort at ≥90%. */
export function registerBudgetGuard(pi, {
  statusPath = null,
  state = createBudgetAttemptState(),
  compactRatio = BUDGET_COMPACT_RATIO,
  stopRatio = BUDGET_STOP_RATIO
} = {}) {
  const persist = async () => {
    if (!state.stopReason && !state.compactObserved) return;
    await writeMinionStatus(statusPath, {
      code: state.stopReason, compact: state.compactObserved
    });
  };

  pi.on("compaction_end", async () => {
    state.compactObserved = true;
    await persist();
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (state.stopReason) return;
    const usage = typeof ctx?.getContextUsage === "function" ? ctx.getContextUsage() : null;
    const { action } = evaluateContextBudget(usage, { compactRatio, stopRatio });
    if (action === "continue") return;
    if (action === "compact") {
      if (state.compactedThisAttempt) return;
      state.compactedThisAttempt = true;
      if (typeof ctx?.compact === "function") {
        ctx.compact({
          onComplete: async () => {
            state.compactObserved = true;
            await persist();
          },
          onError: () => {}
        });
      }
      return;
    }
    state.stopReason = BUDGET_EXCEEDED;
    await persist();
    if (typeof ctx?.abort === "function") ctx.abort();
  });

  return state;
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

function failHandoff(message, code = "invalid_handoff") {
  const err = new Error(message);
  err.code = code;
  throw err;
}

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
  try { if (child.exitCode == null && child.signalCode == null) child.kill(signal); } catch { /* ignore */ }
}

async function readMinionStatus(statusPath) {
  try {
    return JSON.parse(await readFile(statusPath, "utf8"));
  } catch {
    return null;
  }
}

export function spawnMinionProcess({
  brief, cwd, env = process.env, signal = null, spawnImpl = spawn,
  abortGraceMs = MINION_ABORT_GRACE_MS, gate = defaultGate,
  registry = defaultRegistry, extensionPath = resolveSelfExtensionPath(),
  readStatus = readMinionStatus
} = {}) {
  return gate.run(async () => {
    if (registry.cancelled || gate.cancelled || signal?.aborted) {
      failHandoff("Minion cancelled.", "aborted");
    }
    const dir = await mkdtemp(join(tmpdir(), "kairo-minion-"));
    const briefPath = join(dir, "brief.json");
    const statusPath = minionStatusPath(briefPath);
    let child = null;
    let abortListener = null;
    let killTimer = null;
    try {
      await writeFile(briefPath, JSON.stringify(brief), { mode: 0o600 });
      child = spawnImpl("pi", buildMinionArgs({ extensionPath }), {
        cwd, env: { ...env, KAIRO_MINION_BRIEF: briefPath },
        shell: false, stdio: ["ignore", "pipe", "pipe"]
      });
      if (!registry.track(child)) failHandoff("Minion cancelled.", "aborted");
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
      const status = await readStatus(statusPath);
      if (status?.code === BUDGET_EXCEEDED) {
        const err = new Error("Context budget exceeded.");
        err.code = BUDGET_EXCEEDED;
        err.compact = Boolean(status.compact);
        throw err;
      }
      if (signal?.aborted || result.signal || registry.cancelled) {
        failHandoff("Minion aborted.", "aborted");
      }
      if (result.status !== 0) failHandoff(`Minion exited with status ${result.status}.`);
      const parsed = parseMinionNdjson(result.stdout);
      const handoff = parseMinionResultJson(parsed.text, { taskId: brief.taskId });
      if (status?.compact) handoff.compact = true;
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

/** Retry transient failures only; never cancel or budget_exceeded. */
export async function runMinionWithRetries(opts, {
  maxAttempts = MAX_TASK_ATTEMPTS
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await spawnMinionProcess(opts);
    } catch (error) {
      lastError = error;
      if (error?.code === BUDGET_EXCEEDED || error?.code === "aborted") throw error;
      if (opts.signal?.aborted) failHandoff("Minion aborted.", "aborted");
      if (attempt >= maxAttempts) throw error;
    }
  }
  throw lastError;
}

function registerDelegate(pi, {
  gate = createConcurrencyGate(),
  registry = createProcessRegistry()
} = {}) {
  const cascade = async () => {
    gate.cancel();
    await registry.cancelAll();
  };
  pi.on("session_shutdown", cascade);

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
      if (signal) {
        const onAbort = () => { void cascade(); };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      return runMinionWithRetries({
        brief: {
          taskId: params.taskId,
          parentTaskId: params.parentTaskId,
          objective: params.objective,
          constraints: params.constraints ?? [],
          admittedPaths: params.admittedPaths ?? [],
          exitCriteria: params.exitCriteria ?? []
        },
        cwd: process.cwd(),
        signal, gate, registry
      });
    }
  });
  return { gate, registry, cascade };
}

export default function registerKairoMinion(pi, env = process.env) {
  if (isChildMinionMode(env)) {
    const briefPath = env.KAIRO_MINION_BRIEF;
    registerPathGuard(pi, { briefPath });
    registerBudgetGuard(pi, { statusPath: minionStatusPath(briefPath) });
    return { mode: "child" };
  }
  registerDelegate(pi);
  return { mode: "parent" };
}
