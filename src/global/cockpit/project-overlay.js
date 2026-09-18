import { Box, SelectList, Text, Input, Key, matchesKey, fuzzyFilter } from "@earendil-works/pi-tui";
import { editorTheme, theme } from "./theme.js";
import { CARD_TONE, cardInnerWidth, renderPanel } from "./card.js";

// /project's interactive overlay — the real preflight -> select analyst ->
// confirm -> analyze -> result -> approve loop, reusing the exact same
// service functions the plain-text /project subcommands already use
// (preflightProject, runBootstrapAnalysis, approveProjectStrategy,
// refreshProjectStrategy, getProjectTeamEditCatalog, setProjectTeamAssignment).
// No new persistence, no new ProjectStrategy schema — this is a different
// way to drive the same real state machine, never a parallel one. The
// plain-text subcommands (/project status|analyze|analyst|approve|refresh)
// keep working unchanged; this overlay is what bare `/project` (no
// subcommand) now opens.

export const PROJECT_OVERLAY_STATE = {
  LOADING_PREFLIGHT: "loading-preflight",
  NO_ANALYST: "no-analyst",
  SELECT_ANALYST: "select-analyst",
  CONFIRM_ANALYST: "confirm-analyst",
  ANALYZING: "analyzing",
  RESULT: "result",
  EDIT_LOADING: "edit-loading",
  EDIT_MODEL_SEARCH: "edit-model-search",
  EDIT_CONFIRM: "edit-confirm",
  EDIT_SAVING: "edit-saving",
  APPROVING: "approving",
  REFRESHING: "refreshing",
  ACTIVE: "active",
  STALE: "stale",
  ERROR: "error"
};

const S = PROJECT_OVERLAY_STATE;

// Give the modal frame a distinct, high-contrast outline without changing
// the shared dashboard-card palette or the semantic state color of its rail.
const overlayFrameTheme = {
  ...theme,
  fg: (role, text) => theme.fg(role === "border" ? "info" : role, text)
};

