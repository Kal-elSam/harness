import { matchesKey, Key, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  buildTaskRows, clampSelection, derivePhase, formatRowText, headerLine, isActionAvailable, keyHintsLine, rowTone
} from "./rows.js";
import { CARD_TONE, cardBottom, cardInnerWidth, cardLine, cardTop } from "./card.js";
import { theme } from "./theme.js";

// Below this width tiled panels have no room to breathe — fall back to the
// single stacked column instead of truncating everything into illegibility.
const MIN_WORKSPACE_WIDTH = 100;
const PANEL_GAP = " ";

function padVisible(text, width) {
  const clipped = truncateToWidth(text ?? "", width, "…");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/**
 * Builds one fully-framed panel (own top/bottom border, own title) — the
 * lazygit/herdr-style look of several independent bordered widgets, rather
 * than one shared card with internal column dividers.
 * @param {string} title
 * @param {string} tone
 * @param {number} width - full panel width, border included
 * @param {string[]} contentLines
 */
function renderPanel(title, tone, width, contentLines) {
  const lines = [cardTop(title, tone, theme, width)];
  for (const line of contentLines) lines.push(cardLine(line, tone, theme, width));
  lines.push(cardBottom(tone, theme, width));
  return lines;
}

/**
 * Tiles fully-framed panels side by side. Content is padded to the tallest
 * panel's line count *before* framing, so every panel's border reaches the
 * same row and the seam between panels stays a clean straight line.
 * @param {Array<{title: string, tone: string, width: number, lines: string[]}>} panels
 */
function tilePanels(panels) {
  const maxContentLines = Math.max(...panels.map((panel) => panel.lines.length));
  const boxes = panels.map((panel) => renderPanel(
    panel.title, panel.tone, panel.width,
    Array.from({ length: maxContentLines }, (_, i) => panel.lines[i] ?? "")
  ));
  const rows = [];
  for (let i = 0; i < boxes[0].length; i += 1) {
    rows.push(boxes.map((box) => box[i]).join(PANEL_GAP));
  }
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
   */
  constructor({ actions, requestRender = () => {} }) {
    this.actions = actions;
    this.requestRender = requestRender;
    this.rows = [];
    this.selectedIndex = 0;
    this.mode = "list"; // "list" | "detail" | "confirm-execute"
    this.detailTaskId = null;
    this.detailText = "";
    this.statusMessage = "";
    this.snapshot = null;
    this.transcript = [];
    this.modeName = "BALANCED";
    this.executeDecision = null;
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
    this.modeName = snapshot?.mode ?? snapshot?.policy?.mode ?? "BALANCED";
    this.requestRender();
  }

  /** Add a short, user-visible event without retaining provider transcripts. */
  addTranscript(role, text) {
    const value = String(text ?? "").trim();
    if (!value) return;
    this.transcript.push({ role: role === "user" ? "You" : "Kairo", text: value });
    if (this.transcript.length > 8) this.transcript.shift();
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
    if (width < MIN_WORKSPACE_WIDTH) {
      if (this.mode === "detail") return this.renderDetail(width);
      return this.renderList(width, { confirming: this.mode === "confirm-execute" });
    }
    return this.renderWorkspace(width);
  }

  /**
   * Tiled independently-bordered panels — TASKS | WORKSPACE (conversation/
   * plan/prompt) | AGENTS (usage gauges + integrations) — styled after
   * real multi-pane terminal dashboards (lazygit/herdr-style widgets)
   * rather than one shared card with internal column dividers. The layout
   * stays visible across list/detail/confirm-execute so context (which
   * task, which agents) never disappears behind a full-screen mode switch.
   */
  renderWorkspace(width) {
    const project = this.snapshot?.projectRoot?.split("/").filter(Boolean).pop() ?? "current project";
    const gapWidth = visibleWidth(PANEL_GAP) * 2;
    const usable = Math.max(30, width - gapWidth);
    const leftWidth = Math.max(20, Math.floor(usable * 0.24));
    const rightWidth = Math.max(28, Math.floor(usable * 0.34));
    const centerWidth = Math.max(24, usable - leftWidth - rightWidth);

    const lines = [];
    lines.push(`${theme.fg("accent", "✿ KAIRO")}${theme.fg("muted", ` · ${project} · ${this.modeName}`)}`);
    lines.push("");
    lines.push(...tilePanels([
      { title: "TASKS", tone: CARD_TONE.INFO, width: leftWidth, lines: this.leftColumnLines(cardInnerWidth(leftWidth)) },
      { title: this.mode === "detail" ? "PLAN" : "TASK", tone: CARD_TONE.INFO, width: centerWidth, lines: this.centerColumnLines() },
      { title: "AGENTS", tone: CARD_TONE.INFO, width: rightWidth, lines: this.rightColumnLines() }
    ]));
    lines.push("");
    lines.push(theme.fg("muted", "Enter send · Tab focus · /help commands · /usage status · q quit"));
    lines.push(theme.fg("muted", keyHintsLine(this.selectedRow())));
    return lines;
  }

  /** @param {number} innerWidth - the TASKS panel's inner content width, for a full-width selection highlight */
  leftColumnLines(innerWidth) {
    const lines = [theme.bold("TASKS"), ""];
    if (this.rows.length === 0) {
      lines.push(theme.fg("muted", "(no plans yet)"));
    } else {
      this.rows.forEach((row, index) => {
        const selected = index === this.selectedIndex;
        const bullet = theme.fg(rowTone(row), "●");
        const plain = `${bullet} ${row.taskId}`;
        lines.push(selected ? theme.bg("selection", padVisible(plain, innerWidth)) : plain);
      });
    }
    return lines;
  }

  centerColumnLines() {
    if (this.mode === "detail") {
      return [theme.bold(`Plan: ${this.detailTaskId ?? ""}`), "", ...String(this.detailText).split("\n")];
    }
    const row = this.selectedRow();
    const lines = [];
    if (!row) {
      lines.push(theme.fg("muted", "No active task — type one below and press Enter."));
    } else {
      lines.push(theme.bold(row.taskId));
      lines.push("");
      lines.push(theme.fg("muted", "PHASE"));
      lines.push(theme.fg(rowTone(row), derivePhase(row)));
      lines.push("");
      lines.push(theme.fg("muted", "SELECTED"));
      lines.push(this.selectedProviderLine(row));
    }
    lines.push("");
    if (this.mode === "confirm-execute") {
      lines.push(...this.confirmPromptLines(row));
    } else if (this.statusMessage) {
      lines.push(theme.fg("accent", this.statusMessage));
    }
    if (this.transcript.length > 0) {
      lines.push("");
      for (const entry of this.transcript.slice(-4)) {
        const prefix = entry.role === "You" ? theme.fg("accent", "> ") : theme.fg("info", "Kairo ");
        lines.push(`${prefix}${entry.text}`);
      }
    }
    return lines;
  }

  /**
   * Real provider/model recorded for this row: the plan's real
   * `planProvider` while it's still just a plan, or the real `execProvider`
   * once a run has actually started — never the router's *pending*
   * recommendation, which only exists as a preview inside a confirm-execute
   * prompt (see confirmPromptLines/executeDecision). Shows "<Provider>
   * default" when no explicit model was requested, per the same
   * never-invent-a-model rule the usage probes follow.
   */
  selectedProviderLine(row) {
    const executing = row.execState !== "not_started" && row.execProvider;
    const providerId = executing ? row.execProvider : row.planProvider;
    if (!providerId) return theme.fg("muted", "unknown");
    const label = providerId.charAt(0).toUpperCase() + providerId.slice(1);
    const modelText = !executing && row.planModel ? row.planModel : "default";
    return `${label} · ${modelText}`;
  }

  rightColumnLines() {
    const lines = [theme.bold("ACTIVITY"), ""];
    lines.push(...this.activityLines());
    lines.push("");
    lines.push(theme.bold("HEALTH"));
    lines.push(...this.compactHealthLines());
    return lines;
  }

  /** What's actually running right now for the selected task, or "Idle" — never a fabricated file/step count. */
  activityLines() {
    const row = this.selectedRow();
    if (row?.execActive) {
      const provider = row.execProvider ? row.execProvider.charAt(0).toUpperCase() + row.execProvider.slice(1) : "Agent";
      return [
        `${theme.fg("warning", "●")} ${provider}`,
        theme.fg("muted", row.execMessage ?? "Working…")
      ];
    }
    return [theme.fg("muted", "Idle — no active run")];
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
      ? `${codex.primary.name ?? "5h"} ${codex.primary.remainingPercent}%${codex.secondary ? ` · ${codex.secondary.name ?? "week"} ${codex.secondary.remainingPercent}%` : ""}`
      : (status("Codex") ?? "usage unknown");

    const claude = usage.claude;
    const claudeText = claude?.primary
      ? `${claude.primary.label ?? "session"} ${claude.primary.remainingPercent}%${claude.secondary ? ` · ${claude.secondary.label ?? "week"} ${claude.secondary.remainingPercent}%` : ""}`
      : (status("Claude") ?? "usage unknown");

    const go = usage.opencode?.go;
    const goText = go?.windows?.length
      ? go.windows.map((window) => `${shortWindowName(window.name)} ${window.remainingPercent}%${window.status === "rate-limited" ? " LIMITED" : ""}`).join(" · ")
      : (status("OpenCode") ?? "usage unknown");

    const zen = usage.opencode?.zen;
    const zenText = zen?.status === "local_recorded"
      ? `$${zen.totalCost.toFixed(2)} local/7d · PAYG blocked`
      : "local activity unknown · PAYG blocked";

    return [
      theme.fg("muted", `Codex   ${codexText}`),
      theme.fg("muted", `Claude  ${claudeText}`),
      theme.fg("muted", `Go      ${goText}`),
      theme.fg("muted", `Zen     ${zenText}`)
    ];
  }

  renderList(width, { confirming }) {
    const lines = [];
    const project = this.snapshot?.projectRoot?.split("/").filter(Boolean).pop() ?? "current project";
    lines.push(cardTop(`KAIRO · ${project} · ${this.modeName}`, CARD_TONE.INFO, theme, width));
    for (const providerLine of this.providerLines()) {
      lines.push(cardLine(theme.fg("muted", providerLine), CARD_TONE.INFO, theme, width));
    }
    lines.push(cardLine(theme.fg("muted", this.integrationsLine()), CARD_TONE.INFO, theme, width));
    lines.push(cardLine("", CARD_TONE.INFO, theme, width));
    if (this.transcript.length > 0) {
      // Keep a complete /usage response visible: Codex, Claude, Go, Zen, and
      // the integrations summary currently occupy five transcript entries.
      for (const entry of this.transcript.slice(-8)) {
        const prefix = entry.role === "You" ? theme.fg("accent", "> ") : theme.fg("info", "Kairo ");
        lines.push(cardLine(`${prefix}${entry.text}`, CARD_TONE.INFO, theme, width));
      }
      lines.push(cardLine("", CARD_TONE.INFO, theme, width));
    }
    lines.push(cardLine(theme.bold("PLANS / EXECUTIONS"), CARD_TONE.INFO, theme, width));
    lines.push(cardLine(theme.bold(headerLine()), CARD_TONE.INFO, theme, width));
    if (this.rows.length === 0) {
      lines.push(cardLine(theme.fg("muted", "(no plans yet for this project)"), CARD_TONE.INFO, theme, width));
    } else {
      this.rows.forEach((row, index) => {
        const selected = index === this.selectedIndex;
        const text = formatRowText(row, { selected });
        lines.push(cardLine(selected ? theme.bold(text) : text, rowTone(row), theme, width));
      });
    }
    lines.push(cardLine("", CARD_TONE.INFO, theme, width));
    if (confirming) {
      const row = this.selectedRow();
      for (const line of this.confirmPromptLines(row)) {
        lines.push(cardLine(line, CARD_TONE.WARNING, theme, width));
      }
    } else if (this.statusMessage) {
      lines.push(cardLine(theme.fg("accent", this.statusMessage), CARD_TONE.INFO, theme, width));
    }
    lines.push(cardLine(theme.fg("muted", "Enter send · Tab focus · /help commands · /usage status · q quit"), CARD_TONE.INFO, theme, width));
    lines.push(cardLine(theme.fg("muted", keyHintsLine(this.selectedRow())), CARD_TONE.INFO, theme, width));
    lines.push(cardBottom(CARD_TONE.INFO, theme, width));
    return lines;
  }

  providerLine() {
    return this.providerLines().join("   ");
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
      ? `7d local $${zen.totalCost.toFixed(2)} · ${compactNumber(zen.totalTokens)} · balance unknown · PAYG blocked`
      : "7d local unknown · balance unknown · PAYG blocked";
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

  usageLine() {
    const usage = this.snapshot?.usage?.codex;
    if (!usage || usage.status === "unknown") {
      return "Codex usage unknown · source: Codex app-server · no quota fabricated";
    }
    const windows = (usage.windows ?? []).map((window) => {
      const resetValue = window.resetsAtIso ?? window.resetsAt;
      const reset = resetValue ? ` reset ${resetValue}` : " reset unknown";
      return `${window.name} ${window.remainingPercent}% left${reset}`;
    });
    return `Codex ${windows.join(" · ")} · source: ${usage.source ?? "measured"}`;
  }

  openCodeUsageLine() {
    const usage = this.snapshot?.usage?.opencode;
    if (!usage) return "OpenCode usage unknown · Go/Zen source unavailable · PAYG blocked";
    const go = usage.go;
    const zen = usage.zen;
    const goText = go?.windows?.length
      ? go.windows.map((window) => `${window.name} ${window.remainingPercent}% left${window.resetsAt ? ` reset ${window.resetsAt}` : ""}`).join(" · ")
      : "Go usage unknown";
    const zenText = zen?.status === "local_recorded"
      ? `Zen 7d local recorded $${zen.totalCost.toFixed(2)} / ${zen.totalTokens} tokens`
      : "Zen balance unknown";
    return `OpenCode ${goText} · ${zenText} · source: ${go?.source ?? zen?.source ?? "unknown"} · PAYG blocked`;
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
      ? `Zen 7d local ${zen.totalCost.toFixed(2)} · ${compactNumber(zen.totalTokens)} tokens · balance unknown · PAYG blocked`
      : "Zen 7d local unknown · balance unknown · auto-reload unknown · PAYG blocked");
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
