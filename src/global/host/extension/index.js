import { readFileSync, statSync } from "node:fs";
import { createKernelService } from "../../kernel/service.js";
import { resolveKairoPiSettingsPath } from "../launch-gentle-shell.js";
import { createKairoRouteProvider, loadKairoProviderModels } from "../kairo-route-provider.js";
import {
  approveKairoRecovery, loadKairoWorkspaceSnapshot, loadKairoLiveData, loadKairoUsageData, readPendingKairoRecovery, recoverKairoProjectTeam, rejectKairoRecovery
} from "../workspace-snapshot.js";
import {
  availabilityNotices, createCompactShellSummaryWidget, createKairoTextWidget, createKairoWorkspaceWidget,
  createShellBottomStripWidget, createShellSidebarWidget, formatSessionIdentity
} from "../workspace-widget.js";
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
 * full warning text when it has one, plus the next step when a row is
 * blocked with no captured cause (the sidebar/compact summary can only
 * say access is unavailable there — this detail view owes the action).
 * Rendered through the component path (createKairoTextWidget), never a
 * plain string array, because 7 real roles with warnings can exceed Pi's
 * MAX_WIDGET_LINES=10 cap. */
function teamDetailLines(team) {
  const rows = Array.isArray(team?.rows) ? team.rows : [];
  return [
    `KAIRO TEAM · ${team?.state ?? "not_analyzed"}`,
    ...(rows.length
      ? rows.flatMap((row) => {
          if (row.availability?.warning) return [teamRowLine(row), `  ${row.availability.warning}`];
          if (row.availability?.state === "blocked") {
            return [teamRowLine(row), "  Next step: run /project analyze to assign an eligible model."];
          }
          return [teamRowLine(row)];
        })
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

/**
 * The fork's ACTUAL current TUI mode, read fresh from its own settings.json
 * (see launch-gentle-shell.js's resolveKairoPiSettingsPath and
 * prepareKairoPiHome, which write to this exact file before every launch)
 * — never cached, so a live mode switch from inside a running Pi session
 * (its settings selector calls `SettingsManager.setTuiMode`, which
 * persists to this same file immediately, per interactive-mode.ts's
 * `onTuiModeChange`) is visible on the very next call. This mirrors the
 * fork's OWN default rule exactly (`SettingsManager.getTuiMode`: anything
 * other than exactly `"fullscreen"` is regular) — an earlier version
 * defaulted the OPPOSITE way (missing/unreadable meant fullscreen), which
 * only worked by coincidence because Kairo's own launcher always writes an
 * explicit value first (native review R2 WARNING, 2026-09-25).
 */
function readLiveKairoTuiMode(env, readFileImpl = readFileSync) {
  try {
    const parsed = JSON.parse(readFileImpl(resolveKairoPiSettingsPath(env), "utf8"));
    return parsed && typeof parsed === "object" && parsed.tuiMode === "fullscreen" ? "fullscreen" : "regular";
  } catch {
    // Missing, unreadable, or malformed settings file: mirror the fork's
    // own default (SettingsManager.getTuiMode falls back to "regular"),
    // never Kairo's own launch-time opinion (see prepareKairoPiHome).
    return "regular";
  }
}

/**
 * Builds a `getTuiMode()` reader that only re-reads and re-parses
 * settings.json when its mtime has actually changed. `readLiveKairoTuiMode`
 * alone does a `readFileSync` plus `JSON.parse` on every call — cheap once,
 * but `getTuiMode` runs on every `setWorkspaceWidget` call, and Pi repaints
 * the fullscreen widget/sidebar/strip on every streamed token while a
 * response is in flight, so re-reading and re-parsing the same unchanged
 * file dozens of times per second is pure waste (native review R3 finding,
 * 2026-09-25). `statSync` alone is far cheaper than reading the file body,
 * so it runs on every call; the body is only re-read when `mtimeMs`
 * differs from the last observed value. A missing/unreadable settings file
 * is never cached (so it keeps trying once the file appears), mirroring
 * `readLiveKairoTuiMode`'s own fallback.
 */
export function createLiveTuiModeReader(env, { statImpl = statSync, readFileImpl = readFileSync } = {}) {
  let cachedMtimeMs = null;
  let cachedMode = "regular";
  return function getTuiMode() {
    let mtimeMs;
    try {
      mtimeMs = statImpl(resolveKairoPiSettingsPath(env)).mtimeMs;
    } catch {
      cachedMtimeMs = null;
      return "regular";
    }
    if (mtimeMs === cachedMtimeMs) return cachedMode;
    cachedMtimeMs = mtimeMs;
    cachedMode = readLiveKairoTuiMode(env, readFileImpl);
    return cachedMode;
  };
}

/**
 * True only when the shell surface should own the render: the fork exposes
 * BOTH `setSidebar`/`setBottomStrip` (feature-detected; the published `.3`
 * pin Kairo still ships does not) AND the current TUI mode is fullscreen.
 *
 * `getTuiMode` is called FRESH here on every render — never cached — so a
 * live mode switch (the fork's settings selector, which persists through
 * `SettingsManager.setTuiMode` to the same settings.json this reads — see
 * readLiveKairoTuiMode below) is picked up on the very next render. An
 * earlier version read `KAIRO_TUI_MODE`, captured once from `env` at
 * extension-creation time; that value never changed once the process
 * started, so switching to regular mid-session left the extension still
 * painting into slots the fork had stopped drawing (native review R4/R3
 * finding, 2026-09-25).
 *
 * Regular mode and the `.3` pin both fall back to the single classic
 * widget slot exactly as before H7/H8 — this function is the ONE place
 * that decides which surface owns a render, so every caller (the ordinary
 * "overview" render and the "no automatic route" override alike) makes
 * the same choice and never lets both surfaces show the same fact at once.
 */
function isShellActive(ctx, getTuiMode) {
  const hasShellApis = typeof ctx?.ui?.setSidebar === "function" && typeof ctx?.ui?.setBottomStrip === "function";
  return hasShellApis && getTuiMode?.() === "fullscreen";
}

/**
 * The H7/H8 fullscreen shell surface: installs the sidebar, bottom strip,
 * and compact-summary widget ONCE, whenever the shell is active — never
 * branching on column count here at dispatch time. Each of the three
 * factories (see workspace-widget.js's createShellSidebarWidget /
 * createShellBottomStripWidget / createCompactShellSummaryWidget) decides
 * its OWN content live inside its own `render()`, reading `getColumns()`
 * fresh on every repaint: sidebar+strip render real content at
 * SHELL_SIDEBAR_MIN_COLUMNS or more and stay empty below it; the compact
 * summary does the opposite. This means crossing the 90-column threshold
 * reflows on the very next repaint with NO extension-triggered refresh —
 * an earlier version captured `getColumns()` once here and baked the
 * sidebar-shown/compact-shown choice into which factory got installed, so
 * a live resize with no following session_start/command refresh left the
 * wrong surface painted (native review R4/R3 finding, 2026-09-25).
 * `extraLines` (e.g. a team-recovery notice) and `routeUnavailable` (no
 * automatic Pi route — folds the old "unavailable-routes" widget's two
 * facts in here instead of a separate, duplicate widget) are forwarded to
 * every factory so whichever surface ends up visible carries them.
 * Only called once `isShellActive` is true; the caller (setWorkspaceWidget)
 * handles the regular-mode/`.3`-pin fallback and slot clearing itself.
 */
function renderShellSurface(ctx, snapshot, { getColumns, routeUnavailable = false, extraLines = [], getTuiMode = null, selection = null }) {
  ctx.ui.setSidebar(createShellSidebarWidget(snapshot, {
    getColumns,
    routeUnavailable,
    extraLines,
    selectedAgentId: selection?.selectedAgentId ?? null,
    onSelectAgent: selection?.onSelectAgent ?? null
  }));
  ctx.ui.setBottomStrip(createShellBottomStripWidget(snapshot, { getColumns, extraLines }));
  ctx.ui.setWidget?.("kairo-workspace", createCompactShellSummaryWidget(snapshot, { getColumns, routeUnavailable, extraLines }));
  // Remember this paint so a sidebar click can re-open the surface with a
  // new selection without a full snapshot reload — the click only changes
  // which detail block is open, never the facts. Guarded by isShellActive
  // at click time (see the closure's onSelectAgent): a mode switch away
  // from fullscreen must never repaint slots the fork stopped drawing.
  if (selection) selection._paint = { ctx, snapshot, getColumns, routeUnavailable, extraLines, getTuiMode };
}

/**
 * Renders `snapshot` onto the Kairo surface, in the shape `view` needs.
 * For "overview" and "unavailable-routes", the ACTIVE surface — the H7/H8
 * fullscreen shell (sidebar/strip/compact-summary, see renderShellSurface)
 * or the classic single widget slot — decides based on `isShellActive`;
 * every other view always uses the classic widget slot (team/sessions/
 * usage/route/memory detail views are unaffected by the shell surface).
 * The classic widget path renders the themed two-panel component for
 * "overview", the component path (no line cap) for a detail view that can
 * exceed 10 lines, or a plain string array for a detail view that stays
 * comfortably under it. Every non-overview classic-widget view gets the
 * same shared session-identity line (see formatSessionIdentity) appended
 * once here — the overview shows it through the status bar in fullscreen
 * (see workspaceStatus) or its own USAGE panel footer in regular mode, so
 * every surface that can occupy the one Kairo widget slot names the bound
 * session the same honest way.
 */
function setWorkspaceWidget(ctx, snapshot, view, extraLines, { getColumns, getTuiMode, selection = null } = {}) {
  const shellActive = isShellActive(ctx, getTuiMode);

  if (view === "overview") {
    if (shellActive) {
      renderShellSurface(ctx, snapshot, { getColumns, routeUnavailable: false, extraLines, getTuiMode, selection });
      return;
    }
    // Regular mode, or the shell APIs are missing entirely (the published
    // `.3` pin): clear the shell slots when they exist at all (a no-op on
    // the fork side in regular mode, but explicit here so a mode switch
    // mid-session never leaves stale sidebar/strip content behind once
    // fullscreen returns) and fall back to the single classic widget slot
    // exactly as it worked before H7/H8.
    ctx?.ui?.setSidebar?.(undefined);
    ctx?.ui?.setBottomStrip?.(undefined);
    ctx?.ui?.setWidget?.("kairo-workspace", createKairoWorkspaceWidget(snapshot, extraLines));
    return;
  }

  if (view === "unavailable-routes" && shellActive) {
    // Fold the same two facts the classic detail widget would show (no
    // automatic route, run /project analyze) into whichever shell surface
    // is active, instead of a separate widget landing next to — or, below
    // SHELL_SIDEBAR_MIN_COLUMNS, replacing — the sidebar/strip/compact
    // summary. See renderShellSurface's own doc.
    renderShellSurface(ctx, snapshot, { getColumns, routeUnavailable: true, extraLines, getTuiMode, selection });
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
  // A proposal is NOT an activation: the previous team keeps serving until
  // a human approves its replacement (see team-recovery.js). The notice
  // names the cause and the verified alternative, and the approval surface
  // (S3-1b) is the only executable exit — never a background swap.
  if (result?.outcome === "proposed") {
    const cause = (result.affected ?? [])
      .map((entry) => `${entry.role} (${entry.model}: ${entry.reason})`)
      .join(", ") || "a provider availability change";
    const alternative = (result.proposal?.projectTeam ?? [])
      .map((entry) => `${entry.role} → ${entry.model?.displayName ?? entry.model?.modelId ?? "no eligible option"}`)
      .join(", ") || "no verified alternative yet";
    return { level: "warning", message: `Kairo proposes a recovered team after ${cause}. Verified alternative: ${alternative}. Nothing was activated — approve with /kairo-team-approve or reject with /kairo-team-reject.` };
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
  loadSnapshot, sessionId = null, view = "overview", usageIntelligence, availabilityIntelligence, extraLines = [],
  onSnapshot = () => {}, isCurrent = () => true, getColumns, getTuiMode, selection = null
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
  setWorkspaceWidget(ctxForWidget, snapshot, view, extraLines, { getColumns, getTuiMode, selection });
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
  approveTeam = approveKairoRecovery,
  rejectTeam = rejectKairoRecovery,
  readPendingRecovery = readPendingKairoRecovery,
  resolveHomeDirImpl = resolveHomeDir,
  resolveProjectRootImpl = resolveProjectRoot,
  createSessionImpl = createSession,
  getSessionImpl = getSession,
  lookupPiBindingImpl = lookupPiBinding,
  recordPiBindingImpl = recordPiBinding,
  // H7/H8: the fork exposes no getter for its own TUI mode or terminal
  // width, so these default to the one honest, LIVE real source each has:
  // the fork's own settings.json (see readLiveKairoTuiMode/
  // createLiveTuiModeReader — mtime-cached, so a live in-session mode
  // switch is never stale, but an unchanged file is not re-parsed on
  // every render) and the process's own stdout columns. Tests inject
  // fixed values instead of a real TTY/settings file.
  getColumns = () => process.stdout.columns,
  getTuiMode = createLiveTuiModeReader(env)
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
  // The open sidebar agent detail (S2-1b): clicking an agent row toggles
  // its detail block, clicking it again closes it. Held here — one per
  // extension instance — and threaded into every shell paint as
  // `selection`, so a snapshot refresh keeps the open detail instead of
  // collapsing it. Keyboard reaches the same detail through `/kairo-team`
  // (see teamDetailLines), which needs no selection state at all.
  const shellSelection = { selectedAgentId: null, _paint: null };
  shellSelection.onSelectAgent = (agentId) => {
    shellSelection.selectedAgentId = shellSelection.selectedAgentId === agentId ? null : agentId;
    const paint = shellSelection._paint;
    if (!paint || !isShellActive(paint.ctx, paint.getTuiMode)) return;
    renderShellSurface(paint.ctx, paint.snapshot, {
      getColumns: paint.getColumns,
      routeUnavailable: paint.routeUnavailable,
      extraLines: paint.extraLines,
      getTuiMode: paint.getTuiMode,
      selection: shellSelection
    });
  };
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
      isCurrent,
      getColumns,
      getTuiMode,
      selection: shellSelection
    });
    if (routeState === "unavailable" && isCurrent()) {
      setWorkspaceWidget(ctxBag, snapshot, "unavailable-routes", [], { getColumns, getTuiMode, selection: shellSelection });
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
        isCurrent,
        getColumns,
        getTuiMode,
        selection: shellSelection
      });
      if (routeState === "unavailable" && isCurrent()) {
        setWorkspaceWidget(ctxBag, refreshed, "unavailable-routes", extraLines, { getColumns, getTuiMode, selection: shellSelection });
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

    // A proposal made before a restart still waits on the record (cause +
    // suggested team persisted there, never in memory) — surface it while
    // the probes run, never before them: this read must not delay probe
    // startup (timing-sensitive renders depend on it). Same dedupe key as
    // runRecovery's own notice, so it says it once.
    const pendingNotice = readPendingRecovery({ cwd }).catch(() => null).then((pending) => {
      if (!isCurrent()) return;
      if (pending?.outcome === "proposed" && pending?.proposal) {
        const notice = recoveryNotice({ outcome: "proposed", affected: pending.affected ?? [], proposal: pending.proposal });
        const key = `${pending.fingerprint}|proposed|`;
        if (notice && !shownRecoveryKeys.has(key)) {
          shownRecoveryKeys.add(key);
          ctx?.ui?.notify?.(notice.message, notice.level);
        }
      }
    });

    await Promise.all([usagePromise, availabilityPromise, pendingNotice]);
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
      handler: async (_args, ctx) => refreshWorkspace(ctx, { loadSnapshot, sessionId: boundKairoSessionId, view, getColumns, getTuiMode, selection: shellSelection })
    });
  }

  // Recovery proposal decisions are real Pi commands (not legacy-cockpit
  // only): approving re-verifies, activates, re-syncs Pi routes and
  // repaints; rejecting only closes. Both report loudly on error — a
  // failed approval never looks like an approval.
  pi.registerCommand("kairo-team-approve", {
    description: "Approve the pending recovery proposal",
    handler: async (_args, ctx) => {
      const cwd = ctx?.cwd ?? process.cwd();
      const result = await approveTeam({ cwd });
      if (result?.outcome === "approved") {
        await registerRoutes(cwd);
        await refreshWorkspace(ctx, { loadSnapshot, sessionId: boundKairoSessionId, view: "overview", getColumns, getTuiMode, selection: shellSelection });
        ctx?.ui?.notify?.("Recovery proposal approved — the new team is active and Pi routes follow it.", "info");
      } else {
        ctx?.ui?.notify?.(`Could not approve the recovery proposal (${result?.reason ?? "unknown reason"}). The current team stays active.`, "warning");
      }
      return result;
    }
  });
  pi.registerCommand("kairo-team-reject", {
    description: "Reject the pending recovery proposal",
    handler: async (_args, ctx) => {
      const cwd = ctx?.cwd ?? process.cwd();
      const result = await rejectTeam({ cwd });
      if (result?.outcome === "rejected") {
        ctx?.ui?.notify?.("Recovery proposal rejected — the current team stays active.", "info");
      } else {
        ctx?.ui?.notify?.(`Could not reject the recovery proposal (${result?.reason ?? "unknown reason"}).`, "warning");
      }
      return result;
    }
  });

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