function teamLines(label, team, view, tone = "bold") {
  const lines = [tone === "bold" ? theme.bold(label) : theme.fg("muted", label)];
  if (!team?.length) {
    lines.push(theme.fg("muted", "  (no active roles)"));
    return lines;
  }
  const modelColumnWidth = view.teamModelColumnWidth(team.map((entry) => entry.model));
  for (const entry of team) {
    const modelText = entry.model ? view.teamRoleLabel(entry.model, modelColumnWidth) : theme.fg("warning", "no eligible option");
    lines.push(theme.fg("muted", `  ${entry.role.padEnd(10)} ${modelText}`));
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
   * @param {object} deps.service - conversation service (preflightProject, runBootstrapAnalysis, approveProjectStrategy, refreshProjectStrategy, getProjectTeamEditCatalog, setProjectTeamAssignment)
   * @param {import("./view.js").CockpitView} deps.view
   * @param {string} deps.cwd
   * @param {() => void} deps.onClose - called when the overlay should close and focus should return to the editor
   * @param {() => void} [deps.requestRender]
   * @param {(text: string) => void} [deps.onNarrate] - mirrors real milestones
   *   (analysis started, result ready, approved, refreshed, errors) into the
   *   main conversation transcript, the same way the plain-text /project
   *   subcommands already narrate their own steps there — the interactive
   *   overlay is the rich detail view, but the chat history should still
   *   show that an analysis happened and what it decided, matching how a
   *   real CLI (Claude, Codex) narrates its own process. Never called for
   *   pure navigation (opening a picker, moving a selection) — only for a
   *   real state change the overlay's own service calls produced.
   */
  constructor({ service, view, cwd, onClose, requestRender = () => {}, onNarrate = () => {} }) {
    this.service = service;
    this.view = view;
    this.cwd = cwd;
    this.onClose = onClose;
    this.requestRender = requestRender;
    this.onNarrate = onNarrate;

    this.state = S.LOADING_PREFLIGHT;
    // The real Box render() builds each frame, kept here (not local to
    // render()) so handleMouse can forward a real click into it — pi-tui
    // dispatches mouse events against whatever the component's own last
    // render() actually laid out, never a freshly-built one.
    this.box = null;
    this.lastWidth = 76;
    this.preflight = null;
    this.selectedAnalyst = null;
    this.selectList = null;
    this.suggestedStrategy = null;
    this.activeStrategy = null;
    this.errorMessage = null;

    // projectTeam editing (section 4).
    this.resultSelectList = null;
    this.editingRole = null;
    this.editCatalog = null;
    this.editModels = [];
    this.editQuery = "";
    this.editInput = null;
    this.editSelectList = null;
    this.pendingEditCandidate = null;

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
      this.buildResultRoleList();
    } else {
      // LOCAL_PREFLIGHT: real, read-only evidence — no provider call, no
      // quota consumed, nothing persisted yet.
      void this.loadPreflight();
    }
  }

  invalidate() {
    this.selectList?.invalidate();
    this.resultSelectList?.invalidate();
    this.editSelectList?.invalidate();
    this.editInput?.invalidate();
    this.box?.invalidate();
  }

  /**
   * Forwards a real mouse event into the real Box render() built — the
   * missing half of the real contract: SelectList/Box already implement
   * handleMouse (a click can select an analyst or a PROJECT TEAM role
   * row), but nothing here ever called it, so those real clicks never
   * reached the list at all. Coordinates are translated from this real
   * bordered panel's own frame (render()'s renderPanel border + padding)
   * back into the Box's own render(cardInnerWidth(width)) coordinate
   * space — the exact inverse of how render() below lays the frame out.
   * @param {import("@earendil-works/pi-tui").TuiMouseEvent} event
   */
  handleMouse(event) {
    if (!this.box) return undefined;
    const innerWidth = cardInnerWidth(this.lastWidth);
    const x = event.x - 2; // real frame's own left border + one padding column (see card.js's cardLine)
    const y = event.y - 1; // real frame's own top border row (see card.js's cardTop)
    if (x < 0 || y < 0 || x >= innerWidth) return undefined;
    return this.box.handleMouse({ ...event, x, y, width: innerWidth });
  }

  async loadPreflight() {
    this.view.beginAction("Reading project evidence locally");
    try {
      this.preflight = await this.service.preflightProject({ cwd: this.cwd });
      const models = this.preflight.analystCatalog?.models ?? [];
      if (!models.length) {
        this.state = S.NO_ANALYST;
      } else {
        this.buildSelectList();
        this.state = S.SELECT_ANALYST;
      }
    } catch (error) {
      this.errorMessage = error.message ?? String(error);
      this.state = S.ERROR;
    }
    this.view.endAction();
    this.requestRender();
  }

  /** A short, honest label for a catalog entry's own real recommendationTags/evidenceStatus — never a fabricated "Quality"/"Efficient" claim for a model that doesn't actually carry that tag. */
  static tagLabel(model) {
    if (model.evidenceStatus === "unscored") return "Unscored";
    const tags = [];
    if (model.recommendationTags.includes("quality")) tags.push("Quality fit");
    if (model.recommendationTags.includes("efficient")) tags.push("Efficient fit");
    return tags.join(" · ");
  }

  /**
   * Builds the real, full analyst catalog picker — every real ask-
   * supported model (scored AND unscored), the real recommended one
   * listed first and pre-selected (index 0), matching every OTHER real
   * candidate's own real tag/evidence state honestly instead of
   * collapsing the catalog back down to just two picks.
   */
  buildSelectList() {
    const catalog = this.preflight.analystCatalog;
    const models = catalog.models ?? [];
    const recommendedKey = catalog.recommendedModel?.candidateKey ?? null;
    const ordered = recommendedKey
      ? [...models.filter((m) => m.candidateKey === recommendedKey), ...models.filter((m) => m.candidateKey !== recommendedKey)]
      : models;
    // Model-first rows: "<display name>    <provider>    <real tag>" —
    // never provider-first, matching the plan's own mockup. The primary
    // column (model + provider) is explicitly the real, bright `text`
    // color — never left to the terminal's own default or muted, so it
    // stays legible regardless of terminal theme; muted stays reserved
    // for the real secondary tag in `description`.
    const items = ordered.map((model) => ({
      value: model.candidateKey,
      label: theme.fg("text", `${model.displayName}    ${model.adapterId}`),
      description: ProjectOverlay.tagLabel(model)
    }));
    this.selectList = new SelectList(items, 8, editorTheme.selectList);
    this.selectList.onSelect = (item) => {
      const picked = models.find((model) => model.candidateKey === item.value);
      if (!picked) return;
      const selectionSource = picked.candidateKey === recommendedKey ? "recommended" : "manual";
      const recommendationTags = picked.recommendationTags ?? [];
      this.selectedAnalyst = {
        // A clean modelRef shape — no UI-only fields leak into what
        // eventually gets persisted verbatim as ProjectStrategy's own
        // bootstrapAnalyst (see buildProjectStrategy). available/
        // evidenceStatus below are UI-only, read by this overlay's own
        // CONFIRM_ANALYST render, never sent to the service or persisted.
        model: { adapterId: picked.adapterId, modelId: picked.modelId, displayName: picked.displayName },
        selectionSource,
        recommendationTags,
        // choice stays ONLY for the legacy plain-text subcommand's own
        // persisted field — never fabricated for a real manual/unscored
        // pick that fits neither bucket.
        choice: recommendationTags.includes("quality") ? "quality" : recommendationTags.includes("efficient") ? "efficient" : null,
        available: picked.available,
        evidenceStatus: picked.evidenceStatus
      };
      this.state = S.CONFIRM_ANALYST;
      this.requestRender();
    };
    this.selectList.onCancel = () => this.close();
  }

  async confirmAnalyst() {
    this.state = S.ANALYZING;
    this.view.beginAction(`${this.view.aiTeamLabelWithProvider(this.selectedAnalyst.model)} is investigating this project`);
    this.requestRender();
    this.onNarrate(`${this.view.aiTeamLabelWithProvider(this.selectedAnalyst.model)} is investigating this project (read-only)…`);
    try {
      const result = await this.service.runBootstrapAnalysis({
        cwd: this.cwd, profile: this.preflight.profile, candidates: this.preflight.candidates, analyst: this.selectedAnalyst
      });
      this.suggestedStrategy = result;
      this.buildResultRoleList();
      this.state = S.RESULT;
      const roleCount = result.activeRoles?.length ?? 0;
      this.onNarrate(`Suggested project team ready (${roleCount} real role${roleCount === 1 ? "" : "s"}). Open /project to review, edit, or approve it.`);
    } catch (error) {
      this.errorMessage = error.message ?? String(error);
      this.state = S.ERROR;
      this.onNarrate(`Project analysis failed: ${this.errorMessage}`);
    }
    this.view.endAction();
    this.requestRender();
  }

  /**
   * The RESULT screen's own real, interactive PROJECT TEAM list — one row
   * per real role in strategy.projectTeam, showing its real current
   * model and whether it's a real override. Enter on a row opens that
   * role's real edit picker (see openRolePicker); Esc closes the overlay
   * without approving (unchanged). Approval is a separate, explicit key
   * ("a") — Enter here edits, it never silently approves.
   */
  buildResultRoleList() {
    const team = this.suggestedStrategy?.projectTeam ?? [];
    const modelColumnWidth = this.view.teamModelColumnWidth(team.map((entry) => entry.model));
    const items = team.map((entry) => {
      const modelText = entry.model ? this.view.teamRoleLabel(entry.model, modelColumnWidth) : "no eligible option";
      const overrideNote = entry.assignmentSource === "override" ? theme.fg("accent", " (override)") : "";
      // Role + model are the real primary information here — explicit
      // `text` color, never left to default/muted.
      // WHY this model was picked — the real, human-readable evidence
      // buildProjectStrategy already carries (entry.reason, sourced from
      // efficientTeam's own describeEfficiencyDecision), never a
      // fabricated justification. An override has no ranking reason of
      // its own (see applyProjectTeamOverride) — honestly say so instead
      // of silently reusing the old recommendation's reason for a
      // different model.
      const description = entry.assignmentSource === "override"
        ? "Manual override — not the automatic ranking's own pick."
        : (entry.reason ?? "");
      return { value: entry.role, label: theme.fg("text", `${entry.role.padEnd(10)} ${modelText}`) + overrideNote, description };
    });
    this.resultSelectList = new SelectList(items, 6, editorTheme.selectList);
    this.resultSelectList.onSelect = (item) => void this.openRolePicker(item.value);
    this.resultSelectList.onCancel = () => this.close();
  }

  /**
   * Opens the real edit picker for one projectTeam role — a real, read-
   * only catalog fetch (getProjectTeamEditCatalog), no quota, no write.
   */
  async openRolePicker(role) {
    this.editingRole = role;
    this.editCatalog = null;
    this.state = S.EDIT_LOADING;
    this.view.beginAction(`Reading the real current catalog for ${role}`);
    this.requestRender();
    try {
      this.editCatalog = await this.service.getProjectTeamEditCatalog({ cwd: this.cwd, role });
      this.buildEditPicker();
      this.state = S.EDIT_MODEL_SEARCH;
    } catch (error) {
      this.errorMessage = error.message ?? String(error);
      this.state = S.ERROR;
    }
    this.view.endAction();
    this.requestRender();
  }

  /**
   * Orders the real edit catalog per the plan's own contract: 1) the
   * role's real current operational model, 2) its real original
   * recommendation (when different from the current), 3) the rest of the
   * real scored candidates, 4) the real unscored ones — never re-ranking
   * anything, just ordering what the catalog already returned.
   */
  orderedEditModels() {
    const entry = this.suggestedStrategy?.projectTeam?.find((e) => e.role === this.editingRole);
    const currentKey = entry?.model?.candidateKey ?? null;
    const recommendedKey = entry?.recommendedAssignment?.model?.candidateKey ?? currentKey;
    const models = this.editCatalog?.models ?? [];
    const byKey = new Map(models.map((m) => [m.candidateKey, m]));
    const seen = new Set();
    const ordered = [];
    const pushIfPresent = (key) => {
      if (key && byKey.has(key) && !seen.has(key)) {
        ordered.push(byKey.get(key));
        seen.add(key);
      }
    };
    pushIfPresent(currentKey);
    pushIfPresent(recommendedKey);
    for (const model of models) {
      if (seen.has(model.candidateKey) || model.evidenceStatus === "unscored") continue;
      ordered.push(model);
      seen.add(model.candidateKey);
    }
    for (const model of models) {
      if (seen.has(model.candidateKey)) continue;
      ordered.push(model);
      seen.add(model.candidateKey);
    }
    return ordered;
  }

  editItemTag(model, currentKey, recommendedKey) {
    const tags = [];
    if (model.candidateKey === currentKey) tags.push("current");
    if (model.candidateKey === recommendedKey) tags.push("recommended");
    if (model.evidenceStatus === "unscored") tags.push("unscored");
    if (model.accessMode === "manual") tags.push("manual");
    return tags.join(" · ");
  }

  buildEditPicker() {
    this.editQuery = "";
    this.editInput = new Input({ placeholder: "type to search…" });
    this.editModels = this.orderedEditModels();
    this.rebuildEditSelectList();
  }

  /** Real fuzzy filtering (pi-tui's own fuzzyFilter) against each real candidate's own display name + provider — never SelectList's built-in setFilter, which only prefix-matches a plain `value` (here, candidateKey), not what a human actually types. */
  rebuildEditSelectList() {
    const entry = this.suggestedStrategy?.projectTeam?.find((e) => e.role === this.editingRole);
    const currentKey = entry?.model?.candidateKey ?? null;
    const recommendedKey = entry?.recommendedAssignment?.model?.candidateKey ?? currentKey;
    const filtered = this.editQuery
      ? fuzzyFilter(this.editModels, this.editQuery, (model) => `${model.displayName} ${model.adapterId}`)
      : this.editModels;
    const items = filtered.map((model) => ({
      value: model.candidateKey,
      label: theme.fg("text", `${model.displayName}    ${model.adapterId}`),
      description: this.editItemTag(model, currentKey, recommendedKey)
    }));
    this.editSelectList = new SelectList(items, 8, editorTheme.selectList);
  }

  beginConfirmEdit(candidateKey) {
    const candidate = this.editCatalog?.models?.find((m) => m.candidateKey === candidateKey);
    if (!candidate) return;
    this.pendingEditCandidate = candidate;
    this.state = S.EDIT_CONFIRM;
    this.requestRender();
  }

  async commitEdit() {
    this.state = S.EDIT_SAVING;
    this.view.beginAction("Saving the real assignment");
    this.requestRender();
    try {
      this.suggestedStrategy = await this.service.setProjectTeamAssignment({
        cwd: this.cwd, role: this.editingRole, candidateKey: this.pendingEditCandidate.candidateKey
      });
      this.buildResultRoleList();
      this.state = S.RESULT;
    } catch (error) {
      this.errorMessage = error.message ?? String(error);
      this.state = S.ERROR;
    }
    this.view.endAction();
    this.requestRender();
  }

  async approve() {
    this.state = S.APPROVING;
    this.view.beginAction("Activating the project team");
    this.requestRender();
    try {
      this.activeStrategy = await this.service.approveProjectStrategy({ cwd: this.cwd });
      this.state = S.ACTIVE;
      this.onNarrate("Project team is now ACTIVE.");
    } catch (error) {
      this.errorMessage = error.message ?? String(error);
      this.state = S.ERROR;
      this.onNarrate(`Approval failed: ${this.errorMessage}`);
    }
    this.view.endAction();
    this.requestRender();
  }

  async refresh() {
    this.state = S.REFRESHING;
    this.view.beginAction("Re-checking the real project evidence");
    this.requestRender();
    try {
      const result = await this.service.refreshProjectStrategy({ cwd: this.cwd });
      this.activeStrategy = result;
      this.state = result?.status === "stale" ? S.STALE : S.ACTIVE;
      this.onNarrate(result ? `Project strategy is now ${result.status.toUpperCase()}.` : "Nothing to refresh yet.");
    } catch (error) {
      this.errorMessage = error.message ?? String(error);
      this.state = S.ERROR;
      this.onNarrate(`Refresh failed: ${this.errorMessage}`);
    }
    this.view.endAction();
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

    if (this.state === S.RESULT && this.resultSelectList) {
      // "a" approves and activates — a distinct key from Enter, which
      // edits the highlighted role instead. Enter must never silently
      // approve just because a role row happens to be focused.
      if (data === "a" || data === "A") return void this.approve();
      this.resultSelectList.handleInput(data);
      this.requestRender();
      return;
    }

    if (this.state === S.EDIT_MODEL_SEARCH) {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc)) {
        this.state = S.RESULT;
        this.requestRender();
        return;
      }
      if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
        const item = this.editSelectList?.getSelectedItem?.();
        if (item) this.beginConfirmEdit(item.value);
        return;
      }
      if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
        this.editSelectList?.handleInput(data);
        this.requestRender();
        return;
      }
      this.editInput.handleInput(data);
      this.editQuery = this.editInput.getValue();
      this.rebuildEditSelectList();
      this.requestRender();
      return;
    }

    if (this.state === S.EDIT_CONFIRM) {
      if (matchesKey(data, Key.escape) || matchesKey(data, Key.esc)) {
        this.state = S.EDIT_MODEL_SEARCH;
        this.requestRender();
        return;
      }
      if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) return void this.commitEdit();
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
      if (this.state === S.STALE) return void this.refresh();
      if (this.state === S.NO_ANALYST || this.state === S.ERROR || this.state === S.ACTIVE) {
        this.close();
      }
    }
  }

  /** Real border tone per state — never a fixed color, so ERROR/WARNING states read as visually distinct as their own content already claims to be. */
  panelTone() {
    if (this.state === S.ERROR) return CARD_TONE.ERROR;
    if (this.state === S.NO_ANALYST || this.state === S.STALE) return CARD_TONE.WARNING;
    if (this.state === S.RESULT || this.state === S.ACTIVE) return CARD_TONE.SUCCESS;
    return CARD_TONE.INFO;
  }

  render(width) {
    this.lastWidth = width;
    // No background applied to the whole box — only the SelectList's own
    // active row gets a highlight (editorTheme.selectList's own
    // selectedPrefix/selectedText), so the overlay reads as a real modal
    // over the dashboard, not a solid color block. The real bordered
    // frame below (renderPanel) is what actually keeps this from getting
    // visually lost against the dashboard behind it — a background alone
    // isn't a modal boundary a human eye reliably notices.
    const box = new Box(2, 1);
    this.box = box;
    // Text defaults to one blank row above and below every child; inside
    // a framed modal that inflated the height until pi-tui clipped the
    // bottom border. Keep spacing explicit and compact instead.
    const push = (text) => box.addChild(new Text(text, 0, 0));
    // The real, ticking spinner+elapsed-time line every other in-flight
    // action in the cockpit already uses (view.beginAction/tickSpinner/
    // actionStatusLine — app.js's own fast timer keeps it live) — never a
    // static "…" string that just sits there unchanged. Falls back to the
    // static text only if no real action happens to be running yet (the
    // render right before beginAction's own first call).
    const spinnerLine = (fallback) => theme.fg("muted", this.view.actionStatusLine() ?? fallback);

    switch (this.state) {
      case S.LOADING_PREFLIGHT:
        push(theme.bold("Analyze Project"));
        push(spinnerLine("Reading project evidence locally — no provider call, no quota consumed…"));
        break;
      case S.NO_ANALYST:
        push(theme.bold("Select Project Analyst"));
        push(theme.fg("warning", "No real Project Analyst candidate is available right now (ASK only supports Codex/Claude today)."));
        push(theme.fg("muted", "Esc / Enter to close."));
        break;
      case S.SELECT_ANALYST:
        push(theme.bold("Select Project Analyst"));
        // The Project Analyst investigates and reports on this project's
        // real architecture and risks — it never joins the team it
        // recommends (see BOOTSTRAP_ANALYST_PROFILE), so it's shown
        // distinctly from Architect and every other role, and only ever
        // as one of the two real models Kairo can actually invoke,
        // isolated, read-only (Codex/Claude today).
        push(theme.fg("muted", "Architecture & systems analysis — read-only, no quota consumed until you confirm."));
        box.addChild(this.selectList);
        push(theme.fg("muted", "Enter Select · Esc Cancel"));
        break;
      case S.CONFIRM_ANALYST: {
        const { model, selectionSource, available, evidenceStatus } = this.selectedAnalyst;
        push(theme.bold("Confirm Project Analyst"));
        const sourceNote = selectionSource === "manual" ? theme.fg("muted", " (manual selection)") : "";
        push(`  ${this.view.aiTeamLabelWithProvider(model)}${sourceNote}${available === false ? theme.fg("warning", " (not available)") : ""}`);
        if (evidenceStatus === "unscored") {
          push(theme.fg("warning", "This model has no real benchmark evidence — Kairo isn't recommending it, you're choosing it manually."));
        }
        push(theme.fg("warning", "This will run a real, read-only investigation against your project and consume real quota from this provider."));
        push(theme.fg("muted", "Enter confirm and run · Esc back"));
        break;
      }
      case S.ANALYZING:
        push(theme.bold("ANALYZING"));
        push(spinnerLine(`${this.view.aiTeamLabelWithProvider(this.selectedAnalyst.model)} is investigating this project (read-only)…`));
        break;
      case S.RESULT: {
        const strategy = this.suggestedStrategy;
        push(theme.bold("Suggested Project Team"));
        const choiceNote = strategy.bootstrapAnalystChoice ?? (strategy.bootstrapAnalystSelectionSource === "manual" ? "manual pick" : "recommended");
        push(theme.fg("muted", `Project Analyst: ${choiceNote} — ${this.view.aiTeamLabelWithProvider(strategy.bootstrapAnalyst)}`));
        push(theme.bold("PROJECT TEAM"));
        box.addChild(this.resultSelectList);
        // Quality/Efficient stay real, comparative REFERENCE — muted, and
        // rendered strictly below the real operational PROJECT TEAM list
        // above, never replacing it visually.
        for (const line of teamLines("Quality (reference)", strategy.qualityTeam, this.view, "muted")) push(line);
        for (const line of teamLines("Efficient (reference)", strategy.efficientTeam, this.view, "muted")) push(line);
        push(theme.fg("muted", "Enter edit role · a approve & activate · Esc close without approving"));
        break;
      }
      case S.EDIT_LOADING:
        push(theme.bold(`Edit ${this.editingRole}`));
        push(spinnerLine("Reading the real current catalog for this role — no quota consumed…"));
        break;
      case S.EDIT_MODEL_SEARCH:
        push(theme.bold(`Edit ${this.editingRole}`));
        push(theme.fg("muted", "current · recommended · manual · unscored — real state, never fabricated."));
        box.addChild(this.editInput);
        box.addChild(this.editSelectList);
        push(theme.fg("muted", "Enter select · Esc cancel"));
        break;
      case S.EDIT_CONFIRM: {
        const entry = this.suggestedStrategy.projectTeam.find((e) => e.role === this.editingRole);
        const candidate = this.pendingEditCandidate;
        const oldLabel = entry?.model ? this.view.aiTeamLabelWithProvider(entry.model) : "(none)";
        const newLabel = this.view.aiTeamLabelWithProvider({ adapterId: candidate.adapterId, modelId: candidate.modelId, displayName: candidate.displayName });
        const recommendedKey = entry?.recommendedAssignment?.model?.candidateKey ?? entry?.model?.candidateKey ?? null;
        const isRecommended = candidate.candidateKey === recommendedKey;
        push(theme.bold(`Confirm ${this.editingRole}`));
        push(`  ${oldLabel} → ${newLabel}`);
        push(theme.fg("muted", isRecommended ? "restores the real recommendation" : "manual override"));
        if (candidate.evidenceStatus === "unscored") {
          push(theme.fg("warning", "This model has no real benchmark evidence for this role."));
        }
        if (candidate.accessMode === "manual") {
          push(theme.fg("warning", `${candidate.adapterId} isn't executable by Kairo automatically — this role will need a manual handoff.`));
        }
        push(theme.fg("muted", "Enter confirm and save (still suggested, not yet approved) · Esc back"));
        break;
      }
      case S.EDIT_SAVING:
        push(theme.bold(`Edit ${this.editingRole}`));
        push(spinnerLine("Saving the real assignment…"));
        break;
      case S.APPROVING:
        push(theme.bold("Approving"));
        push(spinnerLine("Activating the project team…"));
        break;
      case S.REFRESHING:
        push(theme.bold("Refreshing"));
        push(spinnerLine("Re-checking whether the active project team still matches the real evidence…"));
        break;
      case S.ACTIVE: {
        const strategy = this.activeStrategy;
        push(theme.fg("success", "ACTIVE"));
        push(theme.fg("muted", `Approved ${strategy.approvedAt ?? "?"}`));
        for (const line of teamLines("PROJECT TEAM", strategy.projectTeam ?? strategy.qualityTeam, this.view)) push(line);
        push(theme.fg("muted", "Esc close"));
        break;
      }
      case S.STALE: {
        const strategy = this.activeStrategy;
        push(theme.fg("warning", "STALE"));
        push(theme.fg("muted", "The real project evidence has changed since this team was approved — previous assignments are kept until refreshed."));
        for (const line of teamLines("PROJECT TEAM (previous)", strategy.projectTeam ?? strategy.qualityTeam, this.view)) push(line);
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
    const innerWidth = cardInnerWidth(width);
    return renderPanel("Project", this.panelTone(), overlayFrameTheme, width, box.render(innerWidth));
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
 * @param {(text: string) => void} [args.onNarrate] - see ProjectOverlay's own doc
 */
export function openProjectOverlay({ tui, service, view, cwd, onNarrate }) {
  let handle;
  const overlay = new ProjectOverlay({
    service, view, cwd, onNarrate,
    onClose: () => handle?.hide(),
    requestRender: () => tui.requestRender()
  });
  handle = tui.showOverlay(overlay, { width: 76, maxHeight: "70%", anchor: "center" });
  return handle;
}
