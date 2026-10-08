import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MAX_STORED_TURNS,
  appendAskRecord,
  askEventsPath,
  clearAskEvents,
  groupTurns,
  readAskTurns
} from "../src/global/conversation/ask-events-store.js";
import {
  mergeAskTurnsIntoRows,
  transcriptRowsForTurn
} from "../src/global/conversation/ask-events-restore.js";

const SID = "aaaaaaaa-0000-4000-8000-000000000001";
const ROOT = "/project";

async function tmpHome() {
  return mkdtemp(join(tmpdir(), "ask-events-"));
}

function turn(partial) {
  return { turnId: "t1", prompt: "hi", piAnchor: null, at: null, events: [], status: "done", message: null, ...partial };
}
const ev = (kind, fields = {}, seq = 1) => ({ v: 1, type: "event", turnId: "t1", seq, at: "x", kind, ...fields });

// Row shapes below are derived from crates/kairo-ui/src/chat.rs:
// `replace_from_sidecar_transcript` replays user_message/system_message via
// push_replay_message (trimmed) and everything else through apply_sidecar_event
// (text_delta -> Assistant row, tool_execution_start/end -> Tool row keyed by
// toolCallId with isError, message_update error -> Error row, agent_settled
// closes streaming). apply_provider_event + push_kairo_reply create the same
// visible messages live; see the mapping table in ask-events-restore.js.
const text = (delta) => ({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta } });
const errRow = (errorMessage) => ({
  type: "message_update",
  assistantMessageEvent: { type: "error", error: { errorMessage } }
});
const user = (content) => ({ type: "user_message", content });
const sys = (content) => ({ type: "system_message", content });
const settled = { type: "agent_settled" };

// ---- restore parity: scripted sequences -----------------------------------

test("text + tool_start/tool_end + done restores user, merged text, tool row, trailing text", () => {
  const rows = transcriptRowsForTurn(turn({
    prompt: "  list files ",
    events: [
      ev("progress", { summary: "thinking" }, 1),
      ev("text", { text: "Hel" }, 2),
      ev("text", { text: "lo " }, 3),
      ev("tool_start", { id: "t-1", name: "shell" }, 4),
      ev("tool_end", { id: "t-1", name: "shell", ok: true }, 5),
      ev("text", { text: "done." }, 6),
      ev("final", {}, 7)
    ]
  }));
  assert.deepEqual(rows, [
    user("list files"),
    text("Hello "),
    { type: "tool_execution_start", toolName: "shell", toolCallId: "t-1" },
    { type: "tool_execution_end", toolName: "shell", toolCallId: "t-1", isError: false },
    text("done."),
    settled
  ]);
});

test("tool_end with ok=false restores an error tool row; a running tool stays running", () => {
  const rows = transcriptRowsForTurn(turn({
    events: [
      ev("tool_start", { id: "a", name: "grep" }, 1),
      ev("tool_end", { id: "a", name: "grep", ok: false }, 2),
      ev("tool_start", { id: "b", name: "sleep" }, 3)
    ]
  }));
  assert.deepEqual(rows, [
    user("hi"),
    { type: "tool_execution_start", toolName: "grep", toolCallId: "a" },
    { type: "tool_execution_end", toolName: "grep", toolCallId: "a", isError: true },
    { type: "tool_execution_start", toolName: "sleep", toolCallId: "b" }
  ]);
});

test("progress between two text runs keeps them as two Assistant rows (activity row itself is never restored)", () => {
  const rows = transcriptRowsForTurn(turn({
    events: [
      ev("text", { text: "one" }, 1),
      ev("progress", { summary: "working" }, 2),
      ev("text", { text: "two" }, 3)
    ]
  }));
  assert.deepEqual(rows, [user("hi"), text("one"), settled, text("two"), settled]);
});

test("cancelled mid-text keeps the partial text, adds the Cancelled marker and never an answer", () => {
  const rows = transcriptRowsForTurn(turn({
    status: "cancelled",
    events: [
      ev("text", { text: "par" }, 1),
      // A defensive stored answer must not surface for a cancelled turn's
      // partial text run; the sidecar never writes one (see sidecar tests).
      ev("progress", { summary: "x" }, 2)
    ]
  }));
  assert.deepEqual(rows, [user("hi"), text("par"), sys("Cancelled"), settled]);
});

