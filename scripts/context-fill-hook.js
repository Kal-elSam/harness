#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readContextFill } from "../src/global/observability/context-fill.js";
import {
  checkpointPath,
  loadCheckpoint,
  sessionStartOutput,
  writeCheckpoint
} from "../src/global/observability/context-fill-checkpoint.js";
import { reminderFor } from "../src/global/observability/context-fill-handoff.js";
import {
  adapterMark,
  claimVisibleNotice,
  formatHookOutput,
  installContextFillHooks,
  payloadCwd,
  readCachedReport,
  recordContextFill,
  runtimeAdapter,
  saveEngramObservation
} from "../src/global/observability/context-fill-hook.js";

function failOpen(adapter) {
  process.stdout.write(`${JSON.stringify(formatHookOutput(adapter, null))}\n`);
}

function hookCommand(adapter) {
  return `${process.execPath} ${resolve(fileURLToPath(import.meta.url))} ${adapter}`;
}

async function main() {
  if (process.argv.includes("--install")) {
    const installed = await installContextFillHooks({
      homeDir: homedir(),
      commands: {
        cursor: hookCommand("cursor"),
        claude: hookCommand("claude"),
        codex: hookCommand("codex")
      }
    });
    process.stdout.write(`${installed.join(",")}\n`);
    return;
  }

  let payload = {};
  try {
    const raw = readFileSync(0, "utf8").trim();
    if (raw) payload = JSON.parse(raw);
  } catch {
    payload = {};
  }
  const adapter = runtimeAdapter(process.argv[2], payload);

  try {
    const homeDir = homedir();
    const cwd = payloadCwd(payload) ?? process.cwd();
    const event = payload.hook_event_name || payload.hookEventName || "";
    if (event === "sessionStart" || event === "SessionStart") {
      const text = await loadCheckpoint(homeDir, cwd);
      process.stdout.write(`${JSON.stringify(sessionStartOutput(adapter, text))}\n`);
      return;
    }
    let report = await readCachedReport(homeDir, cwd);
    if (!report) {
      report = await readContextFill({ homeDir, cwd });
      await recordContextFill({ homeDir, report, saveEngram: saveEngramObservation });
    }
    const mark = adapterMark(adapter, report);
    const announce = await claimVisibleNotice(homeDir, cwd, adapter, mark);
    const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
    if (announce) await writeCheckpoint({ homeDir, cwd, report, adapter, prompt });
    const reminder = reminderFor(adapter, report, mark ? checkpointPath(homeDir, cwd) : null);
    process.stdout.write(`${JSON.stringify(formatHookOutput(adapter, reminder, { announce }))}\n`);
  } catch {
    failOpen(adapter);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
