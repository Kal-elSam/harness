import { matchesKey, Key, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { buildTaskRows, clampSelection, isActionAvailable } from "./rows.js";
import { CARD_TONE, cardBottom, cardInnerWidth, cardLine, cardTop, renderPanel as renderPanelWithTheme } from "./card.js";
import { theme } from "./theme.js";
import { LOW_QUOTA_WARN_PERCENT } from "../intelligence/execution-router.js";
import { ENTITLEMENT } from "../observability/claude-model-entitlement.js";

/** Plain-language description of what each role optimizes for — mirrors
 * buildAiTeamRoleDefinitions()'s real compute functions in
 * model-intelligence.js, never a per-model claim, so it never needs
 * updating when the underlying models change. */
export const ROLE_CAPABILITY_BLURB = {
  Explorer: "general reasoning capability",
  Architect: "general reasoning capability",
  Builder: "coding capability",
  Debugger: "reasoning and terminal-debugging capability",
  Tester: "coding and terminal-execution capability",
  Reviewer: "independent reasoning and coding review"
};

const OVERRIDE_DECISION_TEXT = "Manual override — not the automatic ranking's own pick.";

/**
 * Pure, human-readable why for one team assignment — from real
 * `reason` / `decisionEvidence` only, never invented metrics.
 * Existing `entry.reason` always wins; overrides use a single formulation.
 * @param {{role?: string, reason?: string|null, assignmentSource?: string|null, decisionEvidence?: object|null}} entry
 * @returns {string}
 */
export function explainTeamDecision(entry) {
  if (!entry) return `Selected for ${ROLE_CAPABILITY_BLURB.Explorer ?? "this role's capability requirement"}.`;
  if (entry.assignmentSource === "override") return OVERRIDE_DECISION_TEXT;
  if (entry.reason) return entry.reason;

  const blurb = ROLE_CAPABILITY_BLURB[entry.role] ?? "this role's capability requirement";
  const decisionType = entry.decisionEvidence?.decisionType ?? null;
  if (decisionType === "leader") {
    const floor = entry.decisionEvidence?.requiredFloor;
    const risk = entry.decisionEvidence?.riskLevel;
    if (floor != null && risk != null) {
      const floorPct = Math.round(floor * 100);
      return `Ranked first for ${blurb} among eligible candidates — nothing cheaper or faster displaced it at the ${floorPct}% capability floor (${risk}-risk role).`;
    }
    return `Ranked first for ${blurb} among eligible candidates.`;
  }
  return `Selected for ${blurb}.`;
}

/**
 * Live availability for a projectTeam model ref (which has no
 * `available` flag). Entitlement beats adapter quota/eligibility.
 * @param {object|null|undefined} model
 * @param {{eligibility?: Record<string, {ok: boolean, reason?: string}>, claudeEntitlement?: Record<string, {status: string, reason?: string|null}>}} [opts]
 * @returns {{available: boolean, warning: string|null}}
 */
export function resolveAssignmentAvailability(model, { eligibility = {}, claudeEntitlement = {} } = {}) {
  if (!model) return { available: false, warning: null };

  if (model.adapterId === "claude") {
    const entitlement = claudeEntitlement[model.modelId];
    if (entitlement?.status === ENTITLEMENT.DENIED) {
      const reason = entitlement.reason ?? "denied";
      return {
        available: false,
        warning: `Unavailable — your Claude plan denies this model (${reason})`
      };
    }
    if (entitlement?.status === ENTITLEMENT.UNVERIFIED) {
      return {
        available: false,
        warning: "Unavailable — model entitlement not verified (run /models --verify-access)"
      };
    }
  }

  const check = eligibility[model.adapterId];
  if (check && check.ok === false) {
    return {
      available: false,
      warning: `Unavailable — ${check.reason ?? "not eligible"}`
    };
  }
  return { available: true, warning: null };
}

/**
 * A real, early heads-up — never fabricated, never re-deriving its own
 * threshold (see execution-router.js's LOW_QUOTA_WARN_PERCENT, the same
 * canonical policy checkCandidate itself uses for its harder exclusion
 * cutoff). `alreadyFlagged` skips this for a window a caller already
 * tagged some other way (e.g. Go's own "RATE LIMITED"), so a single
 * window is never double-tagged.
 * @param {number|null|undefined} remainingPercent
 * @param {boolean} [alreadyFlagged]
 */
function quotaWarnSuffix(remainingPercent, alreadyFlagged = false) {
  if (alreadyFlagged || remainingPercent == null) return "";
  return remainingPercent < LOW_QUOTA_WARN_PERCENT ? " LOW" : "";
}

/** view.js's own local binding for card.js's real renderPanel, fixed to this module's theme. */
function renderPanel(title, tone, width, contentLines, targetLineCount = contentLines.length) {
  return renderPanelWithTheme(title, tone, theme, width, contentLines, targetLineCount);
}

function compactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "unknown";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

/**
 * CockpitView is a plain-object pi-tui Component: it exposes render(width) and
 * handleInput(data), and owns the small amount of UI state the `kairo start`
 * cockpit needs (selected row, list/detail/confirm mode, status line).
 *
 * It never talks to the conversation service directly — all side effects are
 * delegated to the injected `actions` so this class stays cheap to unit test.
 */
export class CockpitView {
  /** Real Braille spinner frames — the same family real terminal CLIs (Claude Code, Codex) use for a live "in progress" indicator. */
  static SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  /**
   * @param {object} deps
   * @param {object} deps.actions
   * @param {(taskId: string) => void} deps.actions.onShowPlan
   * @param {(taskId: string) => void} deps.actions.onApprove
   * @param {(taskId: string) => void} deps.actions.onReject
   * @param {(taskId: string, role: string) => void} deps.actions.onRequestExecute - asks for the
   *   real routing decision (via service.planExecution) before showing the confirm prompt. `role` is
   *   always the user's own explicit choice from the role picker below — PROJECT TEAM is the sole
   *   authority for execution, so this is only ever called once a real role has been picked; a
   *   project with no active team has no roles to pick and 'x' never calls this at all (see
   *   handleListInput's own doc).
   * @param {(taskId: string, decision: object) => void} deps.actions.onExecute - confirmed; decision
   *   is the same one shown in the prompt, so the cockpit and the actual launch never disagree
   * @param {(taskId: string) => void} deps.actions.onCancel
   * @param {() => void} deps.actions.onRefresh
   * @param {() => void} deps.actions.onQuit
   * @param {() => void} [deps.requestRender]
   * @param {() => number|undefined} [deps.getViewportRows] - rows available to this
   *   component (terminal height minus whatever else the layout reserves, e.g. the
   *   editor). Used only to pad the session card so it reaches the bottom of the
   *   screen instead of leaving dead space below a short frame; omit in tests.
   */
  constructor({ actions, requestRender = () => {}, getViewportRows = () => undefined }) {
    this.actions = actions;
    this.requestRender = requestRender;
    this.getViewportRows = getViewportRows;
    this.rows = [];
    this.selectedIndex = 0;
    this.mode = "list"; // "list" | "detail" | "select-role" | "confirm-execute" — UI screen, never confused with workMode below
    // The cockpit's real WorkMode ("ask" | "plan" | "agent" — see
    // rows.js's isActionAvailable) — deliberately a SEPARATE field from
    // `this.mode` above, which is the UI screen state (list/detail/
    // confirm-execute), a completely different axis. Defaults to "ask",
    // the strictly read-only default every session (new or pre-WorkMode)
    // starts from until app.js loads the real persisted KairoSession.
    this.workMode = "ask";
    this.detailTaskId = null;
    this.detailText = "";
    this.statusMessage = "";
    // Live "in progress" indicator state — see beginAction/endAction/
    // tickSpinner/actionStatusLine's own docs. null actionLabel means no
    // action is currently running.
    this.actionLabel = null;
    this.actionStartedAt = null;
    this.spinnerFrame = 0;
    this.snapshot = null;
    this.transcript = [];
    this.executeDecision = null;
    // Pending role picker state (mode "select-role") — the real project
    // team's roles for THIS task's project, held only in memory between
    // pressing 'x' and the user's explicit role choice. Never persisted
    // and never defaulted to a role the user didn't pick: role selection
    // is skipped entirely (falls straight to the legacy no-role
    // onRequestExecute) whenever the project has no active team yet.
    this.roleSelectTaskId = null;
    this.roleOptions = [];
    this.roleSelectedIndex = 0;
    // AWAITING_ANALYST: real preflightProject() output (profile,
    // alternatives, candidates) held here between /project analyze and a
    // confirmed /project analyst choice — deliberately in-memory only,
    // never persisted: a restart mid-flow should just start over from
    // NOT_ANALYZED, not resurrect a stale, unconfirmed selection.
    this.pendingProjectAnalysis = null;
    // Real, monotonic per-entry ids (never re-derived from array index,
    // which shifts under the 500-entry cap) so each transcript entry's
    // expensive ANSI-aware wrap (wrapTextWithAnsi) can be cached by
    // `${id}:${width}` in renderConversation() instead of re-wrapping the
    // ENTIRE transcript on every keystroke's render — with a real
    // conversation, that's the actual cost behind "escritura lenta". A
    // cached entry never needs invalidating: transcript entries are
    // immutable once pushed, so the only real cache key that matters is
    // width (a terminal resize), which the Map key already captures.
    this._nextEntryId = 0;
    this._wrapCache = new Map();
    // Set by app.js's focus toggling — the "a approve · j reject ·
    // x implement" hint is only true while the list actually has focus;
    // with the composer focused those same letters just become message
    // text instead of triggering an action.
    this.hasListFocus = false;
  }

  /** @param {"ask"|"plan"|"agent"} workMode */
  setWorkMode(workMode) {
    this.workMode = workMode;
    this.requestRender();
  }

  /** Cycles ASK -> PLAN -> AGENT -> ASK (Shift+Tab); Tab stays reserved for focus/autocomplete. */
  static nextWorkMode(workMode) {
    const order = ["ask", "plan", "agent"];
    return order[(order.indexOf(workMode) + 1) % order.length];
  }

  /**
   * Shows the confirm-execute prompt with the real routing decision
   * (provider/model/why) already resolved — never a placeholder while
   * waiting, since the decision is fetched by the caller (app.js, via
   * service.planExecution) before this is called.
   * @param {string} taskId
   * @param {object} decision - a service.planExecution() result
   */
  showExecuteConfirm(taskId, decision) {
    this.mode = "confirm-execute";
    this.executeDecision = decision;
    this.requestRender();
  }

  /**
   * The real, project-specific roles execution can be requested for right
   * now — read straight off the active ProjectStrategy's own projectTeam
   * (never a fixed global role list: a project only ever offers the roles
   * its own analysis actually required). Empty whenever there's no active
   * strategy yet, which is exactly when 'x' should skip role selection
   * entirely and fall back to the legacy no-role routing.
   * @returns {string[]}
   */
  projectTeamRoles() {
    const strategy = this.snapshot?.projectStrategy;
    if (!strategy || strategy.status !== "active" || !Array.isArray(strategy.projectTeam)) return [];
    return strategy.projectTeam.map((entry) => entry.role);
  }

  /**
   * Opens the role picker for a pending execute request — the user's own
   * explicit choice of which real project-team role this task falls
   * under, never inferred from the task's text.
   * @param {string} taskId
   * @param {string[]} roles
   */
  showRoleSelect(taskId, roles) {
    this.mode = "select-role";
    this.roleSelectTaskId = taskId;
    this.roleOptions = roles;
    this.roleSelectedIndex = 0;
    this.requestRender();
  }

  /** Store the latest control-plane snapshot for the dashboard header. */
  setSnapshot(snapshot) {
    this.snapshot = snapshot ?? null;
    this.requestRender();
  }

  /** Add a short, user-visible event without retaining provider transcripts. */
  addTranscript(role, text) {
    const value = String(text ?? "").trim();
    if (!value) return;
    this.transcript.push({ id: this._nextEntryId++, role: role === "user" ? "You" : "Kairo", text: value });
    // A generous safety cap, not a display constraint — what actually shows
    // on screen is decided per-render by the real viewport budget
    // (see chatLines()), not by how much history this array retains.
    if (this.transcript.length > 500) {
      const evicted = this.transcript.shift();
      for (const key of this._wrapCache.keys()) {
        if (key.startsWith(`${evicted.id}:`)) this._wrapCache.delete(key);
      }
    }
    this.requestRender();
  }

  /**
   * Seeds the transcript from persisted history (service.loadTranscript())
   * at cockpit startup — one render for the whole batch, and never
   * re-persists what was just loaded back from disk.
   * @param {Array<{role: "user"|"kairo", text: string}>} entries
   */
  loadTranscript(entries) {
    this.transcript = (entries ?? [])
      .map((entry) => ({ id: this._nextEntryId++, role: entry.role === "user" ? "You" : "Kairo", text: String(entry.text ?? "").trim() }))
      .filter((entry) => entry.text)
      .slice(-500);
    this._wrapCache.clear();
    this.requestRender();
  }

  clearTranscript() {
    this.transcript = [];
    this._wrapCache.clear();
    this.requestRender();
  }

  /** @param {Array<object>} timeline snapshot().timeline entries */
  setRowsFromTimeline(timeline) {
    this.setRows(buildTaskRows(timeline));
  }

  /** @param {import("./rows.js").CockpitRow[]} rows */
  setRows(rows) {
    this.rows = rows;
    this.selectedIndex = clampSelection(this.selectedIndex, rows.length);
    this.requestRender();
  }

  /** @param {string} message */
  setStatus(message) {
    this.statusMessage = message ?? "";
    this.requestRender();
  }

  /**
   * Starts a real, live "in progress" indicator for a real async action —
   * a ticking spinner frame plus real elapsed seconds, refreshed by
   * app.js's own fast timer calling tickSpinner() repeatedly, instead of
   * a static "Label…" string that just sits there unchanged until the
   * action resolves. Overrides statusMessage while active — see
   * actionStatusLine()'s own doc for the render-time precedence.
   * @param {string} label
   */
  beginAction(label) {
    this.actionLabel = label;
    this.actionStartedAt = Date.now();
    this.spinnerFrame = 0;
    this.requestRender();
  }

  /** Ends the current live action indicator. Callers still set their own success/failure statusMessage via setStatus() afterward — this only stops the spinner. */
  endAction() {
    this.actionLabel = null;
    this.actionStartedAt = null;
    this.requestRender();
  }

  /** Advances the spinner one frame — a no-op when no action is in flight, so app.js's fast timer can tick unconditionally without checking state itself. */
  tickSpinner() {
    if (!this.actionLabel) return;
    this.spinnerFrame = (this.spinnerFrame + 1) % CockpitView.SPINNER_FRAMES.length;
    this.requestRender();
  }

  /**
   * The real, live status line for an in-flight action — spinner frame +
   * label + real elapsed seconds since it started — or null when nothing
   * is running. Render call sites prefer this over the static
   * statusMessage whenever it's non-null, since a live action in progress
   * is always more current/relevant than a leftover static message.
   * @returns {string|null}
   */
  actionStatusLine() {
    if (!this.actionLabel) return null;
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - this.actionStartedAt) / 1000));
    return `${CockpitView.SPINNER_FRAMES[this.spinnerFrame]} ${this.actionLabel}… (${elapsedSeconds}s)`;
  }

  /**
   * @param {string} taskId
   * @param {string} markdown
   */
  showDetail(taskId, markdown) {
    this.detailTaskId = taskId;
    this.detailText = markdown ?? "(no plan markdown yet)";
    this.mode = "detail";
    this.statusMessage = "";
    this.requestRender();
  }

  backToList() {
    this.mode = "list";
    this.detailTaskId = null;
    this.detailText = "";
    this.requestRender();
  }

  selectedRow() {
    return this.rows[this.selectedIndex] ?? null;
  }

  moveSelection(delta) {
    if (this.rows.length === 0) return;
    this.selectedIndex = clampSelection(this.selectedIndex + delta, this.rows.length);
    this.requestRender();
  }

  /** @param {string} data raw terminal input */
  handleInput(data) {
    if (matchesKey(data, "ctrl+c")) {
      this.actions.onQuit();
      return;
    }

    if (this.mode === "confirm-execute") {
      this.handleConfirmInput(data);
      return;
    }

    if (this.mode === "select-role") {
      this.handleRoleSelectInput(data);
      return;
    }

    if (this.mode === "detail") {
      this.handleDetailInput(data);
      return;
    }

    this.handleListInput(data);
  }

  handleConfirmInput(data) {
    const row = this.selectedRow();
    if (data === "y" || data === "Y") {
      const decision = this.executeDecision;
      // A real ProjectExecutionPreview (planExecution({role}) — PROJECT
      // TEAM is the sole authority for execution, there is no other
      // shape) always carries a `confirmationTarget` key, present only
      // when something is genuinely confirmable: the assigned candidate
      // on ROUTED, or a persisted, currently-eligible fallback on
      // WAIT_FOR_PROJECT_TEAM. MANUAL_HANDOFF and a blocked role with no
      // eligible alternative both carry `confirmationTarget: null` and
      // must never launch here.
      const canConfirm = !decision || Boolean(decision.confirmationTarget);
      if (!canConfirm) return;
      this.mode = "list";
      this.executeDecision = null;
      this.requestRender();
      if (row) this.actions.onExecute(row.taskId, decision);
      return;
    }
    if (data === "n" || data === "N" || matchesKey(data, Key.escape)) {
      this.mode = "list";
      this.executeDecision = null;
      this.statusMessage = "Execution cancelled.";
      this.requestRender();
    }
  }

  /**
   * Up/down to move the role picker's selection, Enter to confirm it (and
   * only then ask app.js for the real preview for that exact role),
   * Esc/q to cancel back to the list without ever requesting a preview.
   */
  handleRoleSelectInput(data) {
    if (matchesKey(data, Key.up)) {
      this.roleSelectedIndex = Math.max(0, this.roleSelectedIndex - 1);
      this.requestRender();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.roleSelectedIndex = Math.min(this.roleOptions.length - 1, this.roleSelectedIndex + 1);
      this.requestRender();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      const role = this.roleOptions[this.roleSelectedIndex];
      const taskId = this.roleSelectTaskId;
      this.mode = "list";
      this.roleSelectTaskId = null;
      this.requestRender();
      if (taskId && role) this.actions.onRequestExecute(taskId, role);
      return;
    }
    if (data === "n" || data === "N" || matchesKey(data, Key.escape) || data === "q") {
      this.mode = "list";
      this.roleSelectTaskId = null;
      this.statusMessage = "Execution cancelled.";
      this.requestRender();
    }
  }

  handleDetailInput(data) {
    if (matchesKey(data, Key.escape) || data === "q") {
      this.backToList();
      return;
    }
  }

  handleListInput(data) {
    const row = this.selectedRow();

    if (matchesKey(data, Key.up)) { this.moveSelection(-1); return; }
    if (matchesKey(data, Key.down)) { this.moveSelection(1); return; }
    if (matchesKey(data, Key.enter)) {
      if (row) this.actions.onShowPlan(row.taskId);
      return;
    }
    if (data === "q") { this.actions.onQuit(); return; }
    if (data === "r") { this.actions.onRefresh(); return; }

    if (data === "a" && isActionAvailable("approve", row, this.workMode)) { this.actions.onApprove(row.taskId); return; }
    if (data === "j" && isActionAvailable("reject", row, this.workMode)) { this.actions.onReject(row.taskId); return; }
    if (data === "c" && isActionAvailable("cancel", row, this.workMode)) { this.actions.onCancel(row.taskId); return; }
    if (data === "x" && isActionAvailable("execute", row, this.workMode)) {
      const roles = this.projectTeamRoles();
      if (roles.length > 0) {
        this.showRoleSelect(row.taskId, roles);
      } else {
        // PROJECT TEAM is the sole authority for execution — with no real
        // active team, there is no role to pick and nothing left to
        // preview automatically. Never falls back to guessing from the
        // task's text; the only way forward is a real /project analysis.
        this.statusMessage = "No active project team — run /project to analyze and approve one before executing.";
        this.requestRender();
      }
      return;
    }
  }

  /**
   * Renders the real routing decision fetched for the pending
   * confirm-execute prompt — provider, model (or "default", never
   * invented), and the exact "why" the router computed. A non-ROUTED
   * decision (WAIT_FOR_APPROVAL / NO_PROVIDER_AVAILABLE) shows its real
   * reason and blocks confirmation instead of a generic prompt.
   * @param {import("./rows.js").CockpitRow|null} row
   * @returns {string[]}
   */
  confirmPromptLines(row) {
    const decision = this.executeDecision;
    if (!decision) return [theme.fg("warning", `Execute plan "${row?.taskId ?? ""}"? (y/n)`)];

    if (decision.decision === "ROUTED") {
      const model = decision.model ?? "default";
      return [
        theme.fg("warning", `Execute "${row?.taskId ?? ""}" with ${decision.provider} · ${model}? (y/n)`),
        theme.fg("muted", `Why: ${decision.why}`)
      ];
    }

    if (decision.decision === "MANUAL_HANDOFF") {
      const modelLabel = decision.modelRef?.displayName ?? decision.model ?? "the assigned model";
      return [
        theme.fg("error", `${decision.role} is manual-only`),
        theme.fg("muted", `Continue in ${decision.provider} with ${modelLabel} — Kairo can't launch this automatically.`),
        theme.fg("muted", "(n/esc to go back)")
      ];
    }

    if (decision.confirmationTarget) {
      // WAIT_FOR_PROJECT_TEAM with a real, currently-eligible suggested
      // alternative — offered for explicit confirmation, never a silent
      // substitution for the blocked assignment.
      const alt = decision.suggestedAlternative;
      const altLabel = alt?.model?.displayName ?? alt?.model?.modelId ?? "unknown model";
      return [
        theme.fg("warning", `Assigned model unavailable for ${decision.role}`),
        theme.fg("muted", `Suggested alternative: ${alt?.provider} · ${altLabel}`),
        theme.fg("warning", "Confirm this alternative? (y/n)")
      ];
    }

    return [
      theme.fg("error", `Cannot auto-execute "${row?.taskId ?? ""}"`),
      theme.fg("muted", decision.why ?? "no provider available"),
      theme.fg("muted", "(n/esc to go back)")
    ];
  }

  /**
   * Renders the pending role picker — one line per real project-team role,
   * the currently-selected one marked, plus a hint line. No routing
   * decision has been fetched yet at this point; that only happens once
   * Enter confirms a specific role.
   * @returns {string[]}
   */
  roleSelectPromptLines() {
    const lines = [theme.fg("warning", "Which role is this task for?")];
    this.roleOptions.forEach((role, index) => {
      const marker = index === this.roleSelectedIndex ? theme.fg("accent", "> ") : "  ";
      lines.push(`${marker}${role}`);
    });
    lines.push(theme.fg("muted", "Enter confirm · n/esc cancel"));
    return lines;
  }

  /**
   * @param {number} width
   * @returns {string[]}
   */
  render(width) {
    if (this.mode === "detail") return this.renderDetail(width);
    return this.renderWorkspace(width);
  }

  /**
   * The dashboard's card content — the compact USAGE bar and MODEL TEAMS —
   * without the footer or conversation. Shared by renderWorkspace() (the
   * monolithic fallback) and renderDashboard() (the fixed dashboard zone
   * in the real-scroll layout), so both stay in sync automatically instead
   * of drifting apart.
   *
   * USAGE is a plain one-line bar (two only when it genuinely doesn't fit
   * — see compactUsageLines()), never a bordered card of its own: it's a
   * glance-level status strip, not a widget with its own real content to
   * frame. MODEL TEAMS is the only bordered card here and always gets the
   * FULL real width — one unified widget (CAPABILITY/EFFICIENT columns,
   * one row per role — see teamsColumnsLines()), never two separate AI
   * TEAM/EFFICIENT TEAM cards, and never tiled beside USAGE (USAGE no
   * longer has real height to tile against). MODEL TEAMS is always
   * visible, independent of task selection — separate from STATUS
   * (task-specific), which is only reachable while a row is selected, and
   * once any task exists in history a row is *always* selected, so it
   * can't be tucked behind "nothing else to show" the way STATUS's own
   * content is.
   */
  renderDashboardLines(width) {
    const lines = [...this.compactUsageLines(width)];
    const { title, lines: panelLines } = this.projectTeamPanel(cardInnerWidth(width));
    lines.push(...renderPanel(title, CARD_TONE.SUCCESS, width, panelLines));
    return lines;
  }

  /**
   * Before a real ProjectStrategy exists (see project-strategy.js), the
   * panel stays honestly labeled GLOBAL MODEL GUIDE — the existing
   * cross-project CAPABILITY/EFFICIENT recommendations are still real and
   * useful, but they are NOT a project-specific team, and must never be
   * presented as one. Once a real strategy exists (suggested/active/
   * stale), the panel becomes PROJECT TEAM · <project> · <STATUS>, showing
   * only the real roles THIS project's profile actually required
   * (strategy.activeRoles/projectTeam — the real operational assignments,
   * see buildProjectStrategy), never the full global 7-role list.
   * @param {number} [width]
   */
  projectTeamPanel(width = 80) {
    const strategy = this.snapshot?.projectStrategy;
    const project = this.snapshot?.projectRoot?.split("/").filter(Boolean).pop() ?? "current project";
    if (!strategy && this.pendingProjectAnalysis) {
      // AWAITING_ANALYST: a real preflight already ran (LOCAL_PREFLIGHT),
      // and the human still needs to pick + confirm a real model before
      // ANALYZING can run — see app.js's /project analyst handler.
      const lines = this.pendingProjectAnalysis.alternatives.map((alt) =>
        `  ${alt.choice.padEnd(10)} ${this.aiTeamLabel(alt.model)}`);
      lines.push(theme.fg("muted", "Use /project analyst quality|efficient --confirm to run the real analysis (consumes real quota)."));
      return { title: `PROJECT ANALYSIS · ${project} — Select Project Analyst`, lines };
    }
    if (!strategy) {
      return {
        title: "GLOBAL MODEL GUIDE",
        lines: [theme.fg("warning", `Project ${project} not analyzed — use /project analyze for a real, project-specific team.`), ...this.teamsColumnsLines(width)]
      };
    }
    const lines = [];
    const projectTeam = strategy.projectTeam ?? strategy.qualityTeam ?? [];
    const modelColumnWidth = this.teamModelColumnWidth([
      strategy.bootstrapAnalyst, strategy.orchestrator, ...projectTeam.map((entry) => entry.model)
    ]);
    lines.push(theme.fg("muted", "Operational picks: the efficient model among eligible candidates for each role (quality leader shown when it differs)."));
    if (strategy.bootstrapAnalyst) lines.push(`${"Project Analyst".padEnd(18)} ${this.teamRoleLabel(strategy.bootstrapAnalyst, modelColumnWidth)}`);
    if (strategy.orchestrator) {
      lines.push(`${"Orchestrator*".padEnd(18)} ${this.teamRoleLabel(strategy.orchestrator, modelColumnWidth)}`);
      lines.push(theme.fg("muted", "  * Architect's quality pick — Kairo has no separate orchestrator capability profile yet."));
    }
    // The real OPERATIONAL team (see buildProjectStrategy's own doc) —
    // never qualityTeam, which is comparative reference only. The overlay
    // (project-overlay.js) already shows projectTeam under this exact
    // same "PROJECT TEAM" title; showing something else here under the
    // same label was the real, reported mismatch. qualityTeam only
    // remains as a fallback for a strategy persisted before projectTeam
    // existed (see applyProjectTeamOverride's own legacy-entry comment).
    const eligibility = this.snapshot?.modelIntelligence?.eligibility ?? {};
    const claudeEntitlement = this.snapshot?.modelIntelligence?.claudeEntitlement ?? {};
    for (const entry of projectTeam) {
      lines.push(`${entry.role.padEnd(18)} ${entry.model ? this.teamRoleLabel(entry.model, modelColumnWidth) : theme.fg("warning", "no eligible option")}`);
      const extra = this.projectTeamCompactExtraLine(entry, strategy, { eligibility, claudeEntitlement });
      if (extra) lines.push(theme.fg("muted", `  ${extra}`));
    }
    if (strategy.status === "suggested") lines.push(theme.fg("muted", "Suggested from real project analysis. Use /project approve to activate."));
    if (strategy.status === "stale") lines.push(theme.fg("warning", "Real evidence changed since approval — use /project refresh."));
    return { title: `PROJECT TEAM · ${project} · ${strategy.status.toUpperCase()}`, lines };
  }

  /**
   * At most one muted extra line for the compact PROJECT TEAM panel —
   * only when it adds something the role row itself doesn't already say
   * (quality leader differs, or a real availability warning). Same pick
   * + available → null.
   */
  projectTeamCompactExtraLine(entry, strategy, { eligibility = {}, claudeEntitlement = {} } = {}) {
    const availability = resolveAssignmentAvailability(entry?.model, { eligibility, claudeEntitlement });
    if (availability.warning) return availability.warning;
    if (!strategy?.qualityTeam || !entry?.model) return null;
    const qualityEntry = strategy.qualityTeam.find((row) => row.role === entry.role);
    if (!qualityEntry?.model) return null;
    const samePick = qualityEntry.model.adapterId === entry.model.adapterId
      && qualityEntry.model.modelId === entry.model.modelId;
    if (samePick) return null;
    const retention = entry.decisionEvidence?.retention;
    const retentionPct = retention != null ? Math.round(retention * 100) : null;
    const leaderLabel = this.aiTeamLabel(qualityEntry.model);
    if (retentionPct != null) {
      return `Quality leader: ${leaderLabel} — operational pick retains ${retentionPct}%`;
    }
    return `Quality leader: ${leaderLabel}`;
  }

  /** Contextual key hints — shown in the dashboard's fixed zone, not the scrollable conversation. */
  renderFooterLines() {
    const row = this.selectedRow();
    const footerLines = [theme.fg("muted", "Enter send · Shift+Tab mode · /help · /usage · q quit")];
    if (row) {
      // Only ever advertises a key the current WorkMode actually lets
      // through (see rows.js's isActionAvailable) — ASK's list stays
      // "Enter open" only, never a stale "a approve" that would silently
      // do nothing if pressed.
      const controls = ["Enter open"];
      if (isActionAvailable("approve", row, this.workMode)) controls.push("a approve");
      if (isActionAvailable("reject", row, this.workMode)) controls.push("j reject");
      if (isActionAvailable("execute", row, this.workMode)) controls.push("x implement");
      if (isActionAvailable("cancel", row, this.workMode)) controls.push("c cancel");
      footerLines.push(theme.fg("muted", this.hasListFocus
        ? `Plan controls: ${controls.join(" · ")}`
        : `Tab for plan controls (${controls.slice(1).join("/") || "view only"}) — typing here just sends a message`));
    }
    return footerLines;
  }

  /**
   * The fixed dashboard zone for the real-scroll layout (app.js wires this
   * as its own VStack entry, shrink: 0, above a scrollable conversation):
   * USAGE/AI TEAM/EFFICIENT TEAM cards plus the contextual footer hints.
   * Unlike renderConversation(), this is framed/truncated like the rest of
   * the cockpit's cards — it never needs to preserve unbounded content the
   * way scrollable chat history does.
   */
  renderDashboard(width) {
    const lines = [...this.renderDashboardLines(width), ...this.renderFooterLines()];
    return lines.map((line) => truncateToWidth(line, width, "…"));
  }

  /**
   * The scrollable conversation zone for the real-scroll layout: every
   * retained transcript entry (never sliced to a viewport-sized recent
   * window — pi-tui's ScrollView owns which lines are actually visible),
   * wrapped (never truncated — a long response or /models breakdown must
   * stay fully readable by scrolling, not lose text off the right edge),
   * with the pending confirm-execute prompt appended at the very end so it
   * surfaces immediately once ScrollView's follow:"end" behavior is
   * active, exactly where a real chat's newest message would land.
   */
  renderConversation(width) {
    if (this.mode !== "confirm-execute" && this.mode !== "select-role" && this.transcript.length === 0 && !this.statusMessage && !this.actionLabel) {
      return [
        theme.fg("muted", "Ask Kairo about this project, or describe work to plan."),
        "",
        theme.fg("muted", "Use /help to see commands.")
      ];
    }
    const lines = [];
    for (const entry of this.transcript) {
      // Wrapping (wrapTextWithAnsi) is the expensive part of rendering a
      // real conversation, and renderConversation() runs on EVERY render —
      // including every keystroke while typing. Cached by entry id (stable,
      // never re-derived from array index) + width, so a keystroke only
      // ever re-wraps if the terminal itself was resized, never the whole
      // history again. Entries are immutable once pushed, so nothing else
      // can go stale here.
      const cacheKey = `${entry.id}:${width}`;
      let entryLines = this._wrapCache.get(cacheKey);
      if (!entryLines) {
        const isUser = entry.role === "You";
        const label = isUser ? "> " : "Kairo ";
        const prefixWidth = visibleWidth(label);
        const coloredPrefix = isUser ? theme.fg("accent", label) : theme.fg("info", label);
        const wrapped = wrapTextWithAnsi(entry.text, Math.max(1, width - prefixWidth));
        entryLines = wrapped.map((wrappedLine, index) => (index === 0 ? `${coloredPrefix}${wrappedLine}` : `${" ".repeat(prefixWidth)}${wrappedLine}`));
        this._wrapCache.set(cacheKey, entryLines);
      }
      lines.push(...entryLines);
    }
    // A live in-flight action always wins over a leftover static message —
    // see actionStatusLine()'s own doc.
    const liveStatus = this.actionStatusLine();
    if (liveStatus) {
      lines.push("");
      lines.push(theme.fg("accent", liveStatus));
    } else if (this.statusMessage) {
      lines.push("");
      lines.push(theme.fg("accent", this.statusMessage));
    }
    if (this.mode === "confirm-execute") {
      lines.push("");
      lines.push(...this.confirmPromptLines(this.selectedRow()));
    }
    if (this.mode === "select-role") {
      lines.push("");
      lines.push(...this.roleSelectPromptLines());
    }
    return lines;
  }

  /**
   * Conversation-first workspace, framed like the rest of the cockpit
   * (rounded cards, per-line tone) instead of plain padded text — a compact
   * usage card up top, the transcript/workflow card owning the rest of the
   * screen, and key hints as a plain footer beneath both. This is the
   * monolithic single-render fallback for test doubles and pi-tui builds
   * without viewport/layout support — the real cockpit uses
   * renderDashboard()/renderConversation() instead, tiled by app.js with a
   * real scrollable ScrollView around the conversation.
   */
  renderWorkspace(width) {
    const lines = [...this.renderDashboardLines(width)];
    const footerLines = this.renderFooterLines();

    // The chat is plain, unframed text — it's the dominant, scrollable
    // conversation surface, not another bordered widget. How much of it
    // fits is real content, not padding: a short conversation just renders
    // short instead of being stretched or capped by an arbitrary constant.
    const viewportRows = this.getViewportRows?.();
    const overhead = lines.length + 1 /* spacer before chat */ + footerLines.length;
    const chatBudget = Number.isFinite(viewportRows) ? Math.max(0, viewportRows - overhead) : undefined;

    lines.push("");
    lines.push(...this.chatLines(chatBudget));
    lines.push(...footerLines);
    return lines.map((line) => truncateToWidth(line, width, "…"));
  }

  /**
   * Model shown for a role in the compact widget: whichever one Kairo
   * would actually use right now — the primary when it's available, else
   * the fallback when that's available, else null (nothing eligible
   * covers this role). Never the unavailable primary itself: showing an
   * unusable model as the headline is exactly the confusion this method
   * exists to avoid — the full primary/fallback/availability breakdown
   * stays one level down, in aiTeamDetailLines().
   */
  static effectiveTeamModel({ primary, fallback }) {
    if (primary.available) return primary;
    if (fallback?.available) return fallback;
    return null;
  }

  /**
   * A model's displayed name — deliberately WITHOUT its provider. Used by
   * the MODEL TEAMS widget and the plain /models view: a "Perfil → Modelo"
   * glance, provider hidden (adapterId is kept internally for every real
   * decision — concentration limits, corroboration, execution — this only
   * affects what's shown). `/models --evidence` shows the provider
   * explicitly instead (see aiTeamLabelWithProvider) — that's the audit
   * trail where it belongs.
   */
  // modelName (real, cleaned via model-candidate-catalog.js's
  // stripDisplayVariant — e.g. "GPT-5.6 Sol", never "GPT-5.6 Sol 1M
  // Extra High") is preferred everywhere a compact widget shows a model.
  // A caller not yet routed through the Recommendation Pool (no real
  // modelName attached) falls back to the raw displayName, then modelId
  // — never blank.
  aiTeamLabel(model) {
    return model.modelName ?? model.displayName ?? model.modelId;
  }

  /** Same as aiTeamLabel(), but with the real provider AND the raw, unmodified display text (variant/effort/context tokens intact) — deliberately NOT the cleaned modelName, since this is the technical `/models --evidence` breakdown, which keeps the real detail modelName strips out. */
  aiTeamLabelWithProvider(model) {
    const provider = model.adapterId.charAt(0).toUpperCase() + model.adapterId.slice(1);
    const raw = model.displayName ?? model.modelId;
    return `${provider} · ${raw}`;
  }

  /**
   * Role -> model -> provider, for the PROJECT TEAM listing specifically:
   * keeps aiTeamLabel()'s cleaned modelName (unlike aiTeamLabelWithProvider's
   * raw/technical variant) but still names the real adapter each role would
   * actually run against — two roles can land on visually similar model
   * names from different providers, and knowing which subscription a role
   * draws from is exactly what a real, provider-aware team review needs.
   *
   * `modelColumnWidth` left-pads the model name so every row's " · Provider"
   * lines up in its own column instead of drifting with each model name's
   * own length — see `CockpitView.teamModelColumnWidth()`, which a caller
   * computes once across the real rows it's about to render and passes
   * here for every row in that same list.
   * @param {object} model
   * @param {number} [modelColumnWidth]
   */
  teamRoleLabel(model, modelColumnWidth = 0) {
    const provider = model.adapterId.charAt(0).toUpperCase() + model.adapterId.slice(1);
    return `${this.aiTeamLabel(model).padEnd(modelColumnWidth)}  ·  ${provider}`;
  }

  /**
   * The real model-name column width for a set of rows about to be
   * rendered with `teamRoleLabel()` — the longest real, cleaned model
   * name among them, never a fixed guess (model names vary wildly in
   * length, e.g. "GPT-5.6-Terra" vs "Muse Spark 1.3 1M Extra High").
   * @param {Array<object|null|undefined>} models
   */
  teamModelColumnWidth(models) {
    return models.reduce((max, model) => (model ? Math.max(max, this.aiTeamLabel(model).length) : max), 0);
  }

  /**
   * The global "AI TEAM" widget: one line per role (Explorer / Architect /
   * Builder / Debugger / Tester / Reviewer) naming only the
   * model that would actually run right now. This is the general team,
   * not a per-project portfolio: which of these roles a given repo
   * activates is a separate, later decision. Kept deliberately terse —
   * the real distribution policy behind each pick (capability margins,
   * fallback, why it isn't always the raw top score) lives in
   * aiTeamDetailLines(), reachable via /models, not cluttering the glance.
   */
  fitLines() {
    const intel = this.snapshot?.modelIntelligence;
    if (!intel || intel.status === "unknown") {
      const reason = intel?.error ? ` (${intel.error})` : "";
      return [theme.fg("muted", `No model benchmark data yet${reason}`)];
    }
    const freshness = intel.status === "live" ? "live" : `cached ${intel.age ?? "?"}`;
    // QUALITY TEAM: the real, portfolio-coordinated pick — not a bare
    // per-role leaderboard. The uncoordinated individual leader
    // (globalGuide.capability) is evidence, surfaced in /models, never the
    // dashboard headline — see teamsColumnsLines()'s own comment for why.
    const team = intel.aiTeam ?? [];
    if (!team.length) {
      const reasons = Object.entries(intel.eligibility ?? {})
        .filter(([, check]) => !check.ok)
        .map(([adapterId, check]) => `${adapterId}: ${check.reason}`);
      return [theme.fg("muted", `Evidence: ${freshness}`), theme.fg("warning", "No eligible model signals right now"), ...reasons.map((r) => theme.fg("muted", r))];
    }
    const lines = [theme.fg("muted", `Evidence: ${freshness}`)];
    for (const entry of team) {
      const effective = CockpitView.effectiveTeamModel(entry);
      const modelText = effective ? this.aiTeamLabel(effective) : theme.fg("warning", "no eligible option right now");
      lines.push(`${entry.role.padEnd(10)} ${modelText}`);
    }
    lines.push(theme.fg("muted", "Use /models for why, and /why for coverage and eligibility."));
    return lines;
  }

  /**
   * MODEL TEAMS' unified widget: one combined panel with a real, drawn "│"
   * separator between the QUALITY TEAM and EFFICIENT TEAM columns, instead
   * of two separate AI TEAM/EFFICIENT TEAM cards or a plain-space gap that
   * could look like column drift. This is now the ONLY dashboard team
   * widget — used at every width, side by side with USAGE on medium/wide
   * terminals and stacked below it on narrow ones (see
   * renderDashboardLines()).
   *
   * Both column widths are computed from the real width actually
   * available (never a fixed constant) — split evenly between QUALITY and
   * EFFICIENT after reserving room for the role column and both real "│"
   * separators — and each cell is truncated INDEPENDENTLY, so a long
   * QUALITY entry can never bleed into the EFFICIENT column even under a
   * narrow terminal; truncation only ever happens when content actually
   * doesn't fit, never as a fixed cap.
   * @param {number} [width] - real content width available to this panel
   *   (already inside its frame — see cardInnerWidth()); defaults to a
   *   reasonable width for callers that don't have a real one yet (tests).
   */
  teamsColumnsLines(width = 80) {
    const intel = this.snapshot?.modelIntelligence;
    if (!intel || intel.status === "unknown") return this.fitLines();
    // QUALITY TEAM / EFFICIENT TEAM: the real, portfolio-coordinated picks
    // (aiTeam/efficientTeam — family concentration, provider distribution,
    // Builder/Reviewer independence all apply). This widget is not a bare
    // leaderboard: it shows a usable TEAM, correctly labeled as one. The
    // real bug this session fixed wasn't showing coordination here — a
    // real team needs it — it was the earlier "CAPABILITY"/"EFFICIENT"
    // labels implying "the single best model, full stop" for what was
    // always a coordinated pick. The uncoordinated individual leader
    // (globalGuide.capability/efficient) is real evidence for a different
    // question ("what's honestly best with nothing else in play?") and
    // belongs in /models, never this dashboard headline.
    const aiTeam = intel.aiTeam ?? [];
    if (!aiTeam.length) return this.fitLines();
    const freshness = intel.status === "live" ? "live" : `cached ${intel.age ?? "?"}`;
    const efficientByRole = Object.fromEntries((intel.efficientTeam ?? []).map((entry) => [entry.role, entry]));

    const roleWidth = 10;
    const separator = " │ ";
    const remaining = Math.max(2, width - roleWidth - separator.length * 2);
    const capabilityWidth = Math.max(1, Math.ceil(remaining / 2));
    const efficientWidth = Math.max(1, remaining - capabilityWidth);
    const formatRow = (roleText, capabilityText, efficientText) => {
      const roleCell = truncateToWidth(roleText, roleWidth, "").padEnd(roleWidth);
      const capabilityClipped = truncateToWidth(capabilityText, capabilityWidth, "…");
      const capabilityCell = capabilityClipped + " ".repeat(Math.max(0, capabilityWidth - visibleWidth(capabilityClipped)));
      const efficientCell = truncateToWidth(efficientText, efficientWidth, "…");
      return `${roleCell}${separator}${capabilityCell}${separator}${efficientCell}`;
    };

    const lines = [
      theme.fg("muted", `Evidence: ${freshness}`),
      theme.fg("muted", formatRow("", "QUALITY TEAM", "EFFICIENT TEAM"))
    ];
    for (const entry of aiTeam) {
      const capabilityEffective = CockpitView.effectiveTeamModel(entry);
      const capabilityText = capabilityEffective ? this.aiTeamLabel(capabilityEffective) : "no eligible option";
      const efficientEntry = efficientByRole[entry.role];
      const efficientEffective = efficientEntry ? CockpitView.effectiveTeamModel(efficientEntry) : null;
      const efficientText = efficientEffective ? this.aiTeamLabel(efficientEffective) : "—";
      lines.push(formatRow(entry.role, capabilityText, efficientText));
    }
    lines.push(theme.fg("muted", "Use /models for why."));
    return lines;
  }

  static ROLE_CAPABILITY_BLURB = ROLE_CAPABILITY_BLURB;

  /**
   * The default, human-readable `/models` output: per role, the selected
   * model, why (via explainTeamDecision — real reason or leader/blurb
   * formulation), the EFFICIENT TEAM alternative when it actually differs,
   * and the real fallback used if the selection becomes unavailable.
   * Deliberately no raw metrics, percentages, internal ids, or source
   * names — that detail moves to /models --evidence (aiTeamDetailLines()).
   */
  modelsExplainLines() {
    const intel = this.snapshot?.modelIntelligence;
    if (!intel || intel.status === "unknown") return this.fitLines();
    const aiTeam = intel.aiTeam ?? [];
    if (!aiTeam.length) return this.fitLines();
    const efficientByRole = Object.fromEntries((intel.efficientTeam ?? []).map((entry) => [entry.role, entry]));
    const leaderByRole = Object.fromEntries((intel.globalGuide?.capability ?? []).map((entry) => [entry.role, entry]));
    const freshness = intel.status === "live" ? "live" : `cached ${intel.age ?? "?"}`;
    const lines = [theme.fg("muted", `Evidence: ${freshness}`)];
    aiTeam.forEach((entry, index) => {
      const { role, primary, fallback } = entry;
      // A blank string here would get silently dropped once routed through
      // the persisted chat transcript (addTranscript trims and discards
      // empty text) — a visible divider is the only separator that
      // actually survives into the real, persisted chat history.
      if (index > 0) lines.push(theme.fg("muted", "·"));
      const availabilityNote = primary.available ? "" : " (currently unavailable)";
      lines.push(`${role.padEnd(10)} ${this.aiTeamLabel(primary)}${availabilityNote}`);
      lines.push(theme.fg("muted", `  ${explainTeamDecision(entry)}`));

      // The uncoordinated individual leader (globalGuide) — evidence for
      // "what's honestly best with nothing else in play?", never the
      // dashboard headline. Only worth a line when it actually differs
      // from the QUALITY TEAM pick — a diversity/concentration reason
      // above already implies it does; a null reason means they agree.
      const leaderEntry = leaderByRole[role];
      if (leaderEntry?.primary && (leaderEntry.primary.adapterId !== primary.adapterId || leaderEntry.primary.modelId !== primary.modelId)) {
        lines.push(theme.fg("muted", `  Individual leader: ${this.aiTeamLabel(leaderEntry.primary)} — the raw per-role best, uncoordinated with the rest of the team.`));
      }

      const efficientEntry = efficientByRole[role];
      if (efficientEntry) {
        const samePick = efficientEntry.primary.adapterId === primary.adapterId && efficientEntry.primary.modelId === primary.modelId;
        if (samePick) {
          lines.push(theme.fg("muted", "  Efficient: same pick — no cheaper or faster real alternative within the capability floor."));
        } else {
          const efficientWhy = efficientEntry.reason ? ` — ${efficientEntry.reason}` : "";
          lines.push(theme.fg("muted", `  Efficient: ${this.aiTeamLabel(efficientEntry.primary)}${efficientWhy}`));
        }
      }

      if (fallback) {
        lines.push(theme.fg("muted", `  Fallback: ${this.aiTeamLabel(fallback)} — used if this model becomes unavailable.`));
      } else if (!primary.available) {
        lines.push(theme.fg("warning", "  Fallback: none eligible right now."));
      }
    });
    lines.push(theme.fg("muted", "Use /models --evidence for the underlying metrics and sources."));
    return lines;
  }

  /**
   * Renders one team's full technical breakdown — primary (with its real
   * provider shown, unlike the default views), availability, fallback,
   * real per-capability benchmark coverage and confidence (decisionEvidence
   * — see buildDecisionEvidence in model-intelligence.js; falls back to
   * the older aggregate coverage/confidence fields for a snapshot saved
   * before decisionEvidence existed, so it never breaks on old data),
   * EFFICIENT's real retention/risk-floor and Pareto/tiebreak savings when
   * present, the distribution-policy reason, and any real corroborating
   * evidence the Model Intelligence Foundation registry has for that exact
   * model. Never recalculates anything — every number here was already
   * computed during real selection. Shared by AI TEAM and EFFICIENT TEAM
   * inside aiTeamDetailLines(); also reused by projectTeamEvidenceLines
   * via the optional `extraLinesFor` hook (never forked).
   * @param {Array<object>} team
   * @param {{extraLinesFor?: (entry: object) => string[]|null|undefined}} [options]
   */
  teamEvidenceLines(team, { extraLinesFor } = {}) {
    const lines = [];
    const corroborationLine = (model) => (model.corroboration ?? [])
      .map((entry) => `${entry.metric}=${entry.value} (${entry.source})`)
      .join(" · ");
    team.forEach((entry, index) => {
      const { role, primary, fallback, reason, coverage, confidence, decisionEvidence } = entry;
      // A blank string here would get silently dropped once this line is
      // routed through the persisted chat transcript (addTranscript trims
      // and discards empty text) — a visible divider is the only separator
      // that actually survives into the real, persisted chat history.
      if (index > 0) lines.push(theme.fg("muted", "·"));
      const primaryLabel = this.aiTeamLabelWithProvider(primary);
      const primaryText = primary.available ? primaryLabel : `${primaryLabel} (not available)`;
      lines.push(`${role.padEnd(10)} ${primaryText}`);

      const capabilityCoverage = decisionEvidence?.coverage ?? {};
      const capabilities = Object.keys(capabilityCoverage);
      if (capabilities.length) {
        // Real benchmark IDENTITIES, not sources (see
        // capability-scoring.js's activeBenchmarkCountForCapability) —
        // "0/3" for a required capability means every real score for it
        // came from a composite index fallback, never a component
        // benchmark, so it's called out explicitly rather than left to
        // look like ordinary thin coverage.
        const parts = capabilities.map((capability) => {
          const c = capabilityCoverage[capability];
          const fallbackNote = c.have === 0 && c.active > 0 ? " (composite fallback)" : "";
          return `${capability} ${c.have}/${c.active}${fallbackNote}`;
        });
        const allComparable = capabilities.every((capability) => capabilityCoverage[capability].comparable);
        const tone = allComparable ? "muted" : "warning";
        lines.push(theme.fg(tone, `  ${parts.join(" · ")} · ${allComparable ? "comparable" : "provisional"} · confidence ${decisionEvidence.confidence ?? "unknown"}`));
      } else if (coverage != null) {
        // A snapshot saved before decisionEvidence existed — the older,
        // single-fraction aggregate is still real data, just coarser.
        const coveragePercent = Math.round(coverage * 100);
        const coverageTone = coveragePercent < 100 ? "warning" : "muted";
        lines.push(theme.fg(coverageTone, `  coverage: ${coveragePercent}% of relevant capabilities scored · confidence: ${confidence ?? "unknown"}`));
      }

      // EFFICIENT-only: real retention against the QUALITY leader and the
      // real risk-based floor it had to clear — never shown for QUALITY,
      // where these concepts don't apply (decisionEvidence.retention is
      // null there by construction).
      //
      // The raw ratio (chosen.gapValue / leader.gapValue) can genuinely
      // exceed 1 — the two gapValues come from different candidate-ranking
      // tiers (leader is eligibleRanked[0], the raw top-by-value; chosen
      // can come from the comparable-preferred pool once a provisional
      // raw leader is demoted — see preferComparableCandidates) — so a
      // value above 100% is real, not a bug, but "retention 117%" reads as
      // nonsensical: you can't retain more than the whole of something.
      // Reported instead as "exceeds QUALITY reference by N%", keeping the
      // word "retention" reserved for its own real 0-100% meaning; the raw
      // ratio itself is untouched in decisionEvidence.retention for audit.
      if (decisionEvidence?.retention != null && decisionEvidence.requiredFloor != null) {
        const floorPct = Math.round(decisionEvidence.requiredFloor * 100);
        const riskNote = `${decisionEvidence.riskLevel ?? "unknown"}-risk role`;
        if (decisionEvidence.retention > 1) {
          const excessPct = Math.round((decisionEvidence.retention - 1) * 100);
          lines.push(theme.fg("muted", `  exceeds QUALITY reference by ${excessPct}% · required ${floorPct}% · ${riskNote}`));
        } else {
          const retentionPct = Math.round(decisionEvidence.retention * 100);
          lines.push(theme.fg("muted", `  retention ${retentionPct}% · required ${floorPct}% · ${riskNote}`));
        }
      }
      // Real savings evidence — only ever shown when a real resource
      // dimension actually decided the pick (see describeEfficiencyDecision);
      // never invented when the metric that would justify it is missing.
      if (decisionEvidence?.savings) {
        const kind = decisionEvidence.decisionType === "pareto" ? "Pareto balance" : "Tiebreak";
        const { label, from, to } = decisionEvidence.savings;
        lines.push(theme.fg("muted", `  ${kind} · ${label} ${from} → ${to}`));
      }

      const primaryEvidence = corroborationLine(primary);
      if (primaryEvidence) lines.push(theme.fg("muted", `  also: ${primaryEvidence}`));
      if (fallback) lines.push(theme.fg("muted", `  fallback ${this.aiTeamLabelWithProvider(fallback)}`));
      else if (!primary.available) lines.push(theme.fg("warning", "  no eligible fallback right now"));
      if (reason) lines.push(theme.fg("muted", `  ${reason}`));
      if (extraLinesFor) {
        for (const line of extraLinesFor(entry) ?? []) lines.push(line);
      }
    });
    return lines;
  }

  /**
   * Thin adapter: maps strategy.projectTeam entries onto teamEvidenceLines'
   * primary/fallback shape, resolving availability explicitly (projectModelRef
   * has no `available`), and injecting quality-leader + entitlement warnings
   * via extraLinesFor — never a forked evidence renderer.
   * @param {object} strategy
   * @param {{eligibility?: object, claudeEntitlement?: object}} [opts]
   */
  projectTeamEvidenceLines(strategy, { eligibility = {}, claudeEntitlement = {} } = {}) {
    const projectTeam = strategy?.projectTeam ?? [];
    const hasQualityTeam = Array.isArray(strategy?.qualityTeam);
    const qualityByRole = new Map((strategy?.qualityTeam ?? []).map((row) => [row.role, row]));

    const team = projectTeam.map((entry) => {
      const primaryAvailability = resolveAssignmentAvailability(entry.model, { eligibility, claudeEntitlement });
      const fallbackAvailability = entry.fallback
        ? resolveAssignmentAvailability(entry.fallback, { eligibility, claudeEntitlement })
        : null;
      return {
        role: entry.role,
        primary: entry.model
          ? { ...entry.model, available: primaryAvailability.available }
          : { adapterId: "?", modelId: "?", displayName: "no eligible option", available: false },
        fallback: entry.fallback
          ? { ...entry.fallback, available: fallbackAvailability.available }
          : null,
        reason: entry.reason ?? null,
        decisionEvidence: entry.decisionEvidence ?? null,
        coverage: entry.coverage,
        confidence: entry.confidence,
        _availabilityWarning: primaryAvailability.warning,
        _qualityEntry: qualityByRole.get(entry.role) ?? null
      };
    });

    return this.teamEvidenceLines(team, {
      extraLinesFor: (mapped) => {
        const extra = [];
        if (mapped._availabilityWarning) {
          extra.push(theme.fg("warning", `  ${mapped._availabilityWarning}`));
        }
        if (!hasQualityTeam) return extra;
        const qualityEntry = mapped._qualityEntry;
        if (!qualityEntry?.model || !mapped.primary?.modelId) return extra;
        const samePick = qualityEntry.model.adapterId === mapped.primary.adapterId
          && qualityEntry.model.modelId === mapped.primary.modelId;
        if (samePick) {
          extra.push(theme.fg("muted", "  Also the quality leader for this role."));
          return extra;
        }
        const retention = mapped.decisionEvidence?.retention;
        const retentionPct = retention != null ? Math.round(retention * 100) : null;
        const leaderLabel = this.aiTeamLabel(qualityEntry.model);
        if (retentionPct != null) {
          extra.push(theme.fg("muted", `  Quality leader: ${leaderLabel} — operational pick retains ${retentionPct}%`));
        } else {
          extra.push(theme.fg("muted", `  Quality leader: ${leaderLabel}`));
        }
        return extra;
      }
    });
  }

  /**
   * `/models --evidence`: the full breakdown behind both AI TEAM and
   * EFFICIENT TEAM picks — real provider, primary, availability, fallback,
   * real coverage/confidence, the real distribution-policy reason
   * (near-tie, independence swap, temporarily-unavailable leader,
   * efficiency dimension), and any real corroborating evidence the Model
   * Intelligence Foundation registry has for that exact model (Hugging
   * Face, manufacturer snapshots, Kairo's own telemetry). Corroboration is
   * informational only: it never changed which model was picked, so it's
   * shown, never blended into the reason. Also lists every real catalog
   * model Kairo has access to but couldn't match to any real AA data —
   * UNSCORED, never given an invented score, never silently dropped. This
   * is the technical audit trail; modelsExplainLines() is the plain-
   * language default /models shows instead.
   */
  aiTeamDetailLines() {
    const intel = this.snapshot?.modelIntelligence;
    if (!intel || intel.status === "unknown") return this.fitLines();
    const team = intel.aiTeam ?? [];
    if (!team.length) return this.fitLines();
    const freshness = intel.status === "live" ? "live" : `cached ${intel.age ?? "?"}`;
    const lines = [theme.fg("muted", `Evidence: ${freshness}`)];
    lines.push(...this.teamEvidenceLines(team));
    const efficientTeam = intel.efficientTeam ?? [];
    if (efficientTeam.length) {
      lines.push(theme.fg("muted", "·"));
      lines.push(theme.fg("muted", "EFFICIENT TEAM"));
      lines.push(...this.teamEvidenceLines(efficientTeam));
    }
    const unscored = intel.unscoredModels ?? [];
    if (unscored.length) {
      lines.push(theme.fg("muted", "·"));
      lines.push(theme.fg("muted", "UNSCORED (real catalog model, no matching Artificial Analysis data — never given an invented score):"));
      for (const model of unscored) {
        lines.push(theme.fg("muted", `  ${this.aiTeamLabelWithProvider({ ...model, displayName: model.displayName ?? model.modelId })}`));
      }
    }
    return lines;
  }

  /**
   * `/why` detail: every candidate provider's real eligibility outcome
   * (which were rejected and their exact reason, which survived) plus a
   * coverage/confidence line per provider — its real catalog source
   * (measured vs. documented) and how much of it Kairo could match to
   * real Artificial Analysis data. This is what stops "Fable is the best
   * model available now" from being read as "Fable is the only model
   * Kairo could ever evaluate": a provider can be fully eligible and
   * still have unmatched models simply because AA doesn't track them, or
   * because Kairo only has a documented catalog for it, not a live
   * per-account discovery (true for Claude today). The main FIT widget
   * stays a single line per role; this is the drill-down.
   */
  fitWhyLines() {
    const intel = this.snapshot?.modelIntelligence;
    const eligibility = Object.entries(intel?.eligibility ?? {});
    const coverage = intel?.coverage ?? [];
    if (!eligibility.length && !coverage.length) return [theme.fg("muted", "No eligibility data yet.")];
    const lines = eligibility.map(([adapterId, check]) => (check.ok
      ? theme.fg("success", `${adapterId}: eligible`)
      : theme.fg("muted", `${adapterId}: excluded — ${check.reason}`)));
    if (coverage.length) {
      lines.push("");
      lines.push(theme.fg("muted", "Catalog coverage (real data matched, not runtime eligibility):"));
      for (const entry of coverage) {
        lines.push(theme.fg("muted", `${entry.adapterId}: ${entry.catalogStatus} catalog, ${entry.matchedModels}/${entry.totalModels} models matched to Artificial Analysis`));
      }
    }
    return lines;
  }

  /**
   * @param {number} [chatBudget] - how many chat lines actually fit on
   *   screen; omitted (tests, narrow terminals) falls back to a fixed
   *   recent-history window instead of showing everything unbounded.
   */
  chatLines(chatBudget) {
    if (this.mode !== "confirm-execute" && this.mode !== "select-role" && this.transcript.length === 0 && !this.statusMessage && !this.actionLabel) {
      return [
        theme.fg("muted", "Ask Kairo about this project, or describe work to plan."),
        "",
        theme.fg("muted", "Use /help to see commands.")
      ];
    }
    const lines = [];
    // The execute confirmation (y/n) is a real pending decision, not status
    // chrome — it belongs in the dominant chat surface, not a separate
    // widget that could be scrolled past or removed. Same for the role
    // picker that can precede it.
    if (this.mode === "confirm-execute") {
      lines.push(...this.confirmPromptLines(this.selectedRow()));
      lines.push("");
    }
    if (this.mode === "select-role") {
      lines.push(...this.roleSelectPromptLines());
      lines.push("");
    }
    // A live in-flight action always wins over a leftover static message —
    // see actionStatusLine()'s own doc.
    const liveStatus = this.actionStatusLine();
    if (liveStatus) {
      lines.push(theme.fg("accent", liveStatus));
      lines.push("");
    } else if (this.statusMessage) {
      lines.push(theme.fg("accent", this.statusMessage));
      lines.push("");
    }
    const historyLimit = Number.isFinite(chatBudget) ? Math.max(1, chatBudget - lines.length) : 8;
    for (const entry of this.transcript.slice(-historyLimit)) {
      const prefix = entry.role === "You" ? theme.fg("accent", "> ") : theme.fg("info", "Kairo ");
      lines.push(`${prefix}${entry.text}`);
    }
    return lines;
  }

  /**
   * The compact USAGE bar: one plain line — `KAIRO · project │ Codex 5h
   * 58% / W 86% │ Claude S 34% / W 65% │ Go 100% / 100% / 96%` — never a
   * bordered card (see renderDashboardLines()). Only AUTOMATIC-routing
   * providers appear (Codex, Claude, OpenCode Go); Zen/Cursor are
   * manual/PAYG-risk, never part of the same automatic resource pool, and
   * stay in `/providers` instead. Two lines only when the real content
   * genuinely doesn't fit the given width — the header segment alone on
   * its own line, the three provider segments on the next — never padded
   * to any fixed height.
   * @param {number} [width]
   * @returns {string[]}
   */
  compactUsageLines(width = 80) {
    const project = this.snapshot?.projectRoot?.split("/").filter(Boolean).pop() ?? "current project";
    const usage = this.snapshot?.usage ?? {};
    const providers = this.snapshot?.providers ?? {};
    const status = (name) => providers[name]?.status ?? providers[name.toLowerCase()]?.status;

    const codex = usage.codex;
    const codexText = codex?.primary
      ? `Codex 5h ${codex.primary.remainingPercent}%${quotaWarnSuffix(codex.primary.remainingPercent)}${codex.secondary ? ` / W ${codex.secondary.remainingPercent}%${quotaWarnSuffix(codex.secondary.remainingPercent)}` : ""}`
      : `Codex ${status("Codex") ?? "usage unknown"}`;

    const claude = usage.claude;
    const claudeText = claude?.primary
      ? `Claude S ${claude.primary.remainingPercent}%${quotaWarnSuffix(claude.primary.remainingPercent)}${claude.secondary ? ` / W ${claude.secondary.remainingPercent}%${quotaWarnSuffix(claude.secondary.remainingPercent)}` : ""}`
      : `Claude ${status("Claude") ?? "usage unknown"}`;

    const go = usage.opencode?.go;
    const goText = go?.windows?.length
      ? `Go ${go.windows.map((window) => {
        const limited = window.status === "rate-limited";
        return `${window.remainingPercent}%${limited ? " LIMITED" : quotaWarnSuffix(window.remainingPercent)}`;
      }).join(" / ")}`
      : `Go ${status("OpenCode") ?? "usage unknown"}`;

    const header = `KAIRO · ${project}`;
    const segments = [codexText, claudeText, goText];
    const full = `${header} │ ${segments.join(" │ ")}`;
    if (visibleWidth(full) <= width) return [theme.fg("muted", full)];
    return [theme.fg("muted", header), theme.fg("muted", segments.join(" │ "))];
  }

  providerLines() {
    const providers = this.snapshot?.providers ?? {};
    const entry = (name, fallback) => {
      const value = providers[name]?.status ?? providers[name.toLowerCase()]?.status;
      return value ?? fallback;
    };
    const usage = this.snapshot?.usage ?? {};
    const codex = usage.codex;
    const claude = usage.claude;
    const open = usage.opencode;
    const codexText = codex?.windows?.length
      ? codex.windows.map((window) => `${window.name} ${window.remainingPercent}% left`).join(" · ")
      : entry("Codex", "READY · usage unknown");
    const claudeText = claude?.windows?.length
      ? claude.windows.map((window) => `${window.label ?? window.name} ${window.remainingPercent}% left`).join(" · ")
      : entry("Claude", "READY · usage unknown");
    const goText = open?.go?.windows?.length
      ? open.go.windows.map((window) => `${shortWindowName(window.name)} ${window.remainingPercent}%${window.status === "rate-limited" ? " RATE LIMITED" : ""}`).join(" · ")
      : "usage unknown";
    const zen = open?.zen;
    const zenText = zen?.status === "local_recorded"
      ? `PAYG/manual · 7d local $${zen.totalCost.toFixed(2)} · ${compactNumber(zen.totalTokens)}`
      : "PAYG/manual · 7d local unknown";
    return [
      `Codex    ${codexText}`,
      `Claude   ${claudeText}`,
      `Go       ${goText}`,
      `Zen      ${zenText}`,
      `Cursor   ${entry("Cursor", "READY · usage unknown")}`
    ];
  }

  integrationsLine() {
    const integrations = this.snapshot?.integrations ?? {};
    const state = (name, fallback) => integrations[name]?.status ?? integrations[name]?.state ?? fallback;
    return [
      `Engram ${state("engram", "available")}`,
      `MCP ${state("mcp", "available")}`,
      `Skills ${state("skills", "available")}`,
      `CodeGraph ${state("codegraph", "unknown")}`,
      `Graphify ${state("graphify", "unknown")}`,
      `Gentle ${state("gentle", "policy active")}`
    ].join("   ");
  }

  /**
   * `/usage`: real automatic-routing resources only (Codex, Claude, Go).
   * Zen is explicitly PAYG/manual, never part of Kairo's automatic
   * resource pool — showing it here would misleadingly suggest it's on
   * the same footing as the automatic providers; it stays in
   * `/providers`, clearly labeled.
   */
  usageLines() {
    const usage = this.snapshot?.usage ?? {};
    const lines = [];
    const codex = usage.codex;
    lines.push(codex?.windows?.length
      ? `Codex ${codex.windows.map((window) => `${window.name} ${window.remainingPercent}% left${quotaWarnSuffix(window.remainingPercent)}${window.resetsAtIso ? ` reset ${window.resetsAtIso}` : ""}`).join(" · ")} · source: ${codex.source ?? "measured"}`
      : "Codex usage unknown · source: Codex app-server · no quota fabricated");
    const claude = usage.claude;
    lines.push(claude?.windows?.length
      ? `Claude ${claude.windows.map((window) => `${window.label ?? window.name} ${window.remainingPercent}% left${quotaWarnSuffix(window.remainingPercent)}`).join(" · ")} · source: ${claude.source ?? "measured"}`
      : "Claude usage unknown · no quota fabricated");
    const go = usage.opencode?.go;
    lines.push(go?.windows?.length
      ? `Go ${go.windows.map((window) => {
        const limited = window.status === "rate-limited";
        return `${shortWindowName(window.name)} ${window.remainingPercent}%${limited ? " RATE LIMITED" : quotaWarnSuffix(window.remainingPercent)}`;
      }).join(" · ")} · source: ${go.source ?? "measured"}`
      : "Go usage unknown · source unavailable");
    return lines;
  }

  renderDetail(width) {
    const lines = [];
    lines.push(cardTop(`Plan: ${this.detailTaskId ?? ""}`, CARD_TONE.INFO, theme, width));
    for (const line of String(this.detailText).split("\n")) {
      lines.push(cardLine(line, CARD_TONE.INFO, theme, width));
    }
    lines.push(cardLine("", CARD_TONE.INFO, theme, width));
    lines.push(cardLine(theme.fg("muted", "esc/q back to list"), CARD_TONE.INFO, theme, width));
    lines.push(cardBottom(CARD_TONE.INFO, theme, width));
    return lines;
  }
}

function shortWindowName(name) {
  return { rolling: "roll", weekly: "week", monthly: "month" }[name] ?? name;
}
