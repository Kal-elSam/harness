import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";
import { installSessionStartHooks } from "./context-fill-checkpoint.js";
import {
  CONTEXT_FILL_CACHE_MS,
  CONTEXT_FILL_SCHEMA,
  projectLabel
} from "./context-fill-constants.js";
import {
  mutateContextFillState,
  readContextFillState
} from "./context-fill-state.js";

export {
  adapterMark,
  formatHookOutput,
  reminderFor,
  runtimeAdapter
} from "./context-fill-handoff.js";

export { CONTEXT_FILL_CACHE_MS, CONTEXT_FILL_SCHEMA, projectLabel } from "./context-fill-constants.js";

const HOOK_MARKER = "context-fill-hook.js";

export function payloadCwd(payload) {
  const candidates = [
    payload?.cwd,
    payload?.workspaceRoot,
    payload?.workspace_root,
    payload?.workspace_roots?.[0],
    payload?.workspaceRoots?.[0]
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.startsWith("/")) return value;
  }
  return null;
}

function hotReadings(report) {
  return report.readings.filter((item) => item.status === "measured"
    && (item.band === "handoff" || item.band === "saturated"));
}

export function fillFingerprint(report) {
  return hotReadings(report)
    .map((item) => `${item.adapter}:${Math.round(item.ratio * 20) * 5}:${item.band}`)
    .join("|");
}

export function engramObservation(report) {
  const hot = hotReadings(report);
  if (!hot.length) return null;
  const label = projectLabel(report.cwd);
  const summary = hot.map((item) => `${item.adapter} ${Math.round(item.ratio * 100)}% (${item.band})`).join("; ");
  return {
    title: `Context fill ${label}`,
    topic: "context/window-fill",
    content: [
      `**What**: ${summary} for ${label}.`,
      "**Why**: The context quality budget is spent. Write handoff.md before architecture work.",
      `**Where**: ${label}`,
      "**Learned**: The percentage belongs to that tool's own session. OpenCode counters accumulate and are not a live window."
    ].join("\n")
  };
}

function slim(report) {
  return report.readings.map((item) => ({
    adapter: item.adapter,
    status: item.status,
    used: item.used,
    limit: item.limit,
    ratio: item.ratio,
    band: item.band
  }));
}

async function readState(homeDir) {
  return readContextFillState(homeDir);
}

export async function readCachedReport(homeDir, cwd, now = Date.now()) {
  const entry = (await readState(homeDir)).projects[projectLabel(cwd)];
  if (!entry?.measuredAt || !Array.isArray(entry.readings)) return null;
  if (now - Date.parse(entry.measuredAt) >= CONTEXT_FILL_CACHE_MS) return null;
  const cursor = entry.readings.find((item) => item.adapter === "cursor");
  if (cursor?.status === "unavailable") return null;
  return { cwd, readings: entry.readings };
}

export async function recordContextFill({
  homeDir,
  report,
  now = Date.now(),
  saveEngram = async () => {}
} = {}) {
  const fingerprint = fillFingerprint(report);
  let remembered = false;
  await mutateContextFillState(homeDir, async (state) => {
    const label = projectLabel(report.cwd);
    const previous = state.projects[label] ?? {};
    let engramFingerprint = previous.engramFingerprint ?? null;
    if (fingerprint && fingerprint !== engramFingerprint) {
      const observation = engramObservation(report);
      if (observation && await saveEngram(observation, report.cwd)) {
        engramFingerprint = fingerprint;
      }
    }
    remembered = engramFingerprint === fingerprint && Boolean(fingerprint);
    state.projects[label] = {
      cwd: report.cwd,
      measuredAt: new Date(now).toISOString(),
      fingerprint,
      engramFingerprint,
      announced: previous.announced ?? {},
      readings: slim(report)
    };
  });
  return { fingerprint, remembered };
}

export async function claimVisibleNotice(homeDir, cwd, adapter, mark) {
  if (!mark) return false;
  return mutateContextFillState(homeDir, (state) => {
    const label = projectLabel(cwd);
    const previous = state.projects[label] ?? {};
    const announced = { ...(previous.announced ?? {}) };
    if (announced[adapter] === mark) return false;
    announced[adapter] = mark;
    state.projects[label] = { ...previous, announced };
    return true;
  });
}

export function saveEngramObservation(observation, cwd, spawnImpl = spawn) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl("engram", [
        "save", observation.title, observation.content,
        "--type", "discovery",
        "--topic", observation.topic
      ], { cwd, stdio: "ignore" });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      child.kill?.();
      resolve(false);
    }, 4000);
    child.on?.("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on?.("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

function commandPresent(value, adapter) {
  return JSON.stringify(value ?? "").includes(`${HOOK_MARKER} ${adapter}`);
}

async function backupAndWrite(path, value) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await copyFile(path, `${path}.context-fill-backup.${stamp}`).catch(() => {});
  await writeAtomicJson(path, value);
}

export async function installContextFillHooks({ homeDir, commands }) {
  const installed = [];
  const targets = [
    {
      adapter: "cursor",
      path: join(homeDir, ".cursor", "hooks.json"),
      add(doc) {
        doc.hooks ??= {};
        doc.hooks.beforeSubmitPrompt ??= [];
        doc.hooks.beforeSubmitPrompt.push({ command: commands.cursor, timeout: 15 });
      },
      list: (doc) => doc.hooks?.beforeSubmitPrompt
    },
    {
      adapter: "claude",
      path: join(homeDir, ".claude", "settings.json"),
      add(doc) {
        doc.hooks ??= {};
        doc.hooks.UserPromptSubmit ??= [];
        doc.hooks.UserPromptSubmit.push({
          matcher: "",
          hooks: [{ type: "command", command: commands.claude, timeout: 15 }]
        });
      },
      list: (doc) => doc.hooks?.UserPromptSubmit
    },
    {
      adapter: "codex",
      path: join(homeDir, ".codex", "hooks.json"),
      add(doc) {
        doc.hooks ??= {};
        doc.hooks.UserPromptSubmit ??= [];
        doc.hooks.UserPromptSubmit.push({
          hooks: [{ type: "command", command: commands.codex, timeout: 15 }]
        });
      },
      list: (doc) => doc.hooks?.UserPromptSubmit
    }
  ];

  for (const target of targets) {
    try {
      const doc = JSON.parse(await readFile(target.path, "utf8"));
      if (commandPresent(target.list(doc), target.adapter)) continue;
      target.add(doc);
      await backupAndWrite(target.path, doc);
      installed.push(target.adapter);
    } catch { /* that tool is not configured */ }
  }
  const sessions = await installSessionStartHooks({ homeDir, commands });
  return [...installed, ...sessions];
}
