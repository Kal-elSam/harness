import { Box, SelectList, Text, Key, matchesKey } from "@earendil-works/pi-tui";
import { editorTheme, theme } from "./theme.js";

// /project's interactive overlay — the real preflight -> select analyst ->
// confirm -> analyze -> result -> approve loop, reusing the exact same
// service functions the plain-text /project subcommands already use
// (preflightProject, runBootstrapAnalysis, approveProjectStrategy,
// refreshProjectStrategy). No new persistence, no new ProjectStrategy
// schema — this is a different way to drive the same real state machine,
// never a parallel one. The plain-text subcommands (/project status|
// analyze|analyst|approve|refresh) keep working unchanged; this overlay is
// what bare `/project` (no subcommand) now opens.

export const PROJECT_OVERLAY_STATE = {
  LOADING_PREFLIGHT: "loading-preflight",
  NO_ANALYST: "no-analyst",
  SELECT_ANALYST: "select-analyst",
  CONFIRM_ANALYST: "confirm-analyst",
  ANALYZING: "analyzing",
  RESULT: "result",
  APPROVING: "approving",
  REFRESHING: "refreshing",
  ACTIVE: "active",
  STALE: "stale",
  ERROR: "error"
};

const S = PROJECT_OVERLAY_STATE;

function teamLines(label, team, aiTeamLabel) {
  const lines = [theme.bold(label)];
  if (!team?.length) {
    lines.push(theme.fg("muted", "  (no active roles)"));
    return lines;
  }
  for (const entry of team) {
    const modelText = entry.model ? aiTeamLabel(entry.model) : theme.fg("warning", "no eligible option");
    lines.push(`  ${entry.role.padEnd(10)} ${modelText}`);
  }
  return lines;
}

/**
 * A pi-tui Component implementing /project's interactive overlay. State is
 * driven entirely by the real, already-existing service calls — this
 * component only sequences them and renders their real results; it never
 * invents team data, approval state, or staleness on its own.
 */
export class ProjectOverlay {
  /**
   * @param {object} deps
   * @param {object} deps.service - conversation service (preflightProject, runBootstrapAnalysis, approveProjectStrategy, refreshProjectStrategy)
   * @param {import("./view.js").CockpitView} deps.view
   * @param {string} deps.cwd
   * @param {() => void} deps.onClose - called when the overlay should close and focus should return to the editor
   * @param {() => void} [deps.requestRender]
   */
  constructor({ service, view, cwd, onClose, requestRender = () => {} }) {
    this.service = service;
    this.view = view;
    this.cwd = cwd;
    this.onClose = onClose;
    this.requestRender = requestRender;

    this.state = S.LOADING_PREFLIGHT;
    this.preflight = null;
    this.selectedAnalyst = null;
    this.selectList = null;
    this.suggestedStrategy = null;
    this.activeStrategy = null;
    this.errorMessage = null;

    const existing = view.snapshot?.projectStrategy ?? null;
    if (existing?.status === "active") {
      this.state = S.ACTIVE;
      this.activeStrategy = existing;
    } else if (existing?.status === "stale") {
      this.state = S.STALE;
      this.activeStrategy = existing;
    } else if (existing?.status === "suggested") {
      this.state = S.RESULT;
      this.suggestedStrategy = existing;
    } else {
      // LOCAL_PREFLIGHT: real, read-only evidence — no provider call, no
      // quota consumed, nothing persisted yet.
      void this.loadPreflight();
    }
  }

  invalidate() {
    this.selectList?.invalidate();
  }

  async loadPreflight() {
    try {
      this.preflight = await this.service.preflightProject({ cwd: this.cwd });
      if (!this.preflight.alternatives.length) {
        this.state = S.NO_ANALYST;
      } else {
        this.buildSelectList();
        this.state = S.SELECT_ANALYST;
      }
    } catch (error) {
      this.errorMessage = error.message ?? String(error);
      this.state = S.ERROR;
    }
    this.requestRender();
  }

  buildSelectList() {
    const items = this.preflight.alternatives.map((alt) => ({
      value: alt.choice,
      label: `${alt.choice === "quality" ? "Quality" : "Efficient"} Bootstrap Analyst`,
      description: this.view.aiTeamLabelWithProvider(alt.model)
    }));
    this.selectList = new SelectList(items, 6, editorTheme.selectList);
    this.selectList.onSelect = (item) => {
      this.selectedAnalyst = this.preflight.alternatives.find((alt) => alt.choice === item.value) ?? null;
      if (this.selectedAnalyst) this.state = S.CONFIRM_ANALYST;
      this.requestRender();
    };
    this.selectList.onCancel = () => this.close();
  }

  async confirmAnalyst() {
    this.state = S.ANALYZING;
    this.requestRender();
    try {
      const result = await this.service.runBootstrapAnalysis({
        cwd: this.cwd, profile: this.preflight.profile, candidates: this.preflight.candidates, analyst: this.selectedAnalyst
      });
      this.suggestedStrategy = result;
      this.state = S.RESULT;
    } catch (error) {
      this.errorMessage = error.message ?? String(error);
      this.state = S.ERROR;
    }
    this.requestRender();
  }

  async approve() {
    this.state = S.APPROVING;
    this.requestRender();
    try {
      this.activeStrategy = await this.service.approveProjectStrategy({ cwd: this.cwd });
      this.state = S.ACTIVE;
    } catch (error) {
      this.errorMessage = error.message ?? String(error);
      this.state = S.ERROR;
    }
    this.requestRender();
  }

