import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import test from "node:test";

// Dynamic loading keeps every requested rule visible in the initial RED run.
const load = () => import("../src/global/observability/agent-session-telemetry.js");
const start = "2026-10-19T10:00:00.000Z";
const end = "2026-10-19T10:00:02.000Z";
const secret = "PRIVATE_PROMPT_TOOL_DESCRIPTION_MARKER";
const hash = (value) => createHash("sha256").update(value).digest("hex");

async function tree(t) {
  const root = await mkdtemp(join(tmpdir(), "agent-telemetry-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { projectsDir: join(root, "projects"), sessionsDir: join(root, "sessions") };
}

async function jsonl(file, rows) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

async function claude(options, id = "agent-one", meta = {}, rows) {
  const file = join(options.projectsDir, "project", "session", "subagents", `${id}.jsonl`);
  await jsonl(file, rows ?? [assistant("m1", start), assistant("m1", end), assistant("m2", end)]);
  await writeFile(file.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({
    agentType: "team-builder", finished: true, description: secret, ...meta
  }));
  return file;
}

function assistant(id, timestamp, model = "claude-model") {
  return { type: "assistant", timestamp, sessionId: "raw-session-id", agentId: "raw-agent-id",
    requestId: `request-${id}`, message: { id, model, content: secret,
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } } };
}

function count(total, timestamp = end, rowType = "event_msg") {
  return { type: rowType, timestamp, payload: { type: "token_count", info: { total_token_usage: {
    input_tokens: total, output_tokens: total / 2, cached_input_tokens: total / 4,
    cache_write_input_tokens: 2, reasoning_output_tokens: 1, total_tokens: total * 2
  } } } };
}

async function codex(options, rows) {
  const file = join(options.sessionsDir, "2026", "10", "rollout-one.jsonl");
  await jsonl(file, rows ?? [
    { type: "turn_context", timestamp: start, payload: { model: "old-model" } },
    count(20), count(40),
    { type: "turn_context", timestamp: end, payload: { model: "last-model" } }
  ]);
  return file;
}

test("Claude fields, timestamps and token sums deduplicate API messages", async (t) => {
  const options = await tree(t);
  await claude(options);
  const { readClaudeSubagentTelemetry } = await load();
  const { records, skipped } = await readClaudeSubagentTelemetry(options);
  assert.equal(skipped, 0);
  assert.deepEqual(records, [{ source: "claude-subagent", provider: "claude", model: "claude-model",
    agentType: "team-builder", role: "Builder", runKey: hash(JSON.stringify(["raw-session-id", "raw-agent-id"])),
    startedAt: start, completedAt: end, durationMs: 2000,
    tokens: { input: 20, output: 10, cacheRead: 6, cacheWrite: 4, total: 40 }, outcome: "completed" }]);
});

test("Claude uses requestId fallback and most frequent unique message model", async (t) => {
  const options = await tree(t);
  const fallback = assistant("fallback", start, "majority");
  delete fallback.message.id;
  await claude(options, undefined, {}, [fallback, fallback,
    assistant("second", end, "majority"), ...Array(4).fill(assistant("third", end, "minority"))]);
  const { readClaudeSubagentTelemetry } = await load();
  const { records } = await readClaudeSubagentTelemetry(options);
  assert.equal(records[0].model, "majority");
  assert.equal(records[0].tokens.total, 60);
});

test("default role map is frozen and covers all requested agents", async () => {
  const { DEFAULT_AGENT_ROLE_MAP } = await load();
  assert.ok(Object.isFrozen(DEFAULT_AGENT_ROLE_MAP));
  assert.deepEqual(DEFAULT_AGENT_ROLE_MAP, {
    "team-explorer": "Explorer", "team-builder": "Builder",
    "team-test-runner": "Tester", "review-risk": "Reviewer",
    "review-resilience": "Reviewer", "review-readability": "Reviewer", "review-reliability": "Reviewer",
    "jd-judge-a": "Reviewer", "jd-judge-b": "Reviewer",
    "jd-fix-agent": "Builder", "team-researcher": "Explorer"
  });
});

test("Codex wrapper subagents get no role: their Claude transcript is the wrapper, the work is in the Codex rollout", async (t) => {
  const options = await tree(t);
  await claude(options, "agent-wrapper", { agentType: "team-builder-codex" });
  const { readClaudeSubagentTelemetry, DEFAULT_AGENT_ROLE_MAP } = await load();
  for (const type of ["team-builder-codex", "team-reviewer-codex", "team-plan-critic-codex", "team-jd-judge-codex"]) {
    assert.equal(Object.hasOwn(DEFAULT_AGENT_ROLE_MAP, type), false, type);
  }
  assert.equal((await readClaudeSubagentTelemetry(options)).records[0].role, null);
});

test("streamed rows of one message count its final usage, not the first partial row", async (t) => {
  const options = await tree(t);
  const partial = assistant("m1", start);
  partial.message.usage = { ...partial.message.usage, output_tokens: 1 };
  const final = assistant("m1", end);
  final.message.usage = { ...final.message.usage, output_tokens: 50 };
  await claude(options, undefined, {}, [partial, final]);
  const { readClaudeSubagentTelemetry } = await load();
  const { tokens } = (await readClaudeSubagentTelemetry(options)).records[0];
  assert.deepEqual(tokens, { input: 10, output: 50, cacheRead: 3, cacheWrite: 2, total: 65 });
});

test("unknown roles are null, overrides work, finished false stays unknown", async (t) => {
  const options = await tree(t);
  await claude(options, "agent-unknown", { agentType: "toString", finished: false }, []);
  await claude(options, "agent-custom", { agentType: "custom" });
  const { readClaudeSubagentTelemetry } = await load();
  const { records } = await readClaudeSubagentTelemetry({ ...options, roleMap: { custom: "Tester" } });
  const unknown = records.find((record) => record.agentType === "toString");
  assert.equal(unknown.role, null);
  assert.equal(unknown.model, null);
  assert.equal(unknown.startedAt, null);
  assert.equal(unknown.durationMs, null);
  assert.equal(unknown.outcome, "unknown");
  assert.equal(records.find((record) => record.agentType === "custom").role, "Tester");
});

test("since filters both providers by end time, retaining boundary runs", async (t) => {
  const options = await tree(t);
  await claude(options);
  await codex(options);
  const { readAgentSessionTelemetry } = await load();
  assert.equal((await readAgentSessionTelemetry({ ...options, since: end })).records.length, 2);
  assert.deepEqual(await readAgentSessionTelemetry({ ...options, since: "2026-10-19T10:00:03Z" }),
    { records: [], skipped: 0 });
});

test("Codex uses last cumulative usage, final turn model and hashed filename", async (t) => {
  const options = await tree(t);
  await codex(options);
  const { readCodexRolloutTelemetry } = await load();
  assert.deepEqual(await readCodexRolloutTelemetry(options), { skipped: 0, records: [{
    source: "codex-rollout", provider: "codex", model: "last-model", agentType: null, role: null,
    runKey: hash("rollout-one.jsonl"), startedAt: start, completedAt: end, durationMs: 2000,
    tokens: { input: 40, output: 20, cacheRead: 10, cacheWrite: 2, reasoning: 1, total: 80 }, outcome: "unknown"
  }] });
});

test("Codex sums cumulative segments after resets and accepts direct token_count rows", async (t) => {
  const options = await tree(t);
  await codex(options, [count(20, start), count(40), count(4, end, "token_count"), count(8)]);
  const { readCodexRolloutTelemetry } = await load();
  const { records } = await readCodexRolloutTelemetry(options);
  assert.deepEqual(records[0].tokens, { input: 48, output: 24, cacheRead: 12, cacheWrite: 4, reasoning: 2, total: 96 });
  assert.equal(records[0].model, null);
});

test("Codex default sessions directory honors CODEX_HOME", async (t) => {
  const options = await tree(t);
  await codex(options);
  const previous = process.env.CODEX_HOME;
  process.env.CODEX_HOME = dirname(options.sessionsDir);
  t.after(() => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; });
  const { readCodexRolloutTelemetry } = await load();
  assert.equal((await readCodexRolloutTelemetry()).records.length, 1);
});

