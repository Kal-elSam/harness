import { createKernelService } from "../../kernel/service.js";
import { createKairoRouteProvider, loadKairoProviderModels } from "../kairo-route-provider.js";
import { loadKairoWorkspaceSnapshot, loadKairoLiveData } from "../workspace-snapshot.js";
import { blockedRoleNotifications, createKairoTextWidget, createKairoWorkspaceWidget } from "../workspace-widget.js";

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

/** One compact `role · model · via · status` line — used only by the
 * `/kairo-team` detail view (see teamDetailLines below); the overview
 * widget (workspace-widget.js) never prints a per-row status word — see
 * its own doc for why. */
function teamRowLine(row) {
  return `${row.role} · ${row.model} · ${row.via} · ${statusWord(row.availability?.state)}`;
}

/** The always-visible subscription usage line — never behind a command,
 * per the user's real TTY review ("we had it before"). `checking`/
 * `unknown` print the honest state word; real data prints the same
 * segment text the legacy cockpit's compact USAGE bar uses. Used by the
 * plain-text detail views only; the overview widget renders its own
 * themed USAGE panel (workspace-widget.js). */
function subscriptionsLine(subscriptions) {
  const state = subscriptions?.state ?? "checking";
  if (state === "ready") return `USAGE · ${(subscriptions.segments ?? []).join(" │ ")}`;
  return `USAGE · ${state}`;
}

/** `/kairo-team`'s full detail lines, unbounded — every role, plus its
 * full warning text when it has one. Rendered through the component path
 * (createKairoTextWidget), never a plain string array, because 7 real
 * roles with warnings can exceed Pi's MAX_WIDGET_LINES=10 cap. */
function teamDetailLines(team) {
  const rows = Array.isArray(team?.rows) ? team.rows : [];
  return [
    `KAIRO TEAM · ${team?.state ?? "not_analyzed"}`,
    ...(rows.length
      ? rows.flatMap((row) => (row.availability?.warning ? [teamRowLine(row), `  ${row.availability.warning}`] : [teamRowLine(row)]))
      : ["Run /project analyze to build this project's team."])
  ];
}

/** Views whose plain-text content can exceed Pi's MAX_WIDGET_LINES=10 cap
 * — "overview" isn't listed here because it always renders the themed
 * two-panel widget (createKairoWorkspaceWidget), never this plain-text
 * path at all. The others (sessions/usage/route/memory) stay well under
 * 10 lines and are safe as a plain string array. */
const UNBOUNDED_TEXT_VIEWS = new Set(["team", "unavailable-routes"]);

function linesForView(snapshot, view) {
  switch (view) {
    case "team":
      return teamDetailLines(snapshot.team);
    case "sessions":
      return [
        "KAIRO SESSION",
        snapshot.session.state === "bound"
          ? `${snapshot.session.id} · ${snapshot.session.title ?? "Untitled"} · ${snapshot.session.mode}`
          : "No Kairo session is bound. Run kairo start or kairo resume."
      ];
    case "usage":
      // The always-visible subscription line, plus the existing measured
      // per-provider token totals underneath it (a different, complementary
      // real fact — never merged into one line).
      return ["KAIRO USAGE", subscriptionsLine(snapshot.subscriptions), usageLabel(snapshot.usage)];
    case "route":
      return ["KAIRO ROUTING", `Project team is ${snapshot.team.state}.`, teamLabel(snapshot.team.assignments)];
    case "memory":
      return ["KAIRO MEMORY", `Engram is ${snapshot.memory.status}.`];
    case "unavailable-routes":
      // No verified automatic Pi route exists, but the real team is still
      // worth showing — the human can act on it (approve/edit) even
      // before a route is wired up, and this is never a reason to hide
      // real Kairo facts.
      return [
        "KAIRO ROUTES · unavailable",
        "No verified automatic route is available for this project.",
        "Next: run kairo --legacy-cockpit, then /project analyze.",
        subscriptionsLine(snapshot.subscriptions),
        ...teamDetailLines(snapshot.team)
      ];
    default:
      return [];
  }
}

function workspaceStatus(snapshot) {
  return `Kairo · ${snapshot.project.label} · ${snapshot.session?.mode ?? "ask"}`;
}

/** Renders `snapshot` onto the one Kairo widget slot, in the shape `view`
 * needs: the themed two-panel component for "overview", the component
 * path (no line cap) for a detail view that can exceed 10 lines, or a
 * plain string array for a detail view that stays comfortably under it. */
function setWorkspaceWidget(ctx, snapshot, view, extraLines) {
  if (view === "overview") {
    ctx?.ui?.setWidget?.("kairo-workspace", createKairoWorkspaceWidget(snapshot, extraLines));
    return;
  }
  const lines = [...linesForView(snapshot, view), ...extraLines];
  if (UNBOUNDED_TEXT_VIEWS.has(view)) {
    ctx?.ui?.setWidget?.("kairo-workspace", createKairoTextWidget(lines));
    return;
  }
  ctx?.ui?.setWidget?.("kairo-workspace", lines);
}

/** One `ctx.ui.notify` per blocked role, every refresh — never
 * deduplicated across refreshes, since each refresh is its own real
 * snapshot of who is blocked right now (see blockedRoleNotifications'
 * own doc in workspace-widget.js). */
function notifyBlockedRoles(ctx, snapshot) {
  for (const notification of blockedRoleNotifications(snapshot.team)) {
    ctx?.ui?.notify?.(notification.message, "warning");
  }
}

async function refreshWorkspace(ctx, { loadSnapshot, env, view = "overview", intelligence, extraLines = [] }) {
  const snapshot = await loadSnapshot({
    cwd: ctx?.cwd ?? process.cwd(),
    sessionId: env?.KAIRO_SESSION_ID ?? null,
    intelligence
  });
  ctx?.ui?.setStatus?.("kairo", workspaceStatus(snapshot));
  setWorkspaceWidget(ctx, snapshot, view, extraLines);
  notifyBlockedRoles(ctx, snapshot);
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
  loadLiveData = loadKairoLiveData,
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
      setWorkspaceWidget(ctx, snapshot, "unavailable-routes", []);
    }

    // Phase 2: the conversation service's live snapshot probe
    // (loadKairoLiveData — ONE call for team availability AND
    // subscription usage) can be slow, so it never blocks phase 1 above.
    // It fails closed on its own (null on any throw or missing data —
    // see its own doc), never fabricating "available" or real numbers.
    const cwd = ctx?.cwd ?? process.cwd();
    const intelligence = await loadLiveData({ cwd });
    const extraLines = intelligence === null
      ? ["Live availability check failed — team and usage status shown as unknown."]
      : [];
    const refreshedSnapshot = await refreshWorkspace(ctx, { loadSnapshot, env, intelligence, extraLines });
    if (routeState === "unavailable") {
      setWorkspaceWidget(ctx, refreshedSnapshot, "unavailable-routes", extraLines);
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
