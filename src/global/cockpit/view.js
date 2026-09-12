import { matchesKey, Key, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { buildTaskRows, clampSelection, isActionAvailable } from "./rows.js";
import { CARD_TONE, cardBottom, cardLine, cardTop } from "./card.js";
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

/**
 * Tiles two independently-framed cards side by side — used only for
 * USAGE + FIT, the two reference widgets meant to be compared at a
 * glance rather than read one above the other.
 * @param {{title: string, tone: string, lines: string[]}} left
 * @param {{title: string, tone: string, lines: string[]}} right
 * @param {number} totalWidth
 */
function tileTwoPanels(left, right, totalWidth) {
  const gap = 1;
  const leftWidth = Math.floor((totalWidth - gap) / 2);
  const rightWidth = totalWidth - gap - leftWidth;
  const targetLineCount = Math.max(left.lines.length, right.lines.length);
  const leftBox = renderPanel(left.title, left.tone, leftWidth, left.lines, targetLineCount);
  const rightBox = renderPanel(right.title, right.tone, rightWidth, right.lines, targetLineCount);
  const rows = [];
  for (let i = 0; i < leftBox.length; i += 1) rows.push(`${leftBox[i]}${" ".repeat(gap)}${rightBox[i]}`);
  return rows;
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
    this.mode = "list"; // "list" | "detail" | "confirm-execute"
    this.detailTaskId = null;
    this.detailText = "";
    this.statusMessage = "";
    this.snapshot = null;
    this.transcript = [];
    this.executeDecision = null;
    // Set by app.js's focus toggling — the "a approve · j reject ·
    // x implement" hint is only true while the list actually has focus;
    // with the composer focused those same letters just become message
    // text instead of triggering an action.
    this.hasListFocus = false;
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
    this.transcript.push({ role: role === "user" ? "You" : "Kairo", text: value });
    // A generous safety cap, not a display constraint — what actually shows
    // on screen is decided per-render by the real viewport budget
    // (see chatLines()), not by how much history this array retains.
    if (this.transcript.length > 500) this.transcript.shift();
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
      .map((entry) => ({ role: entry.role === "user" ? "You" : "Kairo", text: String(entry.text ?? "").trim() }))
      .filter((entry) => entry.text)
      .slice(-500);
    this.requestRender();
  }

  clearTranscript() {
    this.transcript = [];
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

    if (data === "a" && isActionAvailable("approve", row)) { this.actions.onApprove(row.taskId); return; }
    if (data === "j" && isActionAvailable("reject", row)) { this.actions.onReject(row.taskId); return; }
    if (data === "c" && isActionAvailable("cancel", row)) { this.actions.onCancel(row.taskId); return; }
    if (data === "x" && isActionAvailable("execute", row)) {
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
   * Conversation-first workspace, framed like the rest of the cockpit
   * (rounded cards, per-line tone) instead of plain padded text — a compact
   * usage card up top, the transcript/workflow card owning the rest of the
   * screen, and key hints as a plain footer beneath both.
   */
  renderWorkspace(width) {
    const project = this.snapshot?.projectRoot?.split("/").filter(Boolean).pop() ?? "current project";
    const lines = [];

    // USAGE and FIT are both reference widgets meant to be scanned
    // together, so side by side when there's room; narrow terminals fall
    // back to stacking (a half-width card below ~50 cols truncates into
    // illegibility). FIT is always visible, independent of task selection
    // — separate from STATUS (task-specific), which is only reachable
    // while a row is selected, and once any task exists in history a row
    // is *always* selected, so it can't be tucked behind "nothing else to
    // show" the way STATUS's own content is.
    const usagePanel = { title: `KAIRO · ${project}`, tone: CARD_TONE.INFO, lines: [theme.fg("muted", "USAGE"), ...this.compactHealthLines()] };
    const fitPanel = { title: "FIT", tone: CARD_TONE.SUCCESS, lines: this.fitLines() };
    // FIT's longest real line ("Planning / Architecture  Claude · Claude
    // Fable 5.1") needs ~50 visible columns plus framing on each side —
    // below this threshold, tiling would truncate the very info being
    // shown, so it falls back to full-width stacking instead.
    if (width >= 140) {
      lines.push(...tileTwoPanels(usagePanel, fitPanel, width));
    } else {
      lines.push(...renderPanel(usagePanel.title, usagePanel.tone, width, usagePanel.lines));
      lines.push(...renderPanel(fitPanel.title, fitPanel.tone, width, fitPanel.lines));
    }

    const row = this.selectedRow();
    const footerLines = [theme.fg("muted", "Enter send · /help · /usage · q quit")];
    if (row) {
      footerLines.push(theme.fg("muted", this.hasListFocus
        ? "Plan controls: Enter open · a approve · j reject · x implement"
        : "Tab for plan controls (approve/reject/implement) — typing here just sends a message"));
    }

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
   * Which real available model is best for which real job, in plain task-
   * role language ("Planning / Architecture", "Coding", "Quick & cheap
   * tasks") — no numbers, no percentages, no invented composite score.
   * Each role is backed by exactly one real Artificial Analysis metric
   * (see intelligence/model-intelligence.js's bestModelPerRole); a role
   * with no real winner among your available models is simply omitted,
   * never guessed.
   */
  fitLines() {
    const intel = this.snapshot?.modelIntelligence;
    if (!intel || intel.status === "unknown") {
      const reason = intel?.error ? ` (${intel.error})` : "";
      return [theme.fg("muted", `No model benchmark data yet${reason}`)];
    }
    if (!intel.roles?.length) {
      // Real data exists, but no provider survived the eligibility check
      // (availability/launchability/quota) — show the real reason each one
      // was rejected instead of silently showing nothing or a fake winner.
      const reasons = Object.entries(intel.eligibility ?? {})
        .filter(([, check]) => !check.ok)
        .map(([adapterId, check]) => `${adapterId}: ${check.reason}`);
      return [theme.fg("warning", "No eligible provider right now"), ...reasons.map((r) => theme.fg("muted", r))];
    }
    const freshness = intel.status === "live" ? "live" : `cached ${intel.age ?? "?"}`;
    const lines = [theme.fg("muted", `Artificial Analysis, ${freshness}`)];
    // Several roles share the same real metric today (Explorer reuses
    // Architect/Planner's intelligence signal, Test Author reuses
    // Implementer's coding signal, etc. — see model-intelligence.js), so
    // they often land on the same winner. Showing that as N separate rows
    // would misleadingly imply N independent judgments; grouping the roles
    // that share one real winner shows the actual number of distinct
    // conclusions instead.
    const groups = [];
    for (const entry of intel.roles) {
      const key = `${entry.adapterId}::${entry.modelId}`;
      let group = groups.find((g) => g.key === key);
      if (!group) { group = { key, adapterId: entry.adapterId, displayName: entry.displayName, modelId: entry.modelId, roles: [] }; groups.push(group); }
      group.roles.push(entry.role);
    }
    for (const group of groups) {
      const provider = group.adapterId.charAt(0).toUpperCase() + group.adapterId.slice(1);
      lines.push(group.roles.join(", "));
      lines.push(`  → ${provider} · ${group.displayName ?? group.modelId}`);
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
   * One compact line per provider Kairo actually routes to (Codex, Claude,
   * OpenCode Go, OpenCode Zen) — no bars, no idle "cards", just real
   * measured numbers or the honest "usage unknown" fallback. Cursor is
   * deliberately excluded here: it's manual-only with no verifiable usage
   * source today, so it stays in `/providers` instead of implying it's an
   * automatic worker.
   */
  compactHealthLines() {
    const usage = this.snapshot?.usage ?? {};
    const providers = this.snapshot?.providers ?? {};
    const status = (name) => providers[name]?.status ?? providers[name.toLowerCase()]?.status;

    const codex = usage.codex;
    const codexText = codex?.primary
      ? `5h ${codex.primary.remainingPercent}%${codex.secondary ? ` · W ${codex.secondary.remainingPercent}%` : ""}`
      : (status("Codex") ?? "usage unknown");

    const claude = usage.claude;
    const claudeText = claude?.primary
      ? `S ${claude.primary.remainingPercent}%${claude.secondary ? ` · W ${claude.secondary.remainingPercent}%` : ""}`
      : (status("Claude") ?? "usage unknown");

    const go = usage.opencode?.go;

    const zen = usage.opencode?.zen;
    const lines = [
      theme.fg("muted", `Codex   ${codexText}`),
      theme.fg("muted", `Claude  ${claudeText}`)
    ];
    if (go?.windows?.length) {
      go.windows.forEach((window, index) => {
        const label = index === 0 ? "Go      " : "        ";
        lines.push(theme.fg("muted", `${label}${shortWindowName(window.name)} ${window.remainingPercent}%${window.status === "rate-limited" ? " LIMITED" : ""}`));
      });
    } else {
      lines.push(theme.fg("muted", `Go      ${status("OpenCode") ?? "usage unknown"}`));
    }
    lines.push(theme.fg("muted", zen?.status === "local_recorded"
      ? `Zen     $${zen.totalCost.toFixed(2)} local / 7d`
      : "Zen     local activity unknown"));
    return lines;
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
      ? `7d local $${zen.totalCost.toFixed(2)} · ${compactNumber(zen.totalTokens)}`
      : "7d local unknown";
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
    const open = usage.opencode;
    const go = open?.go;
    lines.push(go?.windows?.length
      ? `Go ${go.windows.map((window) => `${shortWindowName(window.name)} ${window.remainingPercent}%${window.status === "rate-limited" ? " RATE LIMITED" : ""}`).join(" · ")} · source: ${go.source ?? "measured"}`
      : "Go usage unknown · source unavailable");
    const zen = open?.zen;
    lines.push(zen?.status === "local_recorded"
      ? `Zen 7d local $${zen.totalCost.toFixed(2)} · ${compactNumber(zen.totalTokens)} tokens`
      : "Zen 7d local unknown");
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