test("missing directories return empty results; fs functions are injectable", async (t) => {
  const options = await tree(t);
  const { readAgentSessionTelemetry, readClaudeSubagentTelemetry, readCodexRolloutTelemetry } = await load();
  assert.deepEqual(await readAgentSessionTelemetry(options), { records: [], skipped: 0 });
  const seen = [];
  const missing = async (path) => { seen.push(path); throw Object.assign(new Error(secret), { code: "ENOENT" }); };
  await readClaudeSubagentTelemetry({ readdir: missing });
  assert.equal(seen.pop(), join(homedir(), ".claude", "projects"));
  const previous = process.env.CODEX_HOME;
  delete process.env.CODEX_HOME;
  t.after(() => { if (previous !== undefined) process.env.CODEX_HOME = previous; });
  await readCodexRolloutTelemetry({ readdir: missing });
  assert.equal(seen.pop(), join(homedir(), ".codex", "sessions"));
});

test("malformed and unreadable files are skipped and counted without losing healthy records", async (t) => {
  const options = await tree(t);
  const broken = await claude(options, "agent-broken");
  await writeFile(broken, "{not-json\n");
  const badMeta = await claude(options, "agent-bad-meta");
  await writeFile(badMeta.replace(/\.jsonl$/, ".meta.json"), "null");
  await claude(options, "agent-good");
  const denied = await codex(options);
  const { readAgentSessionTelemetry } = await load();
  const result = await readAgentSessionTelemetry({ ...options, readdir, readFile: async (file, ...args) => {
    if (file === denied) throw new Error(secret);
    return readFile(file, ...args);
  } });
  assert.equal(result.skipped, 3);
  assert.equal(result.records.length, 1);
});

test("privacy allowlist excludes prompts, message content, tools, paths, description and raw ids", async (t) => {
  const options = await tree(t);
  await claude(options, undefined, {}, [
    { type: "user", timestamp: end, message: { content: secret }, cwd: secret },
    { type: "tool_result", timestamp: start, input: secret, output: secret }, assistant("m1", start)
  ]);
  await codex(options, [count(20), { type: "response_item", timestamp: start,
    payload: { content: secret, input: secret, output: secret, cwd: secret, sessionId: "raw-session-id" } }]);
  const { readAgentSessionTelemetry } = await load();
  const { records } = await readAgentSessionTelemetry(options);
  const serialized = JSON.stringify(records);
  for (const marker of [secret, "raw-session-id", "raw-agent-id", options.projectsDir, options.sessionsDir]) {
    assert.ok(!serialized.includes(marker));
  }
  const keys = ["source", "provider", "model", "agentType", "role", "runKey", "startedAt", "completedAt", "durationMs", "tokens", "outcome"].sort();
  for (const record of records) assert.deepEqual(Object.keys(record).sort(), keys);
});
