#!/usr/bin/env node
/**
 * Fake `codex exec --json` for the ASK PTY end-to-end. NEVER a real provider.
 *
 * Spawned by the real `askProvider` (through the wrapper sidecar's `spawn`
 * override) with the exact argv askCodex builds:
 *   <marker> exec --sandbox read-only --skip-git-repo-check -o <file> --json <question>
 *
 * Behaviour is driven by the question text:
 *   Env KAIRO_ASK_E2E_TOOL_IDS=fixed reuses tool id "cmd1" on every turn.
 *   default   : tool_start, progress, tool_end, then writes ZEBRA-ANSWER-<Qn>
 *               to the -o file and exits 0 (events are spaced so the PTY can
 *               observe them incrementally).
 *   "SLOW"    : tool_start + progress, spawns a GRANDCHILD (same process
 *               group), then idles until killed (self-exits after 120s).
 *   "STUBBORN": as SLOW, but ignores SIGTERM (only SIGKILL ends it).
 *
 * Evidence: every pid and signal is appended to `$KAIRO_ASK_E2E_DIR/pids.log`.
 * The marker argv (`--kairo-ask-e2e-marker=<dir>`) lets the harness find
 * strays by `ps`.
 */
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const marker = argv.find((a) => a.startsWith("--kairo-ask-e2e-marker="))?.split("=")[1] ?? "";
const dir = process.env.KAIRO_ASK_E2E_DIR ?? "";
const outIdx = argv.indexOf("-o");
const outFile = outIdx >= 0 ? argv[outIdx + 1] : null;
const question = argv.at(-1) ?? "";
const turn = [...question.matchAll(/Q\d+/g)].at(-1)?.[0] ?? "Q0";
const slow = /SLOW|STUBBORN/.test(question.split("\n").at(-1) ?? question);
const stubborn = /STUBBORN/.test(question.split("\n").at(-1) ?? question);

// Tool item ids: unique per turn by default. `KAIRO_ASK_E2E_TOOL_IDS=fixed`
// reuses the same id every turn, like a fresh `codex exec` per ASK turn whose
// item ids restart (UNVERIFIED against the real CLI) -- see scenario `collide`.
const toolId = process.env.KAIRO_ASK_E2E_TOOL_IDS === "fixed" ? "cmd1" : `cmd-${turn}-${process.pid}`;

const log = (line) => {
  if (!dir) return;
  try {
    appendFileSync(join(dir, "pids.log"), `${line}\n`);
  } catch {
    // evidence only
  }
};
const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

log(`child ${process.pid} turn=${turn} slow=${slow} stubborn=${stubborn}`);
process.on("SIGTERM", () => {
  log(`child ${process.pid} SIGTERM${stubborn ? " ignored" : " exiting"}`);
  if (!stubborn) process.exit(143);
});
process.on("SIGINT", () => process.exit(130));

emit({ type: "thread.started", thread_id: "fake-thread" });
await sleep(500);
emit({ type: "item.started", item: { id: toolId, type: "command_execution", command: "ls -la", status: "in_progress" } });
await sleep(600);
emit({ type: "item.completed", item: { id: "r1", type: "reasoning", text: "Inspecting the repository layout" } });

if (slow) {
  const grand = spawn(
    process.execPath,
    ["-e", "setTimeout(()=>{},600000)", "--", `--kairo-ask-e2e-marker=${marker}`],
    { stdio: "ignore" }
  );
  log(`grandchild ${grand.pid} parent=${process.pid}`);
  await sleep(120000);
  log(`child ${process.pid} self-timeout`);
  process.exit(3);
}

await sleep(700);
emit({ type: "item.completed", item: { id: toolId, type: "command_execution", command: "ls -la", status: "completed", exit_code: 0 } });
await sleep(700);
if (outFile) writeFileSync(outFile, `ZEBRA-ANSWER-${turn}\n`);
log(`child ${process.pid} done`);
