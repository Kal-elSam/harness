import { createHash } from "node:crypto";
import { readdir as defaultReaddir, readFile as defaultReadFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

// Codex wrapper subagents (team-*-codex) are deliberately absent: their Claude
// transcript only measures the wrapper; the real work lives in the Codex rollout.
export const DEFAULT_AGENT_ROLE_MAP = Object.freeze({
  "team-explorer": "Explorer",
  "team-builder": "Builder",
  "team-test-runner": "Tester",
  "review-risk": "Reviewer",
  "review-resilience": "Reviewer",
  "review-readability": "Reviewer",
  "review-reliability": "Reviewer",
  "jd-judge-a": "Reviewer",
  "jd-judge-b": "Reviewer",
  "jd-fix-agent": "Builder",
  "team-researcher": "Explorer"
});

export const CODEX_WRAPPER_ROLE_MAP = Object.freeze({
  "team-builder-codex": "Builder",
  "team-reviewer-codex": "Reviewer",
  "team-plan-critic-codex": "Architect",
  "team-jd-judge-codex": "Reviewer"
});

const hash = (value) => createHash("sha256").update(value).digest("hex");
const text = (value) => typeof value === "string" ? value : null;
const number = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function parseObject(value) {
  const parsed = JSON.parse(value);
  if (!object(parsed)) throw new Error("Invalid telemetry object");
  return parsed;
}

function parseRows(value) {
  return String(value).split(/\r?\n/).filter((line) => line.trim()).map(parseObject);
}

function timing(rows) {
  let first = null;
  let last = null;
  for (const row of rows) {
    const time = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
    if (!Number.isFinite(time)) continue;
    first = first === null ? time : Math.min(first, time);
    last = last === null ? time : Math.max(last, time);
  }
  return {
    startedAt: first === null ? null : new Date(first).toISOString(),
    completedAt: last === null ? null : new Date(last).toISOString(),
    durationMs: first === null ? null : last - first
  };
}

// Never follows symlinks or returns filesystem errors, which may contain private paths.
async function walk(directory, readdir, visit, result) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") result.skipped += 1;
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, readdir, visit, result);
    else if (entry.isFile()) await visit(path);
  }
}

function include(record, since) {
  return !since || record.completedAt === null || Date.parse(record.completedAt) >= Date.parse(since);
}

function claudeRecord(rows, meta, file, roleMap) {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  // One entry per API message. Streamed rows repeat a message with growing
  // usage, so the last row of each message carries its final counts.
  const messages = new Map();
  let anonymous = 0;
  let sessionId = null;
  let agentId = null;
  for (const row of rows) {
    sessionId ??= text(row.sessionId);
    agentId ??= text(row.agentId);
    if (row.type !== "assistant" || !object(row.message)) continue;
    const id = text(row.message.id) ?? text(row.requestId) ?? `anonymous:${anonymous++}`;
    messages.set(id, row.message);
  }
  const models = new Map();
  for (const message of messages.values()) {
    const model = text(message.model);
    if (model !== null) models.set(model, (models.get(model) ?? 0) + 1);
    const usage = message.usage;
    tokens.input += number(usage?.input_tokens);
    tokens.output += number(usage?.output_tokens);
    tokens.cacheRead += number(usage?.cache_read_input_tokens);
    tokens.cacheWrite += number(usage?.cache_creation_input_tokens);
  }
  tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
  const agentType = text(meta.agentType);
  // Only project explicitly permitted metadata; never access the description field.
  return {
    source: "claude-subagent",
    provider: "claude",
    model: [...models].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    agentType,
    role: Object.hasOwn(roleMap, agentType) ? text(roleMap[agentType]) : null,
    // Tuple encoding avoids collisions between different session/agent boundaries.
    runKey: hash(JSON.stringify([
      sessionId ?? basename(dirname(dirname(file))), agentId ?? basename(file, ".jsonl")
    ])),
    ...timing(rows),
    tokens,
    outcome: meta.finished === true ? "completed" : "unknown"
  };
}

