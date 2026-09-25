import { createKernelService } from "../../kernel/service.js";
import { createKairoRouteProvider, loadKairoProviderModels } from "../kairo-route-provider.js";
import {
  loadKairoWorkspaceSnapshot, loadKairoLiveData, loadKairoUsageData, recoverKairoProjectTeam
} from "../workspace-snapshot.js";
import { availabilityNotices, createKairoTextWidget, createKairoWorkspaceWidget, formatSessionIdentity } from "../workspace-widget.js";
import { MAX_RECOVERY_ATTEMPTS } from "../../conversation/team-recovery.js";
import { resolveHomeDir } from "../../paths.js";
import { resolveProjectRoot } from "../../architect/architect-store.js";
import { createSession, getSession, isValidSessionId } from "../../conversation/session-registry.js";
import { lookupPiBinding, recordPiBinding } from "../../conversation/pi-session-bindings.js";

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
  return `Kairo · ${snapshot.project.label} · ${formatSessionIdentity(snapshot.session)}`;
}

/** Renders `snapshot` onto the one Kairo widget slot, in the shape `view`
 * needs: the themed two-panel component for "overview", the component
 * path (no line cap) for a detail view that can exceed 10 lines, or a
 * plain string array for a detail view that stays comfortably under it.
 * Every non-overview view gets the same shared session-identity line
 * (see formatSessionIdentity) appended once here — the overview shows it
 * through its own USAGE panel footer, so every view that can occupy the
 * one Kairo widget slot names the bound session the same honest way. */
function setWorkspaceWidget(ctx, snapshot, view, extraLines) {
  if (view === "overview") {
    ctx?.ui?.setWidget?.("kairo-workspace", createKairoWorkspaceWidget(snapshot, extraLines));
    return;
  }
  const lines = [...linesForView(snapshot, view), formatSessionIdentity(snapshot.session), ...extraLines];
  if (UNBOUNDED_TEXT_VIEWS.has(view)) {
    ctx?.ui?.setWidget?.("kairo-workspace", createKairoTextWidget(lines));
    return;
  }
  ctx?.ui?.setWidget?.("kairo-workspace", lines);
}

/**
 * The Pi message for a team-recovery outcome, or null when it should stay
 * quiet (baseline, already handled, backing off, lock held, no active team).
 * @param {object} result - runTeamRecovery's result (or {outcome: "error"})
 * @returns {{message: string, level: "info"|"warning"}|null}
 */
function recoveryNotice(result) {
  if (result?.outcome === "activated") {
    const team = (result.strategy?.projectTeam ?? [])
      .map((entry) => `${entry.role} → ${entry.model?.displayName ?? entry.model?.modelId ?? "no eligible option"}`)
      .join(", ");
    return { level: "info", message: `Kairo recovered the project team after a provider availability change: ${team}. Pi routes are updated.` };
  }
  if (result?.outcome === "kept-previous" || result?.outcome === "error") {
    return {
      level: "warning",
      message: `Kairo could not recover the project team (${result.reason ?? "unknown reason"}). The current team stays active and Kairo retries on a later refresh. To recover now: run kairo --legacy-cockpit, then /project analyze.`
    };
  }
  if (result?.outcome === "skipped" && result.reason === "retries-exhausted") {
    return {
      level: "warning",
      message: `Kairo stopped retrying team recovery after ${MAX_RECOVERY_ATTEMPTS} attempts (last: ${result.lastOutcome ?? "unknown"}). Next: run kairo --legacy-cockpit, then /project analyze.`
    };
  }
  return null;
}

/**
 * Loads a fresh snapshot and paints it onto the widget/status bar — unless
 * `isCurrent()` says this render has been superseded by a later session
 * lifecycle event while `loadSnapshot` was in flight. `loadSnapshot` itself
 * can take real, variable time (strategy/usage/Engram reads), and a
 * `sessionId` captured at call time never changes even though the shared
 * `boundKairoSessionId` this render's caller read it from may move on to a
 * newer session before the read resolves (see the `isCurrent` doc on the
 * session_start handler below). Painting a superseded snapshot would show
 * the WRONG session id on top of an already-correct render, exactly the
 * "never reuse another Kairo identity" case P02 forbids — so a stale
 * result is discarded here, never painted, even though the data it holds
 * is real (just for a session that is no longer the active one).
 */