test("non-terminal error then the answer: Error row, then the answer row (no text was streamed)", () => {
  const rows = transcriptRowsForTurn(turn({
    events: [
      ev("error", { message: "rate limited, retrying" }, 1),
      ev("answer", { provider: "codex", model: "gpt-x", text: "the answer" }, 1)
    ]
  }));
  assert.deepEqual(rows, [user("hi"), errRow("rate limited, retrying"), sys("codex · gpt-x: the answer")]);
});

test("answer event is ignored when text events already carried the answer (Rust dedup rule)", () => {
  const rows = transcriptRowsForTurn(turn({
    events: [
      ev("text", { text: "It is 42." }, 1),
      ev("answer", { provider: "codex", model: null, text: "It is 42." }, 1)
    ]
  }));
  assert.deepEqual(rows, [user("hi"), text("It is 42."), settled]);
});

test("answer-only turn (Claude/Cursor: progress + final) renders like push_kairo_reply", () => {
  const withModel = transcriptRowsForTurn(turn({
    events: [
      ev("progress", { summary: "thinking" }, 1),
      ev("final", {}, 2),
      ev("answer", { provider: "claude", model: "sonnet", text: "42" }, 2)
    ]
  }));
  assert.deepEqual(withModel, [user("hi"), sys("claude · sonnet: 42")]);
  const noModel = transcriptRowsForTurn(turn({
    events: [ev("answer", { provider: null, model: null, text: "42" }, 1)]
  }));
  assert.deepEqual(noModel, [user("hi"), sys("kairo: 42")]);
});

test("failed: Error row from the terminal message, skipped when the last informational error was identical", () => {
  const differing = transcriptRowsForTurn(turn({
    status: "failed",
    message: "boom",
    events: [ev("text", { text: "partial" }, 1), ev("error", { message: "warn" }, 2)]
  }));
  assert.deepEqual(differing, [user("hi"), text("partial"), errRow("warn"), errRow("boom"), settled]);
  const duplicate = transcriptRowsForTurn(turn({
    status: "failed",
    message: "boom",
    events: [ev("error", { message: "boom" }, 1)]
  }));
  assert.deepEqual(duplicate, [user("hi"), errRow("boom")]);
  const blank = transcriptRowsForTurn(turn({
    status: "failed",
    message: "  ",
    events: [ev("progress", { summary: "p" }, 1)]
  }));
  assert.deepEqual(blank, [user("hi"), errRow("provider error")]);
});

test("failed before any provider event drops the user row (host revert_failed_prompt) but keeps the Error row", () => {
  const rows = transcriptRowsForTurn(turn({ status: "failed", message: "spawn failed", events: [] }));
  assert.deepEqual(rows, [errRow("spawn failed")]);
  // A cancelled turn with no events keeps its user row (cancelled never reverts).
  assert.deepEqual(
    transcriptRowsForTurn(turn({ status: "cancelled", events: [] })),
    [user("hi"), sys("Cancelled")]
  );
});

test("a turn interrupted before its terminal restores its rows without a marker", () => {
  const rows = transcriptRowsForTurn(turn({
    status: null,
    events: [ev("progress", { summary: "p" }, 1), ev("text", { text: "half" }, 2)]
  }));
  assert.deepEqual(rows, [user("hi"), text("half"), settled]);
});

// ---- merge with Pi rows ----------------------------------------------------

const piRows = [
  user("pi question"), // 0
  text("pi answer"), // 1
  settled, // 2
  user("second pi question"), // 3
  text("second pi answer"), // 4
  settled // 5
];

test("two turns with different anchors interleave with Pi rows; Pi rows are never removed or reordered", () => {
  const turns = [
    turn({ turnId: "a", prompt: "ask one", piAnchor: 3, events: [ev("answer", { provider: "codex", model: null, text: "A1" })] }),
    turn({ turnId: "b", prompt: "ask two", piAnchor: 6, events: [ev("answer", { provider: "codex", model: null, text: "A2" })] })
  ];
  const merged = mergeAskTurnsIntoRows(piRows, turns);
  assert.deepEqual(merged, [
    ...piRows.slice(0, 3),
    user("ask one"), sys("codex: A1"),
    ...piRows.slice(3),
    user("ask two"), sys("codex: A2")
  ]);
  assert.deepEqual(merged.filter((r) => piRows.includes(r)), piRows);
});