  async refresh() {
    this.state = S.REFRESHING;
    this.requestRender();
    try {
      const result = await this.service.refreshProjectStrategy({ cwd: this.cwd });
      this.activeStrategy = result;
      this.state = result?.status === "stale" ? S.STALE : S.ACTIVE;
    } catch (error) {
      this.errorMessage = error.message ?? String(error);
      this.state = S.ERROR;
    }
    this.requestRender();
  }

  close() {
    this.onClose?.();
  }

  handleInput(data) {
    if (this.state === S.SELECT_ANALYST && this.selectList) {
      this.selectList.handleInput(data);
      this.requestRender();
      return;
    }
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc)) {
      if (this.state === S.CONFIRM_ANALYST) {
        this.state = S.SELECT_ANALYST;
        this.requestRender();
        return;
      }
      this.close();
      return;
    }
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
      if (this.state === S.CONFIRM_ANALYST) return void this.confirmAnalyst();
      if (this.state === S.RESULT) return void this.approve();
      if (this.state === S.STALE) return void this.refresh();
      if (this.state === S.NO_ANALYST || this.state === S.ERROR || this.state === S.ACTIVE) {
        this.close();
      }
    }
  }

  render(width) {
    const box = new Box(2, 1, (text) => theme.bg("selection", text));
    const aiTeamLabel = (model) => this.view.aiTeamLabel(model);
    const push = (text) => box.addChild(new Text(text));

    switch (this.state) {
      case S.LOADING_PREFLIGHT:
        push(theme.bold("Project Analysis"));
        push(theme.fg("muted", "Reading project evidence locally — no provider call, no quota consumed…"));
        break;
      case S.NO_ANALYST:
        push(theme.bold("Project Analysis"));
        push(theme.fg("warning", "No real Bootstrap Analyst candidate is available right now (ASK only supports Codex/Claude today)."));
        push(theme.fg("muted", "Esc / Enter to close."));
        break;
      case S.SELECT_ANALYST:
        push(theme.bold("Select Bootstrap Analyst"));
        push(theme.fg("muted", "Real, read-only preflight complete. Pick which real model investigates this project."));
        box.addChild(this.selectList);
        push(theme.fg("muted", "↑/↓ navigate · Enter select · Esc cancel"));
        break;
      case S.CONFIRM_ANALYST: {
        const model = this.selectedAnalyst.model;
        push(theme.bold("Confirm Bootstrap Analyst"));
        push(`  ${this.view.aiTeamLabelWithProvider(model)}${model.available === false ? theme.fg("warning", " (not available)") : ""}`);
        push(theme.fg("warning", "This will run a real, read-only investigation against your project and consume real quota from this provider."));
        push(theme.fg("muted", "Enter confirm and run · Esc back"));
        break;
      }
      case S.ANALYZING:
        push(theme.bold("ANALYZING"));
        push(theme.fg("muted", `${this.view.aiTeamLabelWithProvider(this.selectedAnalyst.model)} is investigating this project (read-only)…`));
        break;
      case S.RESULT: {
        const strategy = this.suggestedStrategy;
        push(theme.bold("Suggested Project Team"));
        push(theme.fg("muted", `Bootstrap Analyst: ${strategy.bootstrapAnalystChoice} — ${this.view.aiTeamLabelWithProvider(strategy.bootstrapAnalyst)}`));
        for (const line of teamLines("PROJECT TEAM — Quality", strategy.qualityTeam, aiTeamLabel)) push(line);
        for (const line of teamLines("PROJECT TEAM — Efficient (alternative)", strategy.efficientTeam, aiTeamLabel)) push(line);
        push(theme.fg("muted", "Enter approve and activate · Esc close without approving (strategy stays suggested)"));
        break;
      }
      case S.APPROVING:
        push(theme.bold("Approving"));
        push(theme.fg("muted", "Activating the project team…"));
        break;
      case S.REFRESHING:
        push(theme.bold("Refreshing"));
        push(theme.fg("muted", "Re-checking whether the active project team still matches the real evidence…"));
        break;
      case S.ACTIVE: {
        const strategy = this.activeStrategy;
        push(theme.fg("success", "ACTIVE"));
        push(theme.fg("muted", `Approved ${strategy.approvedAt ?? "?"}`));
        for (const line of teamLines("PROJECT TEAM", strategy.qualityTeam, aiTeamLabel)) push(line);
        push(theme.fg("muted", "Esc close"));
        break;
      }
      case S.STALE: {
        const strategy = this.activeStrategy;
        push(theme.fg("warning", "STALE"));
        push(theme.fg("muted", "The real project evidence has changed since this team was approved — previous assignments are kept until refreshed."));
        for (const line of teamLines("PROJECT TEAM (previous)", strategy.qualityTeam, aiTeamLabel)) push(line);
        push(theme.fg("muted", "Enter refresh · Esc close"));
        break;
      }
      case S.ERROR:
      default:
        push(theme.fg("error", "Error"));
        push(theme.fg("muted", this.errorMessage ?? "Unknown error."));
        push(theme.fg("muted", "Esc / Enter to close."));
        break;
    }
    return box.render(width);
  }
}

/**
 * Opens the real /project overlay on top of `tui`, focus-managed by pi-tui
 * itself (showOverlay records the currently-focused component — the
 * editor — and restores it automatically when the overlay is hidden, per
 * pi-tui's own OverlayHandle contract).
 * @param {object} args
 * @param {object} args.tui
 * @param {object} args.service
 * @param {import("./view.js").CockpitView} args.view
 * @param {string} args.cwd
 */
export function openProjectOverlay({ tui, service, view, cwd }) {
  let handle;
  const overlay = new ProjectOverlay({
    service, view, cwd,
    onClose: () => handle?.hide(),
    requestRender: () => tui.requestRender()
  });
  handle = tui.showOverlay(overlay, { width: "80%", maxHeight: "80%", anchor: "center" });
  return handle;
}
