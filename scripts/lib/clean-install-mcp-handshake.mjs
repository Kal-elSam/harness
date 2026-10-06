// Drives `kairo mcp` over stdio from an INSTALLED copy: initialize + tools/list.
// Usage: node clean-install-mcp-handshake.mjs <installed-bin> <cwd> <harness-home>
// Prints a JSON summary; exits non-zero when an assertion fails.
import { spawn } from "node:child_process";

const [bin, cwd, harnessHome] = process.argv.slice(2);
const READ_TOOLS = ["kairo_sessions", "kairo_team", "kairo_task_result", "kairo_plan_execution"];
const WRITE_TOOLS = ["kairo_publish_work_snapshot", "kairo_execute_plan", "kairo_cancel_execution"];

const child = spawn(process.execPath, [bin, "mcp"], {
  cwd,
  env: { PATH: process.env.PATH, HOME: harnessHome, HARNESS_HOME: harnessHome },
  stdio: ["pipe", "pipe", "pipe"]
});
let stderr = "";
child.stderr.on("data", (d) => { stderr += d; });

const pending = new Map();
let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) pending.get(msg.id)(msg);
  }
});

const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
const request = (id, method, params) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}\n${stderr}`)), 20000);
  pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
  send({ jsonrpc: "2.0", id, method, params });
});

const fail = (message) => {
  console.error(`MCP handshake failed: ${message}`);
  child.kill();
  process.exit(1);
};

try {
  const init = await request(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "clean-install-smoke", version: "0.0.0" }
  });
  if (!init.result?.serverInfo) fail(`no serverInfo: ${JSON.stringify(init)}`);
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const list = await request(2, "tools/list", {});
  const names = (list.result?.tools ?? []).map((t) => t.name);
  const missingRead = READ_TOOLS.filter((n) => !names.includes(n));
  if (missingRead.length) fail(`missing conversation read tools: ${missingRead.join(", ")}`);
  const leakedWrite = WRITE_TOOLS.filter((n) => names.includes(n));
  if (leakedWrite.length) fail(`write tools listed without workspace binding: ${leakedWrite.join(", ")}`);
  console.log(JSON.stringify({
    server: init.result.serverInfo,
    protocolVersion: init.result.protocolVersion,
    toolCount: names.length,
    readToolsPresent: READ_TOOLS,
    writeToolsAbsent: WRITE_TOOLS
  }));
  child.kill();
  process.exit(0);
} catch (error) {
  fail(error.message);
}
