#!/usr/bin/env node
/**
 * Mock JSONL sidecar for the suggested-alternative modal PTY check
 * (scripts/kairo-ui-alternative-modal-pty-e2e.py).
 *
 * Emits `ready`, then ONE `plan_preview` that carries a `suggestedAlternative`
 * and a `confirmationTarget`, exactly as the real sidecar's `plans.preview`
 * does (autoExecuted is always false). Every op the host sends is appended to
 * KAIRO_ALT_E2E_LOG as `in <raw JSON line>`. It never executes anything, never
 * answers `plans.execute`, and never talks to a provider.
 *
 * Env: KAIRO_ALT_E2E_LOG (required), KAIRO_ALT_E2E_PREVIEW_MS (default 700).
 */
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const logPath = process.env.KAIRO_ALT_E2E_LOG || "";
const log = (line) => {
  if (!logPath) return;
  try {
    appendFileSync(logPath, `${line}\n`);
  } catch {
    // evidence only
  }
};

const args = process.argv.slice(2);
let cwd = process.cwd();
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--cwd" && args[i + 1]) cwd = args[++i];
}

const write = (record) => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
  log(`out ${record.type}`);
};

export const CONFIRMATION_TARGET = Object.freeze({
  role: "Builder",
  selection: "suggested-alternative",
  strategyFingerprint: "fp-alt-e2e",
  candidateKey: "claude::claude-opus-5"
});

write({
  type: "ready",
  engine: {
    status: "connected",
    reason: null,
    sessionId: "alt-e2e-session",
    model: { id: "mock-model", provider: "kairo", displayName: "Mock" }
  },
  snapshot: {
    project: { label: "alt-e2e", root: cwd },
    agents: [],
    team: { state: "not_analyzed", rows: [] },
    subscriptions: { state: "ready", segments: [] }
  },
  sessions: [],
  draft: null,
  kairoModels: []
});

setTimeout(() => {
  write({
    type: "plan_preview",
    taskId: "task-alt-1",
    decision: "WAIT_FOR_PROJECT_TEAM",
    role: "Builder",
    why: "GPT-6 Astra is unavailable (simulated)",
    confirmationTarget: CONFIRMATION_TARGET,
    blockedAssignment: { provider: "codex", model: { displayName: "GPT-6 Astra" } },
    suggestedAlternative: {
      provider: "claude",
      model: { displayName: "Claude Opus", modelId: "claude-opus-5" }
    },
    autoExecuted: false
  });
}, Number(process.env.KAIRO_ALT_E2E_PREVIEW_MS || 700));

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  log(`in ${line}`);
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    return;
  }
  if (cmd?.op === "stop") process.exit(0);
});
rl.on("close", () => process.exit(0));