async function refreshWorkspace(ctxOrCwd, {
  loadSnapshot, sessionId = null, view = "overview", usageIntelligence, availabilityIntelligence, extraLines = [], onSnapshot = () => {}, isCurrent = () => true
}) {
  // Pi's ctx becomes stale after an async yield following a session replacement
  // (Pi asserts ctx.cwd/ctx.ui). Capture cwd/ui synchronously at call time;
  // callers must pass a fresh ctx or a plain {cwd, ui} bag. See stale-ctx
  // error at index.js:186 after /new in real TTY (2026-09-24).
  const cwd = typeof ctxOrCwd === "string" ? ctxOrCwd : (ctxOrCwd?.cwd ?? process.cwd());
  const ui = typeof ctxOrCwd === "string" ? undefined : ctxOrCwd?.ui;
  const ctxForWidget = typeof ctxOrCwd === "string" ? { ui } : ctxOrCwd;
  const snapshot = await loadSnapshot({
    cwd,
    sessionId,
    usageIntelligence,
    availabilityIntelligence
  });
  if (!isCurrent()) return snapshot;
  ui?.setStatus?.("kairo", workspaceStatus(snapshot));
  setWorkspaceWidget(ctxForWidget, snapshot, view, extraLines);
  onSnapshot(snapshot, { liveAvailability: availabilityIntelligence != null });
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
  loadUsageData = loadKairoUsageData,
  loadLiveData = loadKairoLiveData,
  loadRouteModels = loadKairoProviderModels,
  createProvider = createKairoRouteProvider,
  recoverTeam = recoverKairoProjectTeam,
  resolveHomeDirImpl = resolveHomeDir,
  resolveProjectRootImpl = resolveProjectRoot,
  createSessionImpl = createSession,
  getSessionImpl = getSession,
  lookupPiBindingImpl = lookupPiBinding,
  recordPiBindingImpl = recordPiBinding
} = {}) {
  let routeSignature = null;
  let routeState = "unknown";
  let shownAvailabilityKeys = new Set();
  const shownRecoveryKeys = new Set();
  let pendingRecovery = Promise.resolve(null);
  // The Kairo session currently bound to THIS Pi process, held in memory —
  // never re-derived from env on every refresh (see bindSession below).
  // null means genuinely unbound, presented as such, never a silent "ask".
  let boundKairoSessionId = null;
  // Bumped once at the START of every session_start invocation (see below).
  // A render belongs to the most recent session_start iff its own captured
  // generation still equals this counter when its (possibly slow) snapshot
  // read resolves — a session replacement (new/resume/fork) fired while an
  // older render's loadSnapshot was still in flight bumps this counter and
  // makes that older render's eventual result stale, so it is discarded
  // instead of painting an old session's id over the current one. Fixes
  // the real-TTY defect where a slow /new refresh finally resolved after
  // /resume and /fork had already rebound and correctly rendered, briefly
  // repainting the abandoned /new session id on top of the correct one.
  let renderGeneration = 0;

  /**
   * Keeps `boundKairoSessionId` in step with Pi's own session lifecycle.
   * Per the P02 design (bind everything): startup/reload adopt the id Pi
   * was launched with; new/resume/fork each resolve or create a real Kairo
   * session and record it against the current Pi session id. Any failure
   * anywhere in this — a missing Pi session id when one is required, an
   * invalid env value, a registry or binding-store error — leaves the
   * extension unbound with a visible notice; it never keeps a stale id.
   */
  async function bindSession(ctx, event) {
    const reason = event?.reason ?? "startup";
    // Capture Pi session id, cwd and ui synchronously — Pi marks ctx stale
    // after any async yield following a replacement (see stale-ctx error).
    const piSessionId = ctx?.sessionManager?.getSessionId?.() ?? null;
    const cwd = ctx?.cwd ?? process.cwd();
    const ui = ctx?.ui;

    // Shared by "startup" and reload's own fallback: bind to the id Pi was
    // launched with, recording it against the current Pi session when one
    // is known. Never called when a real Pi->Kairo mapping already exists
    // for this Pi session — that takes priority (see "reload" below).
    async function bindFromEnv() {
      const envSessionId = env?.KAIRO_SESSION_ID ?? null;
      if (envSessionId == null) {
        // No session was provided at launch (e.g. Pi started outside
        // Kairo) — genuinely unbound, not an error, so no notice.
        boundKairoSessionId = null;
        return;
      }
      if (!isValidSessionId(envSessionId)) {
        throw new Error(`Invalid Kairo session id "${envSessionId}" from KAIRO_SESSION_ID.`);
      }
      boundKairoSessionId = envSessionId;
      if (piSessionId != null) {
        const homeDir = resolveHomeDirImpl(env);
        const projectRoot = await resolveProjectRootImpl(cwd);
        await recordPiBindingImpl(homeDir, projectRoot, piSessionId, envSessionId);
      }
    }

    try {
      if (reason === "startup") {
        await bindFromEnv();
        return;
      }

      if (reason === "reload") {
        // Pi reloads the extension on /reload, so the in-memory binding is
        // lost — recover the CURRENT Pi session's own recorded mapping
        // first. Falling back to env unconditionally would silently
        // rebind to the ORIGINAL launch session after a /new or /fork in
        // the same process: exactly the "reuse another Kairo identity"
        // case P02 forbids.
        if (piSessionId != null) {
          const homeDir = resolveHomeDirImpl(env);
          const projectRoot = await resolveProjectRootImpl(cwd);
          const boundId = await lookupPiBindingImpl(homeDir, projectRoot, piSessionId);
          if (boundId != null) {
            const existing = await getSessionImpl(homeDir, projectRoot, boundId);
            if (existing) {
              boundKairoSessionId = existing.id;
              return;
            }
            // A real mapping exists but its Kairo session is gone — never
            // fall back to env here, that would be exactly the reuse this
            // branch exists to prevent.
            throw new Error(`Kairo session "${boundId}" recorded for this Pi session no longer exists.`);
          }
        }
        // No mapping (or no Pi session id at all) — same as startup.
        await bindFromEnv();
        return;
      }

      if (piSessionId == null) {
        throw new Error(`Pi did not provide a session id for a "${reason}" session_start.`);
      }
      const homeDir = resolveHomeDirImpl(env);
      const projectRoot = await resolveProjectRootImpl(cwd);

      if (reason === "new") {
        const session = await createSessionImpl(homeDir, projectRoot, {});
        await recordPiBindingImpl(homeDir, projectRoot, piSessionId, session.id);
        boundKairoSessionId = session.id;
        return;
      }

      if (reason === "resume") {
        const boundId = await lookupPiBindingImpl(homeDir, projectRoot, piSessionId);
        const existing = boundId != null ? await getSessionImpl(homeDir, projectRoot, boundId) : null;
        if (existing) {
          boundKairoSessionId = existing.id;
          return;
        }
        // Never silently reuse a stale or missing binding — start a real
        // new session instead and say so, visibly.
        const session = await createSessionImpl(homeDir, projectRoot, {});
        await recordPiBindingImpl(homeDir, projectRoot, piSessionId, session.id);
        boundKairoSessionId = session.id;
        ui?.notify?.(
          `No Kairo session was found for this Pi session — started a new one (${session.id.slice(0, 8)}).`,
          "info"
        );
        return;
      }

      if (reason === "fork") {
        const previous = boundKairoSessionId != null
          ? await getSessionImpl(homeDir, projectRoot, boundKairoSessionId)
          : null;
        const mode = previous?.mode ?? "ask";
        const session = await createSessionImpl(homeDir, projectRoot, { mode });
        await recordPiBindingImpl(homeDir, projectRoot, piSessionId, session.id);
        boundKairoSessionId = session.id;
        ui?.notify?.(
          `Forked to a new Kairo session (${session.id.slice(0, 8)}) in ${mode} mode.`,
          "info"
        );
        return;
      }

      throw new Error(`Unknown session_start reason "${reason}".`);
    } catch (error) {
      boundKairoSessionId = null;
      ui?.notify?.(
        `Kairo session binding failed (${error.message}); Pi is running unbound.`,
        "error"
      );
    }
  }

  /**
   * Keeps Pi's "kairo" provider in step with the ACTIVE team. Pi's
   * registerProvider replaces a provider's models and applies immediately
   * after load, so a recovered team is routable without restarting Pi. An
   * unchanged route set is not re-registered; an empty one is unregistered
   * so no stale route survives a team change.
   */
  async function registerRoutes(cwd = process.cwd()) {
    const models = await loadRouteModels({ cwd });
    if (models.length === 0) {
      if (routeSignature !== null) pi.unregisterProvider?.("kairo");
      routeSignature = null;
      routeState = "unavailable";
      return false;
    }
    const signature = JSON.stringify(models.map((model) => [model.id, model.kairoRoute ?? null]));
    if (signature !== routeSignature) {
      pi.registerProvider("kairo", createProvider({ models, cwd }));
      routeSignature = signature;
    }
    routeState = "available";
    return true;
  }

  /**
   * Availability notices only from FRESH live availability: command and
   * first-paint refreshes render from the persisted strategy or a cache and
   * neither notify nor forget what was shown. A provider window is shown
   * once while it stays limited, and again only after it clears and returns.
   */
  function notifyAvailability(ctx, snapshot, { liveAvailability }) {
    if (!liveAvailability) return;
    const notices = availabilityNotices(snapshot.team);
    for (const notice of notices) {
      if (!shownAvailabilityKeys.has(notice.key)) ctx?.ui?.notify?.(notice.message, "warning");
    }
    shownAvailabilityKeys = new Set(notices.map((notice) => notice.key));
  }

  async function runRecovery(ctx, cwd, rerender) {
    const result = await recoverTeam({ cwd });
    if (result?.outcome === "activated") {
      await registerRoutes(cwd);
      await rerender();
    }
    const notice = recoveryNotice(result);
    const key = `${result?.fingerprint ?? ""}|${result?.outcome}|${result?.reason ?? ""}`;
    if (notice && !shownRecoveryKeys.has(key)) {
      shownRecoveryKeys.add(key);
      ctx?.ui?.notify?.(notice.message, notice.level);
    }
    return result;
  }

  pi.on("session_start", async (event, ctx) => {
    // Every session_start invocation supersedes any still-in-flight render
    // from an earlier one (see renderGeneration's own doc above) — bumped
    // synchronously, before any await, so a fast-following new/resume/fork
    // always wins over a slower earlier refresh's eventual result.
    const myGeneration = ++renderGeneration;
    const isCurrent = () => renderGeneration === myGeneration;

    // Capture cwd/ui synchronously — Pi marks ctx stale after any async
    // yield following a replacement (see stale-ctx error at 186).
    const cwd = ctx?.cwd ?? process.cwd();
    const ui = ctx?.ui;
    const ctxBag = { cwd, ui, sessionManager: ctx?.sessionManager };
    await bindSession(ctx, event);
    await registerRoutes(cwd);

    // Phase 1: render immediately from the persisted strategy — every
    // row's availability shows "checking" and usage shows "checking" (see
    // workspace-snapshot.js's own doc), never blocked on either live probe
    // below.
    const snapshot = await refreshWorkspace(ctxBag, {
      loadSnapshot,
      sessionId: boundKairoSessionId,
      onSnapshot: (snap, info) => notifyAvailability(ctxBag, snap, info),
      isCurrent
    });
    if (routeState === "unavailable" && isCurrent()) {
      setWorkspaceWidget(ctxBag, snapshot, "unavailable-routes", []);
    }

    // Phase 2 (P01.2 split): usage (the three usage readers, ~5s combined)
    // and team availability (the full conversation-service snapshot probe,
    // ~20s on the user's machine) resolve from two INDEPENDENT probes —
    // each re-renders the widget as soon as IT arrives, in whichever order
    // that happens, never waiting on the other (see the P01.2 "Why" in
    // odd/tasks/kairo-pi-parity.md). `latest*` tracks the most recently
    // resolved value of the OTHER probe so a re-render never regresses an
    // already-resolved side back to "checking".
    let latestUsageIntelligence;
    let latestAvailabilityIntelligence;
    let usageExtraLines = [];
    let availabilityExtraLines = [];

    async function rerender() {
      const extraLines = [...availabilityExtraLines, ...usageExtraLines];
      const refreshed = await refreshWorkspace(ctxBag, {
        loadSnapshot,
        sessionId: boundKairoSessionId,
        usageIntelligence: latestUsageIntelligence,
        availabilityIntelligence: latestAvailabilityIntelligence,
        extraLines,
        onSnapshot: (snap, info) => notifyAvailability(ctxBag, snap, info),
        isCurrent
      });
      if (routeState === "unavailable" && isCurrent()) {
        setWorkspaceWidget(ctxBag, refreshed, "unavailable-routes", extraLines);
      }
    }

    const usagePromise = loadUsageData({ cwd }).then(async (result) => {
      latestUsageIntelligence = result;
      await rerender();
    });
    // loadKairoLiveData fails closed on its own (null on any throw or
    // missing data — see its own doc), never fabricating "available" rows.
    const availabilityPromise = loadLiveData({ cwd }).then(async (result) => {
      latestAvailabilityIntelligence = result;
      availabilityExtraLines = result === null
        ? ["Live availability check failed — team status shown as unknown."]
        : [];
      await rerender();
      // Automatic team recovery needs fresh live availability, so it only
      // starts here. It can run a full project analysis (minutes), so it is
      // not awaited by session_start; `recovery()` exposes it.
      if (result !== null) pendingRecovery = runRecovery(ctxBag, cwd, rerender).catch(() => null);
    });

    await Promise.all([usagePromise, availabilityPromise]);
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
      handler: async (_args, ctx) => refreshWorkspace(ctx, { loadSnapshot, sessionId: boundKairoSessionId, view })
    });
  }

  return {
    registerRoutes,
    /** The most recent automatic team recovery (null when none ran). */
    recovery: () => pendingRecovery
  };
}

export default async function kairoExtension(pi) {
  const extension = createKairoWorkspaceExtension(pi);
  await extension.registerRoutes(process.cwd());
  return extension;
}
