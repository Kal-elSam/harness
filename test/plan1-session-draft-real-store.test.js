/**
 * P1-T2 expand: stop → restart → restore using the REAL session-registry
 * draft store under an isolated HARNESS_HOME (never the user home).
 *
 * REAL: runKairoUiRpcStdio, saveDraft/loadDraft → `.harness/sessions/.../draft.json`
 * SIMULATED: Pi child only (no providers).
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
  openPiRpcBridge
} from "../src/global/host/pi-rpc-bridge.js";
import { runKairoUiRpcStdio } from "../src/global/host/kairo-ui-rpc-stdio.js";
import { harnessHomePaths } from "../src/global/paths.js";

const SESSION_ID = "eeeeeeee-0000-4000-8000-00000000000e";
const DRAFT = "real-store-draft-marker";

function fakeSnapshot() {
  return {
    schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
    project: { label: "draft-restore" },
    agents: [],
    subscriptions: { state: "ready", segments: [] }
  };
}

function createFakeRpcChild() {
  const child = new EventEmitter();
  let activeModel = { id: "codex::m1", provider: "kairo" };
  child.stdin = new EventEmitter();
  child.stdin.write = (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      let cmd;
      try {
        cmd = JSON.parse(line);
      } catch {
        continue;
      }
      let body = null;
      if (cmd.type === "get_state") {
        body = { type: "response", command: "get_state", success: true, data: { sessionId: "pi-draft", model: activeModel } };
      } else if (cmd.type === "set_model") {
        activeModel = { id: cmd.modelId, provider: "kairo" };
        body = { type: "response", command: "set_model", success: true };
      } else if (cmd.type === "get_messages") {
        body = { type: "response", command: "get_messages", success: true, data: { messages: [] } };
      }
      if (body) {
        if (cmd.id != null) body.id = cmd.id;
        queueMicrotask(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify(body)}\n`)));
      }
    }
    return true;
  };
  child.stdin.end = () => {};
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => child.emit("exit", 0, null);
  return child;
}

async function pollUntil(pred, ms = 4000) {
  const deadline = Date.now() + ms;
  while (!pred() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
  return pred();
}

async function boot({ homeDir, projectRoot, out }) {
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) out.push(JSON.parse(line));
  });
  const stdin = new PassThrough();
  const runPromise = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: projectRoot,
    env: { HARNESS_HOME: homeDir, HOME: homeDir, KAIRO_SESSION_ID: SESSION_ID },
    resolveProjectRoot: async () => projectRoot,
    listPiSessionFilesForCwd: () => [],
    // Intentionally omit saveDraft/loadDraft → REAL session-registry defaults.
    openBridge: async (opts) =>
      openPiRpcBridge({
        cwd: opts?.cwd ?? projectRoot,
        loadSnapshot: async () => fakeSnapshot(),
        resolveCliPath: () => "/fake/cli.js",
        loadKairoProviderModels: async () => [
          { id: "codex::m1", kairoRoute: { role: "Architect", adapterId: "codex", modelId: "m1" } }
        ],
        spawnImpl: () => createFakeRpcChild(),
        execPath: "/usr/bin/node",
        connectTimeoutMs: 500
      })
  });
  assert.equal(await pollUntil(() => out.some((r) => r.type === "ready")), true);
  return { stdin, runPromise };
}

async function stopWithDraft(stdin, draft) {
  // Let the sidecar op loop attach to stdin before closing it. Immediate
  // write+end can race the post-ready readline setup and drop the stop op
  // (observed empty sessionsDir with REAL saveDraft).
  await new Promise((r) => setTimeout(r, 50));
  stdin.write(`${JSON.stringify({ op: "stop", draft })}\n`);
  await new Promise((r) => setTimeout(r, 50));
  stdin.end();
}

test("INTEGRATED REAL session store: stop persists draft.json; restart ready.draft restores it (SIMULATED Pi only)", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-draft-home-"));
  const projectRoot = await mkdtemp(join(tmpdir(), "kairo-draft-proj-"));
  try {
    const firstOut = [];
    const first = await boot({ homeDir, projectRoot, out: firstOut });
    assert.equal(firstOut.find((r) => r.type === "ready")?.draft ?? null, null);

    await stopWithDraft(first.stdin, DRAFT);
    await first.runPromise;

    const { sessionsDir } = harnessHomePaths(homeDir);
    // Find the draft under the isolated harness home — never ~/.harness of the user.
    const { readdir } = await import("node:fs/promises");
    async function walk(dir, acc = []) {
      let entries = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return acc;
      }
      for (const ent of entries) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) await walk(p, acc);
        else if (ent.name === "draft.json") acc.push(p);
      }
      return acc;
    }
    const drafts = await walk(sessionsDir);
    assert.ok(drafts.length >= 1, `expected draft.json under ${sessionsDir}`);
    const raw = JSON.parse(await readFile(drafts[0], "utf8"));
    assert.equal(raw.schema, "kairo.session-draft/v1");
    assert.equal(raw.text, DRAFT);
    assert.ok(String(drafts[0]).startsWith(homeDir), `draft must live under isolated home ${homeDir}`);
    assert.ok(
      drafts[0].includes(`${join(".harness", "sessions")}`),
      `expected sessions tree, got ${drafts[0]}`
    );

    const secondOut = [];
    const second = await boot({ homeDir, projectRoot, out: secondOut });
    assert.equal(secondOut.find((r) => r.type === "ready")?.draft, DRAFT);

    await stopWithDraft(second.stdin, "");
    await second.runPromise;
  } finally {
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});
