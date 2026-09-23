import { createKernelService } from "../../kernel/service.js";
import { createKairoRouteProvider, loadKairoProviderModels } from "../kairo-route-provider.js";
import { loadKairoWorkspaceSnapshot, loadKairoTeamAvailability } from "../workspace-snapshot.js";

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

/** The status word shown per role row — BLOCKED is upper-case, the only
 * word worth catching a glance at; the rest read as ordinary prose. */
function statusWord(state) {
  switch (state) {
    case "available": return "available";
    case "blocked": return "BLOCKED";
    case "checking": return "checking";
    default: return "unknown";
  }
}

/** One compact `role · model · via · status` line — no warning text here
 * (that's the whole point of keeping the overview short); the full
 * warning only ever shows in the `/kairo-team` detail view below. */
function teamRowLine(row) {
  return `${row.role} · ${row.model} · ${row.via} · ${statusWord(row.availability?.state)}`;
}

/** Every real role on its own row, not a count — the overview's entire
 * team section. `rows` is empty before a real ProjectStrategy exists. */
function teamOverviewLines(team) {
  const rows = Array.isArray(team?.rows) ? team.rows : [];
  return [`TEAM · ${team?.state ?? "not_analyzed"}`, ...rows.map(teamRowLine)];
}

export function formatKairoWorkspaceLines(snapshot) {
  return [
    `KAIRO WORKSPACE · ${snapshot.project.label}`,
    `SESSION · ${sessionLabel(snapshot.session)}`,
    ...teamOverviewLines(snapshot.team),
    "Details: /kairo-team · /kairo-route · /kairo-usage · /kairo-memory"
  ];
}

function linesForView(snapshot, view) {
  switch (view) {
    case "team": {
      const rows = Array.isArray(snapshot.team.rows) ? snapshot.team.rows : [];
      return [
        `KAIRO TEAM · ${snapshot.team.state}`,
        ...(rows.length
          ? rows.flatMap((row) => (row.availability?.warning ? [teamRowLine(row), `  ${row.availability.warning}`] : [teamRowLine(row)]))
          : ["Run /project analyze to build this project's team."])
      ];
    }
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

/** No verified automatic Pi route exists, but the real team is still
 * worth showing — the human can act on it (approve/edit) even before a
 * route is wired up, and this is never a reason to hide real Kairo facts. */
function unavailableRoutesLines(snapshot) {
  return [
    "KAIRO ROUTES · unavailable",
    "No verified automatic route is available for this project.",
    "Next: run kairo --legacy-cockpit, then /project analyze.",
    ...teamOverviewLines(snapshot.team)
  ];
}

async function refreshWorkspace(ctx, { loadSnapshot, env, view = "overview", intelligence, extraLines = [] }) {
  const snapshot = await loadSnapshot({
    cwd: ctx?.cwd ?? process.cwd(),
    sessionId: env?.KAIRO_SESSION_ID ?? null,
    intelligence
  });
  ctx?.ui?.setStatus?.("kairo", workspaceStatus(snapshot));
  ctx?.ui?.setWidget?.("kairo-workspace", [...linesForView(snapshot, view), ...extraLines]);
  return snapshot;
}

/**
 * Registers the Kairo-owned visual/control surface inside the Pi host. Pi
 * supplies the terminal primitives; this extension supplies Kairo facts and
 * never lets Pi choose a subscription model on Kairo's behalf.
 */
export function createKairoWorkspaceExtension(pi, {
  env = process.env,
  loadSnapshot = loadKairoWorkspaceSnapshot,
  loadTeamAvailability = loadKairoTeamAvailability,
  loadRouteModels = loadKairoProviderModels,
  createProvider = createKairoRouteProvider
} = {}) {
  let registered = false;
  let routeState = "unknown";

  async function registerRoutes(cwd = process.cwd()) {
    if (registered) return true;
    const models = await loadRouteModels({ cwd });
    if (models.length === 0) {
      routeState = "unavailable";
      return false;
    }
    pi.registerProvider("kairo", createProvider({ models, cwd }));
    registered = true;
    routeState = "available";
    return true;
  }

  pi.on("session_start", async (_event, ctx) => {
    await registerRoutes(ctx?.cwd ?? process.cwd());

    // Phase 1: render immediately from the persisted strategy — every
    // row's availability shows "checking" (see workspace-snapshot.js's
    // own doc), never blocked on the live probe below.
    const snapshot = await refreshWorkspace(ctx, { loadSnapshot, env });
    if (routeState === "unavailable") {
      ctx?.ui?.setWidget?.("kairo-workspace", unavailableRoutesLines(snapshot));
    }

    // Phase 2: the conversation service's live modelIntelligence probe
    // (loadKairoTeamAvailability) can be slow, so it never blocks phase
    // 1 above. It fails closed on its own (null on any throw or missing
    // data — see its own doc), never fabricating "available".
    const cwd = ctx?.cwd ?? process.cwd();
    const intelligence = await loadTeamAvailability({ cwd });
    const extraLines = intelligence === null
      ? ["Live availability check failed — team status shown as unknown."]
      : [];
    const refreshedSnapshot = await refreshWorkspace(ctx, { loadSnapshot, env, intelligence, extraLines });
    if (routeState === "unavailable") {
      ctx?.ui?.setWidget?.("kairo-workspace", [...unavailableRoutesLines(refreshedSnapshot), ...extraLines]);
    }
  });

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

  return {
    registerRoutes
  };
}

export default async function kairoExtension(pi) {
  const extension = createKairoWorkspaceExtension(pi);
  await extension.registerRoutes(process.cwd());
  return extension;
}