test("same-anchor turns keep turn order; null anchor appends at the end; anchors past the end are clamped", () => {
  const ans = (id, prompt, at) => turn({ turnId: id, prompt, piAnchor: at, events: [ev("answer", { provider: "p", model: null, text: id })] });
  const merged = mergeAskTurnsIntoRows(piRows.slice(0, 3), [
    ans("x", "qx", 1), ans("y", "qy", 1), ans("z", "qz", null), ans("w", "qw", 99)
  ]);
  assert.deepEqual(merged, [
    piRows[0],
    user("qx"), sys("p: x"), user("qy"), sys("p: y"),
    piRows[1], piRows[2],
    user("qz"), sys("p: z"), user("qw"), sys("p: w")
  ]);
});

test("a later turn never lands before an earlier one, even with a smaller anchor", () => {
  const ans = (id, at) => turn({ turnId: id, prompt: id, piAnchor: at, events: [ev("answer", { provider: "p", model: null, text: id })] });
  const merged = mergeAskTurnsIntoRows(piRows, [ans("late", 4), ans("early", 1)]);
  const order = merged.filter((r) => r.type === "user_message" && (r.content === "late" || r.content === "early"));
  assert.deepEqual(order.map((r) => r.content), ["late", "early"]);
  assert.ok(merged.indexOf(order[1]) > merged.indexOf(order[0]));
});

test("duplicate guard: an identical Pi user row right before the anchor suppresses the ASK user row only", () => {
  const pi = [text("earlier"), settled, user("same prompt")];
  const merged = mergeAskTurnsIntoRows(pi, [
    turn({ turnId: "a", prompt: "same prompt", piAnchor: 3, events: [ev("answer", { provider: "p", model: null, text: "r" })] }),
    turn({ turnId: "b", prompt: "same prompt", piAnchor: 3, events: [ev("answer", { provider: "p", model: null, text: "r2" })] })
  ]);
  assert.deepEqual(merged, [
    ...pi,
    sys("p: r"),
    // the second turn's row is not adjacent to the Pi row: it is kept
    user("same prompt"), sys("p: r2")
  ]);
  // A genuine repeat after an answered Pi prompt is kept.
  const answered = [user("same prompt"), text("reply"), settled];
  const kept = mergeAskTurnsIntoRows(answered, [
    turn({ turnId: "c", prompt: "same prompt", piAnchor: 3, events: [ev("answer", { provider: "p", model: null, text: "r" })] })
  ]);
  assert.deepEqual(kept, [...answered, user("same prompt"), sys("p: r")]);
});

test("no turns returns the Pi rows untouched", () => {
  assert.equal(mergeAskTurnsIntoRows(piRows, []), piRows);
  assert.deepEqual(mergeAskTurnsIntoRows(undefined, []), []);
});

// ---- store ----------------------------------------------------------------