/** Read local Claude subagent pairs. Returns only allowlisted metrics, never transcript content. */
export async function readClaudeSubagentTelemetry({
  projectsDir = join(homedir(), ".claude", "projects"),
  roleMap = DEFAULT_AGENT_ROLE_MAP,
  since,
  readdir = defaultReaddir,
  readFile = defaultReadFile
} = {}) {
  const result = { records: [], skipped: 0 };
  await walk(projectsDir, readdir, async (file) => {
    if (basename(dirname(file)) !== "subagents" || !/^agent-.+\.jsonl$/.test(basename(file))) return;
    try {
      const meta = parseObject(await readFile(file.replace(/\.jsonl$/, ".meta.json"), "utf8"));
      const rows = parseRows(await readFile(file, "utf8"));
      const record = claudeRecord(rows, meta, file, roleMap);
      if (include(record, since)) result.records.push(record);
    } catch {
      result.skipped += 1;
    }
  }, result);
  return result;
}

function codexTokens(usage) {
  return {
    input: number(usage.input_tokens),
    output: number(usage.output_tokens),
    cacheRead: number(usage.cached_input_tokens),
    cacheWrite: number(usage.cache_write_input_tokens),
    reasoning: number(usage.reasoning_output_tokens),
    total: number(usage.total_tokens)
  };
}

function codexRecord(rows, file) {
  let model = null;
  let originator = null;
  let previous = null;
  const tokens = codexTokens({});
  for (const row of rows) {
    if (row.type === "session_meta") originator = text(row.payload?.originator);
    if (row.type === "turn_context") model = text(row.payload?.model);
    if (row.type !== "token_count" && row.payload?.type !== "token_count") continue;
    const usage = row.payload?.info?.total_token_usage;
    if (!object(usage)) continue;
    const current = codexTokens(usage);
    if (previous && current.total < previous.total) {
      for (const key of Object.keys(tokens)) tokens[key] += previous[key];
    }
    previous = current;
  }
  if (previous) for (const key of Object.keys(tokens)) tokens[key] += previous[key];
  return {
    source: "codex-rollout", provider: "codex", model, agentType: null, role: null,
    originator, linkedBy: null,
    runKey: hash(basename(file)), ...timing(rows), tokens, outcome: "unknown"
  };
}

/** Read cumulative Codex usage, summing completed counter segments when totals reset. */
export async function readCodexRolloutTelemetry({
  sessionsDir = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "sessions"),
  since,
  readdir = defaultReaddir,
  readFile = defaultReadFile
} = {}) {
  const result = { records: [], skipped: 0 };
  await walk(sessionsDir, readdir, async (file) => {
    if (!/^rollout-.+\.jsonl$/.test(basename(file))) return;
    try {
      const record = codexRecord(parseRows(await readFile(file, "utf8")), file);
      if (include(record, since)) result.records.push(record);
    } catch {
      result.skipped += 1;
    }
  }, result);
  return result;
}

/** Each reader fails soft independently; skipped counts never expose paths or error text. */
export async function readAgentSessionTelemetry(options = {}) {
  const claude = await readClaudeSubagentTelemetry(options);
  const codex = await readCodexRolloutTelemetry(options);
  const { wrapperRoleMap = CODEX_WRAPPER_ROLE_MAP } = options;
  const wrappers = claude.records.filter((record) =>
    Object.hasOwn(wrapperRoleMap, record.agentType) &&
    record.startedAt !== null && record.completedAt !== null);
  let linked = 0;
  let ambiguous = 0;
  for (const record of codex.records) {
    if (record.originator !== "codex_exec" || record.role !== null ||
        record.startedAt === null || record.completedAt === null) continue;
    const roles = new Set(wrappers.filter((wrapper) =>
      Date.parse(record.startedAt) >= Date.parse(wrapper.startedAt) - 5000 &&
      Date.parse(record.completedAt) <= Date.parse(wrapper.completedAt) + 5000)
      .map((wrapper) => text(wrapperRoleMap[wrapper.agentType])));
    if (roles.size > 1) {
      record.linkedBy = "ambiguous";
      ambiguous += 1;
    } else if (roles.size === 1 && !roles.has(null)) {
      record.role = [...roles][0];
      record.linkedBy = "wrapper-window";
      linked += 1;
    }
  }
  return { records: [...claude.records, ...codex.records], skipped: claude.skipped + codex.skipped,
    linked, ambiguous };
}
