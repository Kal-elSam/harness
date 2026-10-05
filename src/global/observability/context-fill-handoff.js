import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

function projectLabel(cwd) {
  const parts = String(cwd).split("/").filter(Boolean);
  return parts.slice(-2).join("/") || "unknown";
}

export function handoffDir(homeDir, cwd) {
  const label = projectLabel(cwd).replaceAll(/[^a-zA-Z0-9._-]+/g, "-");
  return join(homeDir, ".harness", "handoffs", label);
}

export function reminderFor(adapter, report, handoffPath = null) {
  const own = hotReadings(report).find((item) => item.adapter === adapter);
  if (!own) return null;
  const percent = Math.round(own.ratio * 100);
  const where = handoffPath
    ? `El respaldo quedó en ${handoffPath}.`
    : "El respaldo queda en el directorio global de handoffs, fuera del repo.";
  return `Sesión de ${adapter} al ${percent}%. ${where} Responde al pedido del usuario y sigue los archivos pendientes.`;
}

export function adapterMark(adapter, report) {
  const own = hotReadings(report).find((item) => item.adapter === adapter);
  if (!own) return "";
  return `${adapter}:${Math.round(own.ratio * 20) * 5}:${own.band}`;
}

export function runtimeAdapter(argvAdapter, payload) {
  const event = payload?.hook_event_name || payload?.hookEventName || "";
  if (event === "beforeSubmitPrompt" || payload?.cursor_version) return "cursor";
  return argvAdapter === "claude" || argvAdapter === "codex" ? argvAdapter : "cursor";
}

export function formatHookOutput(adapter, reminder, { announce = false } = {}) {
  if (!reminder) return { continue: true };
  if (adapter === "cursor") return { continue: true, additional_context: reminder };
  if (adapter === "claude" || adapter === "codex") {
    const output = {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: reminder
      }
    };
    if (announce) output.systemMessage = reminder;
    return output;
  }
  return { continue: true };
}

function hotReadings(report) {
  return report.readings.filter((item) => item.status === "measured"
    && (item.band === "handoff" || item.band === "saturated"));
}

export function handoffMarkdown(report, adapter, { prompt = "", note = "" } = {}) {
  const lines = [
    "# Session handoff",
    "",
    `Proyecto: ${projectLabel(report.cwd)}`,
    `Disparado por: ${adapter}`,
    ""
  ];
  for (const item of hotReadings(report)) {
    const percent = Math.round(item.ratio * 100);
    const tokens = item.used != null && item.limit != null ? ` (${item.used}/${item.limit})` : "";
    lines.push(`- ${item.adapter}: ${percent}% usado, banda ${item.band}${tokens}`);
  }
  const last = String(prompt).replaceAll(/\s+/g, " ").trim().slice(0, 280);
  if (last) lines.push("", "## Último pedido", last);
  const state = String(note).trim();
  if (state) lines.push("", "## Estado", state);
  lines.push(
    "",
    "## Siguiente sesión",
    "Compacta este mismo chat. El resumen se queda con este checkpoint y con git.",
    "No abras otro chat y no cargues el transcript.",
    ""
  );
  return `${lines.join("\n")}`;
}

export async function writeSessionHandoff({ homeDir, cwd, report, adapter, prompt = "", note = "" }) {
  const dir = handoffDir(homeDir, cwd);
  await mkdir(dir, { recursive: true });
  const body = handoffMarkdown({ ...report, cwd }, adapter, { prompt, note });
  const latest = join(dir, "latest.md");
  await writeFile(latest, body);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const path = join(dir, `${stamp}-${adapter}.md`);
  await writeFile(path, body);
  return latest;
}
