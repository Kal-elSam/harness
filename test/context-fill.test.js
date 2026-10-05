import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  claudeFillFromRecord,
  claudeProjectKey,
  codexFillFromRecord,
  contextBand,
  formatContextFill,
  readContextFill
} from "../src/global/observability/context-fill.js";
import { cursorFillFromHeader } from "../src/global/observability/context-fill-cursor.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const kairoBin = join(packageRoot, "bin/kairo.js");

test("context bands follow the quality budget", () => {
  assert.equal(contextBand(0.2), "comfortable");
  assert.equal(contextBand(0.62), "handoff");
  assert.equal(contextBand(0.8), "saturated");
  assert.equal(contextBand(null), "unknown");
});

test("absent Cursor fill keeps band unknown, never invents comfortable", async () => {
  const home = mkdtempSync(join(tmpdir(), "context-fill-absent-cursor-"));
  const report = await readContextFill({ homeDir: home, cwd: "/tmp/no-cursor-project" });
  const cursor = report.readings.find((item) => item.adapter === "cursor");
  assert.ok(cursor);
  assert.equal(cursor.ratio, null);
  assert.equal(cursor.band, "unknown");
  assert.ok(cursor.status === "absent" || cursor.status === "unavailable");
});

test("codex record exposes used tokens and the model window", () => {
  const fill = codexFillFromRecord({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        model_context_window: 258400,
        last_token_usage: { input_tokens: 160639, total_tokens: 161149 }
      }
    }
  });
  assert.equal(fill.used, 161149);
  assert.equal(fill.limit, 258400);
});

test("claude record sums input and cache, and skips synthetic usage", () => {
  assert.equal(claudeFillFromRecord({
    type: "assistant",
    message: { model: "<synthetic>", usage: { input_tokens: 10 } }
  }), null);
  assert.deepEqual(claudeFillFromRecord({
    type: "assistant",
    message: {
      model: "claude-sonnet",
      usage: { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 3 }
    }
  }), { used: 105, model: "claude-sonnet" });
});

test("readContextFill measures Codex for the matching directory only", async () => {
  const home = mkdtempSync(join(tmpdir(), "context-fill-"));
  const project = "/tmp/any-project";
  const other = "/tmp/other-project";
  const sessionDir = join(home, ".codex", "sessions", "2026", "09", "29");
  await mkdir(sessionDir, { recursive: true });
  const line = (record) => JSON.stringify(record);
  await writeFile(join(sessionDir, "rollout.jsonl"), [
    line({ type: "session_meta", payload: { cwd: project, context_window: 200000 } }),
    line({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: { model_context_window: 200000, last_token_usage: { total_tokens: 120000 } }
      }
    })
  ].join("\n"));

  const match = await readContextFill({ homeDir: home, cwd: project });
  const codex = match.readings.find((item) => item.adapter === "codex");
  assert.equal(codex.status, "measured");
  assert.equal(codex.ratio, 0.6);
  assert.equal(codex.band, "handoff");

  const miss = await readContextFill({ homeDir: home, cwd: other });
  assert.equal(miss.readings.find((item) => item.adapter === "codex").status, "absent");
  assert.match(formatContextFill(match), /codex/);
  assert.equal(claudeProjectKey(project).includes("any-project"), true);
});

test("sonnet 5.5 tokens become a percentage of the one million window", async () => {
  const home = mkdtempSync(join(tmpdir(), "context-fill-claude-"));
  const project = "/tmp/claude-project";
  const dir = join(home, ".claude", "projects", claudeProjectKey(project));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "session.jsonl"), JSON.stringify({
    type: "assistant",
    message: {
      model: "claude-sonnet-5-5",
      usage: { input_tokens: 4092, cache_read_input_tokens: 484000, cache_creation_input_tokens: 0 }
    }
  }));
  const report = await readContextFill({ homeDir: home, cwd: project });
  const claude = report.readings.find((item) => item.adapter === "claude");
  assert.equal(claude.status, "measured");
  assert.equal(claude.limit, 1_000_000);
  assert.equal(claude.band, "comfortable");
  assert.ok(Math.abs(claude.ratio - 0.488092) < 0.0001);
});

test("cursor composer header percent is the live window fill", async () => {
  const project = "/tmp/cursor-project";
  const header = cursorFillFromHeader({
    contextUsagePercent: 90.92,
    workspaceIdentifier: { uri: { fsPath: project } }
  }, project);
  assert.equal(header.band, "saturated");
  assert.ok(Math.abs(header.ratio - 0.9092) < 0.0001);
  assert.equal(cursorFillFromHeader({
    contextUsagePercent: 85,
    workspaceIdentifier: { uri: { fsPath: "/somewhere-else" } }
  }, project), null);

  if (process.platform !== "darwin") return;
  const home = mkdtempSync(join(tmpdir(), "context-fill-cursor-"));
  const dbDir = join(home, "Library", "Application Support", "Cursor", "User", "globalStorage");
  await mkdir(dbDir, { recursive: true });
  const db = new DatabaseSync(join(dbDir, "state.vscdb"));
  db.exec("CREATE TABLE composerHeaders (value TEXT, lastUpdatedAt INTEGER)");
  db.prepare("INSERT INTO composerHeaders (value, lastUpdatedAt) VALUES (?, ?)").run(JSON.stringify({
    contextUsagePercent: 85,
    workspaceIdentifier: { uri: { fsPath: project } }
  }), Date.now());
  db.close();
  const report = await readContextFill({ homeDir: home, cwd: project });
  const cursor = report.readings.find((item) => item.adapter === "cursor");
  assert.equal(cursor.status, "measured");
  assert.equal(cursor.ratio, 0.85);
  assert.equal(cursor.band, "saturated");
});

test("kairo context --json emits valid readings with unknown bands when absent", () => {
  const home = mkdtempSync(join(tmpdir(), "context-cli-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "context-cli-cwd-"));
  const result = spawnSync(process.execPath, [kairoBin, "context", "--json", "--cwd", cwd], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: home, HARNESS_INK: "0" }
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.cwd, cwd);
  assert.ok(Array.isArray(payload.readings));
  assert.deepEqual(
    payload.readings.map((item) => item.adapter).sort(),
    ["claude", "codex", "cursor", "opencode"]
  );
  for (const item of payload.readings) {
    if (item.ratio == null) assert.equal(item.band, "unknown");
  }
});
