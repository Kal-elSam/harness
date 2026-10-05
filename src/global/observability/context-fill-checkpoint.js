import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAtomicJson, writeAtomicText } from "../runtime/write-atomic-json.js";
import { handoffDir } from "./context-fill-handoff.js";

const HOOK_MARKER = "context-fill-hook.js";

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 4000, maxBuffer: 200_000 }, (error, stdout) => {
      resolve(error ? "" : String(stdout).trim());
    });
  });
}

function cap(text, maxLines) {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length <= maxLines) return lines.join("\n");
  return `${lines.slice(0, maxLines).join("\n")}\n… ${lines.length - maxLines} más`;
}

function section(text, title) {
  const match = text.match(new RegExp(`## ${title}\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match ? match[1].trim() : "";
}

function keepClaims(text) {
  return text.split("\n").map((line) => line.trim()).filter((line) => line && !/chat nuevo|abre un chat|no abras otro|compacta|transcript|\/compact|\/summarize/i.test(line)).join("\n");
}

export function checkpointPath(homeDir, cwd) {
  return join(handoffDir(homeDir, cwd), "STATE.md");
}

export async function writeCheckpoint({ homeDir, cwd, report, adapter, prompt = "", decisions = "" }) {
  const [branch, commit, status, log, diff] = await Promise.all([
    git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(cwd, ["rev-parse", "--short", "HEAD"]),
    git(cwd, ["status", "--short"]),
    git(cwd, ["log", "-8", "--oneline"]),
    git(cwd, ["diff", "--stat", "HEAD"])
  ]);
  let previous = "";
  const path = checkpointPath(homeDir, cwd);
  try { previous = await readFile(path, "utf8"); } catch { /* first checkpoint */ }
  const keptDecisions = keepClaims(decisions.trim() || section(previous, "Decisiones"));
  const keptMissing = keepClaims(section(previous, "Falta"));
  const hot = (report?.readings ?? []).filter((item) => item.status === "measured" && item.ratio != null);
  const windows = hot.map((item) => `${item.adapter} ${Math.round(item.ratio * 100)}%`).join(", ") || "sin medición";
  void prompt;
  const body = [
    "# Checkpoint",
    "",
    `_Last updated: ${new Date().toISOString()} — ${branch || "sin rama"} @ ${commit || "sin commit"}_`,
    `Disparado por: ${adapter}. Ventanas: ${windows}.`,
    "Compara esto con git status, git diff y git log antes de tratarlo como cierto.",
    "",
    "## Terminado",
    cap(log, 8) || "Sin commits.",
    "",
    "## Pendiente",
    cap(status, 40) || "Árbol de trabajo limpio.",
    "",
    "## Falta",
    keptMissing || "Sin anotar.",
    "",
    "## Decisiones",
    keptDecisions || "Sin decisiones anotadas.",
    "",
    "## Diff",
    cap(diff, 30) || "Sin diff contra HEAD.",
    "",
    "## Siguiente",
    "Sigue los archivos que git status marca como pendientes. No trates una frase cortada como tarea.",
    ""
  ].join("\n");
  await mkdir(handoffDir(homeDir, cwd), { recursive: true });
  await writeAtomicText(path, body);
  return path;
}

export async function loadCheckpoint(homeDir, cwd) {
  try {
    const body = await readFile(checkpointPath(homeDir, cwd), "utf8");
    if (!body.trim()) return "";
    return [
      "Estado del repo. Continúa el trabajo pendiente.",
      "Si este texto y git no coinciden, gana git.",
      "",
      body
    ].join("\n");
  } catch {
    return "";
  }
}

export function sessionStartOutput(adapter, text) {
  if (!text) return { continue: true };
  if (adapter === "claude" || adapter === "codex") {
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: text
      }
    };
  }
  return { continue: true, additional_context: text };
}

async function backupAndWrite(path, value) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await copyFile(path, `${path}.context-fill-backup.${stamp}`).catch(() => {});
  await writeAtomicJson(path, value);
}

function present(value, adapter) {
  return JSON.stringify(value ?? "").includes(`${HOOK_MARKER} ${adapter}`);
}

export async function installSessionStartHooks({ homeDir, commands }) {
  const installed = [];
  const targets = [
    ["cursor", join(homeDir, ".cursor", "hooks.json"), "sessionStart", (doc, command) => {
      doc.hooks ??= {};
      doc.hooks.sessionStart ??= [];
      doc.hooks.sessionStart.push({ command, timeout: 15 });
    }, (doc) => doc.hooks?.sessionStart],
    ["claude", join(homeDir, ".claude", "settings.json"), "SessionStart", (doc, command) => {
      doc.hooks ??= {};
      doc.hooks.SessionStart ??= [];
      doc.hooks.SessionStart.push({ matcher: "", hooks: [{ type: "command", command, timeout: 15 }] });
    }, (doc) => doc.hooks?.SessionStart],
    ["codex", join(homeDir, ".codex", "hooks.json"), "SessionStart", (doc, command) => {
      doc.hooks ??= {};
      doc.hooks.SessionStart ??= [];
      doc.hooks.SessionStart.push({ hooks: [{ type: "command", command, timeout: 15 }] });
    }, (doc) => doc.hooks?.SessionStart]
  ];
  for (const [adapter, path, , add, list] of targets) {
    try {
      const doc = JSON.parse(await readFile(path, "utf8"));
      if (present(list(doc), adapter)) continue;
      add(doc, commands[adapter]);
      await backupAndWrite(path, doc);
      installed.push(`${adapter}-session`);
    } catch { /* that tool is not configured */ }
  }
  return installed;
}
