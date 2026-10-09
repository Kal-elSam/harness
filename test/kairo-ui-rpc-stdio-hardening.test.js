/**
 * Hardening of the ratatui sidecar RPC boundary (findings from the /code-review of
 * src/global/host/kairo-ui-rpc-stdio.js): run ids, stdin framing, record tags,
 * draft preservation, session-switch validation and connection-preview matching.
 */
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { runKairoUiRpcStdio } from "../src/global/host/kairo-ui-rpc-stdio.js";

const KAIRO_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return true;
    await settle(10);
  }
  return predicate();
}

function bridgeStub(requests) {
  return async () => ({
    request: async (cmd) => {
      requests.push(cmd);
      return cmd?.type === "get_state" ? { sessionId: "pi-1" } : {};
    },
    stop: async () => {},
    sendRaw: () => {},
    onEvent: () => {},
    getState: async () => ({})
  });
}

/** Start the sidecar over in-memory pipes. `script` drives stdin; the harness stops and drains afterwards. */
async function rpc(options, script, { endInScript = false } = {}) {
  const out = [];
  const requests = [];
  const stdout = new PassThrough();
  stdout.on("data", (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      try {
        out.push(JSON.parse(line));
      } catch {
        /* ignore partial line */
      }
    }
  });
  const stdin = new PassThrough();
  const run = runKairoUiRpcStdio({
    stdin,
    stdout,
    cwd: "/project",
    env: { KAIRO_SESSION_ID: KAIRO_ID, HARNESS_HOME: "/tmp/kairo-rpc-hardening" },
    resolveHomeDir: () => "/tmp/kairo-rpc-hardening",
    getSession: async () => ({ id: KAIRO_ID, mode: "ask" }),
    openBridge: bridgeStub(requests),
    loadKairoProviderModels: async () => [],
    loadSnapshot: async () => ({ ok: true }),
    listPiSessionFilesForCwd: () => [],
    resolveProjectRoot: async () => "/project",
    ...options
  });
  await until(() => out.some((r) => r.type === "ready"));
  await script({ stdin, out, requests });
  if (!endInScript) {
    stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
    stdin.end();
  }
  await run;
  return { out, requests };
}

const send = (stdin, cmd) => stdin.write(`${JSON.stringify(cmd)}\n`);

// ---- plans.transcript ----

test("plans.transcript rejects run ids that could escape the runs directory before reading anything", async () => {
  const reads = [];
  const { out } = await rpc({
    readRunTranscript: async (args) => {
      reads.push(args);
      return { runId: args.runId, nextIndex: 0, entries: [] };
    }
  }, async ({ stdin }) => {
    for (const runId of ["../../outside", "..", "a/b", ".hidden", "x".repeat(200)]) {
      send(stdin, { op: "plans.transcript", runId });
    }
    await settle(80);
  });
  assert.deepEqual(reads, [], "the transcript reader was never called with an unsafe id");
  assert.equal(out.filter((r) => r.type === "run_transcript").length, 0);
  assert.equal(out.filter((r) => r.type === "error").length, 5);
});

test("plans.transcript keeps working for a safe id and sanitizes sinceIndex to a non-negative integer", async () => {
  const reads = [];
  const { out } = await rpc({
    readRunTranscript: async (args) => {
      reads.push(args);
      return { runId: args.runId, nextIndex: 2, entries: [] };
    }
  }, async ({ stdin }) => {
    send(stdin, { op: "plans.transcript", runId: "run_ok-1", sinceIndex: 3 });
    for (const sinceIndex of [-3, 1.5, null, "", true, "x"]) {
      send(stdin, { op: "plans.transcript", runId: "run_ok-1", sinceIndex });
    }
    await settle(100);
  });
  assert.equal(out.filter((r) => r.type === "run_transcript").length, 7);
  assert.deepEqual(reads.map((r) => r.sinceIndex), [3, 0, 0, 0, 0, 0, 0]);
});

// ---- stdin framing ----

test("stdin: a multibyte character split across chunks is decoded intact", async () => {
  const name = "ñandú 🦆 日本";
  const bytes = Buffer.from(`${JSON.stringify({ op: "rename_session", name })}\n`, "utf8");
  const cut = bytes.indexOf(Buffer.from("ñ")) + 1; // inside the 2-byte character
  const cutEmoji = bytes.indexOf(Buffer.from("🦆")) + 2; // inside the 4-byte character
  const { requests } = await rpc({}, async ({ stdin }) => {
    stdin.write(bytes.subarray(0, cut));
    await settle(5);
    stdin.write(bytes.subarray(cut, cutEmoji));
    await settle(5);
    stdin.write(bytes.subarray(cutEmoji));
    await settle(60);
  });
  const renamed = requests.find((c) => c.type === "set_session_name");
  assert.equal(renamed?.name, name);
});

test("stdin: a final line without a trailing newline is processed when the stream ends", async () => {
  const { requests } = await rpc({}, async ({ stdin }) => {
    stdin.write(JSON.stringify({ op: "rename_session", name: "last-line" }));
    stdin.end();
    await settle(80);
  }, { endInScript: true });
  assert.equal(requests.find((c) => c.type === "set_session_name")?.name, "last-line");
});