test("missing file, missing session and invalid session all read as no turns", async () => {
  const home = await tmpHome();
  try {
    assert.deepEqual(await readAskTurns(home, ROOT, SID), []);
    assert.deepEqual(await readAskTurns(home, ROOT, null), []);
    assert.deepEqual(await readAskTurns(home, ROOT, "../etc"), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("append writes one JSON object per line and reads back grouped turns in order", async () => {
  const home = await tmpHome();
  try {
    assert.equal(await appendAskRecord(home, ROOT, SID, { type: "turn_start", turnId: "t1", seq: 0, at: "a", prompt: "q1", piAnchor: 4 }), true);
    await appendAskRecord(home, ROOT, SID, { type: "event", turnId: "t1", seq: 1, at: "a", kind: "text", provider: "codex", text: "hi" });
    await appendAskRecord(home, ROOT, SID, { type: "turn_end", turnId: "t1", seq: 2, at: "a", status: "done" });
    await appendAskRecord(home, ROOT, SID, { type: "turn_start", turnId: "t2", seq: 0, at: "b", prompt: "q2", piAnchor: null });
    const raw = await readFile(askEventsPath(home, ROOT, SID), "utf8");
    const lines = raw.split("\n").filter(Boolean);
    assert.equal(lines.length, 4);
    assert.ok(lines.every((l) => JSON.parse(l).v === 1));
    const turns = await readAskTurns(home, ROOT, SID);
    assert.deepEqual(turns.map((t) => [t.turnId, t.prompt, t.piAnchor, t.status]), [
      ["t1", "q1", 4, "done"],
      ["t2", "q2", null, null]
    ]);
    assert.equal(turns[0].events.length, 1);
    assert.equal(turns[0].events[0].text, "hi");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("corrupt lines and a partial trailing line are skipped; the next append starts on a fresh line", async () => {
  const home = await tmpHome();
  try {
    const path = askEventsPath(home, ROOT, SID);
    await mkdir(join(path, ".."), { recursive: true });
    const good = JSON.stringify({ v: 1, type: "turn_start", turnId: "t1", seq: 0, at: "a", prompt: "q", piAnchor: 0 });
    const end = JSON.stringify({ v: 1, type: "turn_end", turnId: "t1", seq: 1, at: "a", status: "done" });
    await writeFile(path, `${good}\nnot json at all\n{"v":1,"type":"event"\n${end}\n{"v":1,"type":"turn_start","turnId":"t2","pro`, "utf8");
    let turns = await readAskTurns(home, ROOT, SID);
    assert.deepEqual(turns.map((t) => t.turnId), ["t1"]);
    assert.equal(turns[0].status, "done");
    await appendAskRecord(home, ROOT, SID, { type: "turn_start", turnId: "t3", seq: 0, at: "c", prompt: "after", piAnchor: null });
    turns = await readAskTurns(home, ROOT, SID);
    assert.deepEqual(turns.map((t) => t.turnId), ["t1", "t3"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("null / invalid session ids write nothing and never throw", async () => {
  const home = await tmpHome();
  try {
    assert.equal(await appendAskRecord(home, ROOT, null, { type: "turn_start", turnId: "t" }), false);
    assert.equal(await appendAskRecord(home, ROOT, "bad id", { type: "turn_start", turnId: "t" }), false);
    assert.equal(await appendAskRecord(home, null, SID, { type: "turn_start", turnId: "t" }), false);
    assert.equal(existsSync(join(home, ".harness")), false);
    // A failing filesystem is swallowed too.
    const failing = { appendFile: async () => { throw new Error("disk full"); } };
    assert.equal(await appendAskRecord(home, ROOT, SID, { type: "event", turnId: "t" }, failing), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("growth policy: only the last MAX_STORED_TURNS whole turns survive a turn_start", async () => {
  const home = await tmpHome();
  try {
    const total = MAX_STORED_TURNS + 5;
    const path = askEventsPath(home, ROOT, SID);
    await mkdir(join(path, ".."), { recursive: true });
    const lines = [];
    for (let i = 0; i < total - 1; i += 1) {
      lines.push(JSON.stringify({ v: 1, type: "turn_start", turnId: `t${i}`, seq: 0, at: "a", prompt: `q${i}`, piAnchor: null }));
      lines.push(JSON.stringify({ v: 1, type: "turn_end", turnId: `t${i}`, seq: 1, at: "a", status: "done" }));
    }
    await writeFile(path, `${lines.join("\n")}\n`, "utf8");
    await appendAskRecord(home, ROOT, SID, { type: "turn_start", turnId: `t${total - 1}`, seq: 0, at: "a", prompt: "last", piAnchor: null });
    const turns = await readAskTurns(home, ROOT, SID);
    assert.equal(turns.length, MAX_STORED_TURNS);
    assert.equal(turns[0].turnId, "t5");
    assert.equal(turns.at(-1).turnId, `t${total - 1}`);
    assert.ok(turns.slice(0, -1).every((t) => t.status === "done"), "kept turns are whole");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("clearAskEvents removes the file (idempotent) and a later read is empty", async () => {
  const home = await tmpHome();
  try {
    await appendAskRecord(home, ROOT, SID, { type: "turn_start", turnId: "t1", seq: 0, at: "a", prompt: "q", piAnchor: 0 });
    assert.equal(existsSync(askEventsPath(home, ROOT, SID)), true);
    assert.equal(await clearAskEvents(home, ROOT, SID), true);
    assert.equal(existsSync(askEventsPath(home, ROOT, SID)), false);
    assert.equal(await clearAskEvents(home, ROOT, SID), true);
    assert.deepEqual(await readAskTurns(home, ROOT, SID), []);
    assert.equal(await clearAskEvents(home, ROOT, null), false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("groupTurns ignores orphan records and keeps only the first terminal", () => {
  const turns = groupTurns([
    { v: 1, type: "event", turnId: "orphan", seq: 1, kind: "text", text: "x" },
    { v: 1, type: "turn_start", turnId: "t1", prompt: "q", piAnchor: 2 },
    { v: 1, type: "turn_end", turnId: "t1", status: "cancelled" },
    { v: 1, type: "turn_end", turnId: "t1", status: "done" },
    { v: 1, type: "event", turnId: "t1", seq: 9, kind: "text", text: "late" }
  ]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].status, "cancelled");
  assert.equal(turns[0].events.length, 0);
});
