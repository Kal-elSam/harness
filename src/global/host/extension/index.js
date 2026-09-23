import { createKernelService } from "../../kernel/service.js";
import { loadKairoWorkspaceSnapshot } from "../workspace-snapshot.js";

export function requestKernelSnapshot(deps = {}) {
  return createKernelService(deps).snapshot();
}

export function workerCardFromEvent(event) {
  return {
    kind: "kairo-worker",
    workerId: event.workerId,
    type: event.type
  };
}

function sessionLabel(session) {
  if (session?.state !== "bound") return "no Kairo session";
  return `session ${session.id.slice(0, 8)} · ${session.mode}`;
}

function usageLabel(usage = []) {
  if (!usage.length) return "no measured usage";
  return usage.map((entry) => {
    const tokens = Number.isFinite(entry?.totalTokens) ? ` ${entry.totalTokens} tokens` : "";
    return `${entry?.provider ?? "unknown"}${tokens}`;
  }).join(" · ");
}

function teamLabel(assignments = []) {
  if (!assignments.length) return "not analyzed";
  return assignments.map((entry) => `${entry.role}: ${entry.model} via ${entry.via}`).join(" · ");
}

export function formatKairoWorkspaceLines(snapshot) {
  return [
    `KAIRO · ${snapshot.project.label} · ${sessionLabel(snapshot.session)}`,
    `TEAM · ${teamLabel(snapshot.team.assignments)}`,
    `USAGE · ${usageLabel(snapshot.usage)} · MEMORY · ${snapshot.memory.status}`,
    "Commands: /kairo /kairo-team /kairo-sessions /kairo-usage /kairo-route /kairo-memory"
  ];
}

function linesForView(snapshot, view) {
  switch (view) {
    case "team":
      return [
        `KAIRO TEAM · ${snapshot.team.state}`,
        ...(snapshot.team.assignments.length
          ? snapshot.team.assignments.map((entry) => `${entry.role} · ${entry.model} · ${entry.via}`)
          : ["Run /project analyze to build this project's team."])
      ];
    case "sessions":
      return [
        "KAIRO SESSION",
        snapshot.session.state === "bound"
          ? `${snapshot.session.id} · ${snapshot.session.title ?? "Untitled"} · ${snapshot.session.mode}`
          : "No Kairo session is bound. Run kairo start or kairo resume."
      ];
    case "usage":
      return ["KAIRO USAGE", usageLabel(snapshot.usage)];
    case "route":
      return ["KAIRO ROUTING", `Project team is ${snapshot.team.state}.`, teamLabel(snapshot.team.assignments)];
    case "memory":
      return ["KAIRO MEMORY", `Engram is ${snapshot.memory.status}.`];
    default:
      return formatKairoWorkspaceLines(snapshot);
  }
}

function workspaceStatus(snapshot) {
  return `Kairo · ${snapshot.project.label} · ${snapshot.session?.mode ?? "ask"}`;
}

async function refreshWorkspace(ctx, { loadSnapshot, env, view = "overview" }) {
  const snapshot = await loadSnapshot({
    cwd: ctx?.cwd ?? process.cwd(),
    sessionId: env?.KAIRO_SESSION_ID ?? null
  });
  ctx?.ui?.setStatus?.("kairo", workspaceStatus(snapshot));
  ctx?.ui?.setWidget?.("kairo-workspace", linesForView(snapshot, view));
  return snapshot;
}

/**
 * Registers the Kairo-owned visual/control surface inside the Pi host. Pi
 * supplies the terminal primitives; this extension supplies Kairo facts and
 * never lets Pi choose a subscription model on Kairo's behalf.
 */
export function createKairoWorkspaceExtension(pi, {
  env = process.env,
  loadSnapshot = loadKairoWorkspaceSnapshot
} = {}) {
  pi.on("session_start", async (_event, ctx) => refreshWorkspace(ctx, { loadSnapshot, env }));

  const commands = [
    ["kairo", "Show Kairo workspace status", "overview"],
    ["kairo-team", "Show this project's routed team", "team"],
    ["kairo-sessions", "Show the bound Kairo session", "sessions"],
    ["kairo-usage", "Show measured Kairo provider usage", "usage"],
    ["kairo-route", "Show current project routing", "route"],
    ["kairo-memory", "Show Kairo memory integration state", "memory"]
  ];
  for (const [name, description, view] of commands) {
    pi.registerCommand(name, {
      description,
      handler: async (_args, ctx) => refreshWorkspace(ctx, { loadSnapshot, env, view })
    });
  }
}

export default function kairoExtension(pi) {
  return createKairoWorkspaceExtension(pi);
}
