/**
 * Entries written for Claude Code, Codex and Cursor all launch the SAME `kairo mcp`
 * server. Offline: temp HOME / HARNESS_HOME, scrubbed env, no provider, no network.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readClientEntry } from "../src/global/mcp/client-config.js";
import { runMcpInstall } from "../src/global/mcp-install.js";
import {
  KAIRO_MCP_CONVERSATION_DELEGATE_TOOLS,
  KAIRO_MCP_CONVERSATION_READ_TOOLS,
  KAIRO_MCP_CONVERSATION_SETUP_TOOLS,
  KAIRO_MCP_WRITE_TOOLS
} from "../src/global/mcp/kairo-mcp.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "kairo.js");
const WRITE_TOOLS = ["kairo_publish_work_snapshot", "kairo_execute_plan", "kairo_cancel_execution"];
const READ_TOOLS = ["kairo_sessions", "kairo_team", "kairo_task_result", "kairo_plan_execution"];

function listTools({ args, cwd, home }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: { PATH: process.env.PATH, HOME: home, HARNESS_HOME: home },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    let buffer = "";
    const pending = new Map();
    child.stderr.on("data", (d) => { stderr += d; });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id != null) pending.get(msg.id)?.(msg);
        } catch { /* not a response */ }
      }
    });
    const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
    const request = (id, method, params) => new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`timeout ${method}\n${stderr}`)), 20000);
      pending.set(id, (m) => { clearTimeout(timer); ok(m); });
      send({ jsonrpc: "2.0", id, method, params });
    });
    (async () => {
      const init = await request(1, "initialize", {
        protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "client-entry-test", version: "0" }
      });
      assert.ok(init.result?.serverInfo, "initialize returned serverInfo");
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      const list = await request(2, "tools/list", {});
      return (list.result?.tools ?? []).map((t) => t.name).sort();
    })().then(resolve, reject).finally(() => child.kill());
  });
}

test("claude-code, codex and cursor entries serve the same tool set; write tools only when bound", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kairo-entry-handshake-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const project = join(root, "project");
  await mkdir(home, { recursive: true });
  await mkdir(project, { recursive: true });

  const install = (client, extra = {}) =>
    runMcpInstall({ client, homeDir: home, yes: true, json: true, quiet: true, ...extra });
  await install("cursor");
  await install("claude-code");
  await install("codex");

  const entryOf = async (client, rel) => readClientEntry(client, await readFile(join(home, rel), "utf8"))
    ?? JSON.parse(await readFile(join(home, rel), "utf8")).mcpServers.kairo;
  const entries = {
    cursor: JSON.parse(await readFile(join(home, ".cursor", "mcp.json"), "utf8")).mcpServers.kairo,
    "claude-code": await entryOf("claude-code", ".claude.json"),
    codex: await entryOf("codex", join(".codex", "config.toml"))
  };

  const sets = {};
  for (const [client, entry] of Object.entries(entries)) {
    assert.equal(entry.command, "kairo", client);
    sets[client] = await listTools({ args: entry.args, cwd: project, home });
    for (const name of READ_TOOLS) assert.ok(sets[client].includes(name), `${client} lists ${name}`);
    for (const name of WRITE_TOOLS) assert.equal(sets[client].includes(name), false, `${client} hides ${name}`);
  }
  assert.deepEqual(sets["claude-code"], sets.cursor);
  assert.deepEqual(sets.codex, sets.cursor);

  // Explicitly bound entries (opt-in) expose the write tools of the same service.
  await install("claude-code", { bind: project });
  await install("codex", { bind: project });
  const bound = {
    "claude-code": await entryOf("claude-code", ".claude.json"),
    codex: await entryOf("codex", join(".codex", "config.toml"))
  };
  const boundSets = {};
  for (const [client, entry] of Object.entries(bound)) {
    assert.deepEqual(entry.args, ["mcp", "--workspace-bound", "--cwd", project]);
    boundSets[client] = await listTools({ args: entry.args, cwd: project, home });
    for (const name of [...READ_TOOLS, ...WRITE_TOOLS]) assert.ok(boundSets[client].includes(name), `${client} bound lists ${name}`);
    // The shared conversation surface (team, sessions, tasks, setup) stays available when bound.
    for (const name of [
      ...KAIRO_MCP_CONVERSATION_READ_TOOLS,
      ...KAIRO_MCP_CONVERSATION_DELEGATE_TOOLS.filter((n) => !KAIRO_MCP_WRITE_TOOLS.includes(n)),
      ...KAIRO_MCP_CONVERSATION_SETUP_TOOLS.filter((n) => !KAIRO_MCP_WRITE_TOOLS.includes(n))
    ]) assert.ok(boundSets[client].includes(name), `${client} bound keeps ${name}`);
  }
  assert.deepEqual(boundSets["claude-code"], boundSets.codex);
});
