import { matchesKey, Key, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { buildTaskRows, clampSelection, isActionAvailable } from "./rows.js";
import { CARD_TONE, cardBottom, cardInnerWidth, cardLine, cardTop } from "./card.js";
import { theme } from "./theme.js";

/**
 * Frames raw content lines into one bordered card. Content is padded to
 * `targetLineCount` (when given) *before* framing, so two panels tiled
 * side by side reach the same row and their borders stay a clean line.
 * @param {string} title
 * @param {string} tone
 * @param {number} width
 * @param {string[]} contentLines
 * @param {number} [targetLineCount]
 */
function renderPanel(title, tone, width, contentLines, targetLineCount = contentLines.length) {
  const padded = Array.from({ length: targetLineCount }, (_, i) => contentLines[i] ?? "");
  const lines = [cardTop(title, tone, theme, width)];
  for (const line of padded) lines.push(cardLine(line, tone, theme, width));
  lines.push(cardBottom(tone, theme, width));
  return lines;
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
  /**
   * @param {object} deps
   * @param {object} deps.actions
   * @param {(taskId: string) => void} deps.actions.onShowPlan
   * @param {(taskId: string) => void} deps.actions.onApprove
   * @param {(taskId: string) => void} deps.actions.onReject
   * @param {(taskId: string) => void} deps.actions.onRequestExecute - asks for the real routing
   *   decision (via service.planExecution) before showing the confirm prompt
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
    this.mode = "list"; // "list" | "detail" | "confirm-execute" — UI screen, never confused with workMode below
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
    this.snapshot = null;
    this.transcript = [];
    this.executeDecision = null;
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

    if (this.mode === "detail") {
      this.handleDetailInput(data);
      return;
    }

    this.handleListInput(data);
  }

  handleConfirmInput(data) {
    const row = this.selectedRow();
    if (data === "y" || data === "Y") {
      // Only a real ROUTED decision (or none fetched yet — the plain
      // fallback prompt) can be confirmed; a WAIT_FOR_APPROVAL/
      // NO_PROVIDER_AVAILABLE decision blocks 'y' rather than launching
      // something the router itself said not to.
      if (this.executeDecision && this.executeDecision.decision !== "ROUTED") return;
      const decision = this.executeDecision;
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
      this.actions.onRequestExecute(row.taskId);
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
    if (decision.decision !== "ROUTED") {
      return [
        theme.fg("error", `Cannot auto-execute "${row?.taskId ?? ""}"`),
        theme.fg("muted", decision.why ?? "no provider available"),
        theme.fg("muted", "(n/esc to go back)")
      ];
    }
    const model = decision.model ?? "default";
    return [
      theme.fg("warning", `Execute "${row?.taskId ?? ""}" with ${decision.provider} · ${model}? (y/n)`),
      theme.fg("muted", `Why: ${decision.why}`)
    ];
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
   * (strategy.activeRoles/qualityTeam — see buildProjectStrategy), never
   * the full global 7-role list.
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
      return { title: `PROJECT ANALYSIS · ${project} — Select Bootstrap Analyst`, lines };
    }
    if (!strategy) {
      return {
        title: "GLOBAL MODEL GUIDE",
        lines: [theme.fg("warning", `Project ${project} not analyzed — use /project analyze for a real, project-specific team.`), ...this.teamsColumnsLines(width)]
      };
    }
    const lines = [];
    if (strategy.bootstrapAnalyst) lines.push(`${"Bootstrap Analyst".padEnd(18)} ${this.aiTeamLabel(strategy.bootstrapAnalyst)}`);
    if (strategy.orchestrator) lines.push(`${"Orchestrator".padEnd(18)} ${this.aiTeamLabel(strategy.orchestrator)}`);
    for (const entry of strategy.qualityTeam ?? []) {
      lines.push(`${entry.role.padEnd(18)} ${entry.model ? this.aiTeamLabel(entry.model) : theme.fg("warning", "no eligible option")}`);
    }
    if (strategy.status === "suggested") lines.push(theme.fg("muted", "Suggested from real project analysis. Use /project approve to activate."));
    if (strategy.status === "stale") lines.push(theme.fg("warning", "Real evidence changed since approval — use /project refresh."));
    return { title: `PROJECT TEAM · ${project} · ${strategy.status.toUpperCase()}`, lines };
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
    if (this.mode !== "confirm-execute" && this.transcript.length === 0 && !this.statusMessage) {
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
    if (this.statusMessage) {
      lines.push("");
      lines.push(theme.fg("accent", this.statusMessage));
    }
    if (this.mode === "confirm-execute") {
      lines.push("");
      lines.push(...this.confirmPromptLines(this.selectedRow()));
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

/** Plain-language description of what each role optimizes for — mirrors
   * buildAiTeamRoleDefinitions()'s real compute functions in
   * model-intelligence.js, never a per-model claim, so it never needs
   * updating when the underlying models change. */
  static ROLE_CAPABILITY_BLURB = {
    Explorer: "general reasoning capability",
    Architect: "general reasoning capability",
    Builder: "coding capability",
    Debugger: "reasoning and terminal-debugging capability",
    Tester: "coding and terminal-execution capability",
    Reviewer: "independent reasoning and coding review"
  };

  /**
   * The default, human-readable `/models` output: per role, the selected
   * model, why (the real distribution-policy reason when there is one,
   * else the role's plain-language capability requirement), the
   * EFFICIENT TEAM alternative when it actually differs, and the real
   * fallback used if the selection becomes unavailable. Deliberately no
   * raw metrics, percentages, internal ids, or source names — that detail
   * moves to /models --evidence (aiTeamDetailLines()) instead.
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
    aiTeam.forEach(({ role, primary, fallback, reason }, index) => {
      // A blank string here would get silently dropped once routed through
      // the persisted chat transcript (addTranscript trims and discards
      // empty text) — a visible divider is the only separator that
      // actually survives into the real, persisted chat history.
      if (index > 0) lines.push(theme.fg("muted", "·"));
      const availabilityNote = primary.available ? "" : " (currently unavailable)";
      lines.push(`${role.padEnd(10)} ${this.aiTeamLabel(primary)}${availabilityNote}`);
      const why = reason ?? `Selected for ${CockpitView.ROLE_CAPABILITY_BLURB[role] ?? "this role's capability requirement"}.`;
      lines.push(theme.fg("muted", `  ${why}`));

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
   * real coverage/confidence (RoleEvaluation — how much of the role's
   * relevant capabilities actually had evidence, and how trustworthy that
   * evidence is), the distribution-policy reason, and any real
   * corroborating evidence the Model Intelligence Foundation registry has
   * for that exact model. Shared by AI TEAM and EFFICIENT TEAM inside
   * aiTeamDetailLines(); never called on its own.
   * @param {Array<object>} team
   */
  teamEvidenceLines(team) {
    const lines = [];
    const corroborationLine = (model) => (model.corroboration ?? [])
      .map((entry) => `${entry.metric}=${entry.value} (${entry.source})`)
      .join(" · ");
    team.forEach(({ role, primary, fallback, reason, coverage, confidence }, index) => {
      // A blank string here would get silently dropped once this line is
      // routed through the persisted chat transcript (addTranscript trims
      // and discards empty text) — a visible divider is the only separator
      // that actually survives into the real, persisted chat history.
      if (index > 0) lines.push(theme.fg("muted", "·"));
      const primaryLabel = this.aiTeamLabelWithProvider(primary);
      const primaryText = primary.available ? primaryLabel : `${primaryLabel} (not available)`;
      lines.push(`${role.padEnd(10)} ${primaryText}`);
      if (coverage != null) {
        const coveragePercent = Math.round(coverage * 100);
        const coverageTone = coveragePercent < 100 ? "warning" : "muted";
        lines.push(theme.fg(coverageTone, `  coverage: ${coveragePercent}% of relevant capabilities scored · confidence: ${confidence ?? "unknown"}`));
      }
      const primaryEvidence = corroborationLine(primary);
      if (primaryEvidence) lines.push(theme.fg("muted", `  also: ${primaryEvidence}`));
      if (fallback) lines.push(theme.fg("muted", `  fallback ${this.aiTeamLabelWithProvider(fallback)}`));
      else if (!primary.available) lines.push(theme.fg("warning", "  no eligible fallback right now"));
      if (reason) lines.push(theme.fg("muted", `  ${reason}`));
    });
    return lines;
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
    if (this.mode !== "confirm-execute" && this.transcript.length === 0 && !this.statusMessage) {
      return [
        theme.fg("muted", "Ask Kairo about this project, or describe work to plan."),
        "",
        theme.fg("muted", "Use /help to see commands.")
      ];
    }
    const lines = [];
    // The execute confirmation (y/n) is a real pending decision, not status
    // chrome — it belongs in the dominant chat surface, not a separate
    // widget that could be scrolled past or removed.
    if (this.mode === "confirm-execute") {
      lines.push(...this.confirmPromptLines(this.selectedRow()));
      lines.push("");
    }
    if (this.statusMessage) {
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
      ? `Codex 5h ${codex.primary.remainingPercent}%${codex.secondary ? ` / W ${codex.secondary.remainingPercent}%` : ""}`
      : `Codex ${status("Codex") ?? "usage unknown"}`;

    const claude = usage.claude;
    const claudeText = claude?.primary
      ? `Claude S ${claude.primary.remainingPercent}%${claude.secondary ? ` / W ${claude.secondary.remainingPercent}%` : ""}`
      : `Claude ${status("Claude") ?? "usage unknown"}`;

    const go = usage.opencode?.go;
    const goText = go?.windows?.length
      ? `Go ${go.windows.map((window) => `${window.remainingPercent}%${window.status === "rate-limited" ? " LIMITED" : ""}`).join(" / ")}`
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
      `Cursor   ${entry("Cursor", "MANUAL · usage unknown")}`
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
      ? `Codex ${codex.windows.map((window) => `${window.name} ${window.remainingPercent}% left${window.resetsAtIso ? ` reset ${window.resetsAtIso}` : ""}`).join(" · ")} · source: ${codex.source ?? "measured"}`
      : "Codex usage unknown · source: Codex app-server · no quota fabricated");
    const claude = usage.claude;
    lines.push(claude?.windows?.length
      ? `Claude ${claude.windows.map((window) => `${window.label ?? window.name} ${window.remainingPercent}% left`).join(" · ")} · source: ${claude.source ?? "measured"}`
      : "Claude usage unknown · no quota fabricated");
    const go = usage.opencode?.go;
    lines.push(go?.windows?.length
      ? `Go ${go.windows.map((window) => `${shortWindowName(window.name)} ${window.remainingPercent}%${window.status === "rate-limited" ? " RATE LIMITED" : ""}`).join(" · ")} · source: ${go.source ?? "measured"}`
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