test("stdin: an endless line is dropped with an error instead of growing without bound, and the next line still works", async () => {
  const { out, requests } = await rpc({}, async ({ stdin }) => {
    const chunk = "x".repeat(1024 * 1024);
    for (let i = 0; i < 10; i += 1) stdin.write(chunk); // 10 MiB without a newline
    stdin.write("\n");
    await settle(60);
    send(stdin, { op: "rename_session", name: "after" });
    await settle(60);
  });
  assert.ok(out.some((r) => r.type === "error" && /too long/i.test(r.message ?? "")));
  assert.equal(requests.find((c) => c.type === "set_session_name")?.name, "after");
});

// ---- ASK record tags ----

test("ASK: provider event fields can never override the record type, turn, session or sequence", async () => {
  const { out } = await rpc({
    submitTask: async ({ onEvent }) => {
      onEvent({ kind: "text", text: "hi", type: "terminal_yield", turnId: "evil-turn", sessionId: "evil-session", seq: 999, provider: "claude" });
      return { kind: "answer", provider: "claude", model: "m", answer: "ok" };
    }
  }, async ({ stdin, out: records }) => {
    send(stdin, { op: "prompt", message: "hello" });
    await until(() => records.some((r) => r.type === "task_result"));
  });
  const text = out.find((r) => r.kind === "text");
  assert.ok(text, "the text event reached the host");
  assert.equal(text.type, "provider_event");
  assert.notEqual(text.turnId, "evil-turn");
  assert.notEqual(text.sessionId, "evil-session");
  assert.notEqual(text.seq, 999);
  assert.equal(out.some((r) => r.type === "terminal_yield"), false);
});

// ---- drafts ----

test("stop without a draft field keeps the saved draft; a string draft (even empty) is saved", async () => {
  const saves = [];
  const saveDraft = async (_home, _root, sessionId, text) => {
    saves.push({ sessionId, text });
  };
  await rpc({ saveDraft }, async ({ stdin }) => {
    send(stdin, { op: "stop" });
    await settle(60);
  }, { endInScript: false }).catch(() => {});
  assert.deepEqual(saves, [], "no draft field means nothing is saved");

  saves.length = 0;
  await rpc({ saveDraft }, async ({ stdin }) => {
    send(stdin, { op: "stop", draft: "" });
    await settle(60);
  });
  assert.deepEqual(saves.map((s) => s.text), [""], "an explicit empty draft is a real value");
});

test("new_session without a draft field does not overwrite the saved draft of the outgoing session", async () => {
  const saves = [];
  await rpc({
    saveDraft: async (_h, _r, sessionId, text) => {
      saves.push({ sessionId, text });
    },
    loadDraft: async () => null
  }, async ({ stdin }) => {
    send(stdin, { op: "new_session" });
    await settle(80);
  });
  // The only save allowed is the one `stop` does for a string draft; none here.
  assert.equal(saves.some((s) => s.sessionId === KAIRO_ID && s.text === ""), false);
});

// ---- session switching ----

test("switch_session_index only accepts a real integer index and validates before cancelling anything", async () => {
  const { requests, out } = await rpc({
    listPiSessionFilesForCwd: () => [{ path: "/x/a.jsonl", sessionId: "pi-a", label: "A" }]
  }, async ({ stdin }) => {
    for (const index of [null, "", [], false, "0", "abc", -1, 1.5, 9]) {
      send(stdin, { op: "switch_session_index", index });
    }
    await settle(120);
  });
  assert.equal(requests.some((c) => c.type === "switch_session"), false, "no invalid index reached Pi");
  assert.ok(out.filter((r) => r.type === "error").length >= 9);
});

test("switch_session only accepts a path that is one of this project's listed Pi sessions", async () => {
  const { requests, out } = await rpc({
    listPiSessionFilesForCwd: () => [{ path: "/x/a.jsonl", sessionId: "pi-a", label: "A" }]
  }, async ({ stdin }) => {
    send(stdin, { op: "switch_session", sessionPath: "/etc/passwd" });
    send(stdin, { op: "switch_session", sessionPath: "/other/project/b.jsonl" });
    await settle(100);
    send(stdin, { op: "switch_session", sessionPath: "/x/a.jsonl" });
    await settle(120);
  });
  const switched = requests.filter((c) => c.type === "switch_session");
  assert.deepEqual(switched.map((c) => c.sessionPath), ["/x/a.jsonl"]);
  assert.equal(out.filter((r) => r.type === "error").length >= 2, true);
});

// ---- connections.connect ----

test("connections.connect refuses a fingerprint that does not match the preview it was given", async () => {
  const connects = [];
  const backend = {
    status: async () => ({ ok: true, inventory: [] }),
    preview: async () => ({ ok: true, provider: "claude", preview: { providerId: "claude" }, previewId: "preview-1", surfaces: {} }),
    connect: async (args) => {
      connects.push(args);
      return { ok: true, outcome: "connected" };
    }
  };
  const { out } = await rpc({ connectionsBackend: backend }, async ({ stdin }) => {
    send(stdin, { op: "connections.preview", provider: "claude" });
    await settle(60);
    send(stdin, { op: "connections.connect", provider: "claude", fingerprint: "bogus", confirm: true });
    send(stdin, { op: "connections.connect", provider: "claude", confirm: true });
    await settle(80);
    send(stdin, { op: "connections.connect", provider: "claude", fingerprint: "preview-1", confirm: true });
    await settle(80);
  });
  const results = out.filter((r) => r.type === "connections_connect");
  assert.equal(results.length, 3);
  assert.deepEqual(results.slice(0, 2).map((r) => [r.ok, r.reason]), [[false, "preview_mismatch"], [false, "preview_mismatch"]]);
  assert.equal(connects.length, 1, "only the matching confirmation reached the backend");
});
