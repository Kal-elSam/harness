import { Editor, ProcessTerminal, ScrollView, TuiAltScreen, VStack, isViewportTUI, matchesKey } from "@earendil-works/pi-tui";
import { createConversationService } from "../conversation/service.js";
import { CockpitView } from "./view.js";
import { editorTheme, theme } from "./theme.js";
import { CARD_TONE, cardTop } from "./card.js";
import { openProjectOverlay } from "./project-overlay.js";

// The composer is otherwise just two flat, muted rules from pi-tui's Editor
// (no title, no corners) — easy to miss right under the cockpit's colorful
// framed cards. This title bar gives it the same rounded-corner, titled
// look as the rest of the cockpit so it reads as its own zone: a blank
// spacer row separates it from whatever is above (SESSION), then the title
// sits directly on top of the editor's own rule with no gap, so the two
// read as one continuous framed box rather than two disconnected pieces.
function composerHeader(width, workMode) {
  const label = workMode ? ` · ${workMode.toUpperCase()}` : "";
  return ["", cardTop(`Message Kairo${label}`, CARD_TONE.SUCCESS, theme, width)];
}

const DEFAULT_POLL_MS = 2000;
// Fast enough to read as a live "thinking" indicator (a real spinner plus
// a ticking elapsed-time count), slow enough to never matter for CPU/
// battery on a terminal app that's otherwise idle between actions.
const DEFAULT_SPINNER_MS = 120;

/**
 * Builds the real-scroll layout tree: dashboard (fixed) + conversation
 * (the only scrollable zone, via pi-tui's own ScrollView) + composer
 * header (fixed) + editor (fixed). Extracted as a pure function so the
 * exact shape/options can be unit tested directly — pi-tui's
 * isViewportTUI() gate checks an internal, non-exported symbol that test
 * doubles can't fake, so this can't be exercised end-to-end through
 * runCockpitApp() in a unit test the way the addChild() fallback can.
 * `view` still owns all cockpit state; dashboardComponent/
 * conversationComponent are thin render adapters, not new state.
 * @param {import("./view.js").CockpitView} view
 * @param {object} editor
 * @returns {object} a VStack ready for tui.setLayoutRoot()
 */
export function buildViewportLayoutRoot(view, editor) {
  const dashboardComponent = { render: (width) => view.renderDashboard(width) };
  const conversationComponent = { render: (width) => view.renderConversation(width) };
  const conversationScroll = new ScrollView(conversationComponent, {
    follow: "end", primary: true, overscroll: "contain", scrollbar: "auto"
  });
  return new VStack([
    { component: dashboardComponent, shrink: 0 },
    { component: conversationScroll, grow: 1, minSize: 4 },
    { component: { render: (width) => composerHeader(width, view.workMode) }, basis: 2, shrink: 0 },
    { component: editor, basis: 3, shrink: 0 }
  ], { gap: 0 });
}

/**
 * Boots the interactive `kairo start` cockpit: a full-screen pi-tui app wired
 * to the real conversation service (no mocks). Every dependency is
 * injectable so this can run headless in tests.
 *
 * @param {object} [options]
 * @param {string} options.cwd
 * @param {object} [options.service] - conversation service (defaults to the real one)
 * @param {() => object} [options.terminalFactory] - defaults to `() => new ProcessTerminal()`
 * @param {(terminal: object) => object} [options.tuiFactory] - defaults to `(t) => new TuiAltScreen(t)`
 * @param {number} [options.pollIntervalMs]
 * @param {(fn: () => void, ms: number) => any} [options.setIntervalImpl]
 * @param {(handle: any) => void} [options.clearIntervalImpl]
 * @returns {Promise<{ tui: object, view: CockpitView, stop: () => void, done: Promise<void>, refresh: () => Promise<void> }>}
 */
export async function runCockpitApp({
  cwd,
  service = createConversationService({ enableProviderProbes: true }),
  terminalFactory = () => new ProcessTerminal(),
  tuiFactory = (terminal) => new TuiAltScreen(terminal),
  editorFactory = (tui) => new Editor(tui, editorTheme),
  pollIntervalMs = DEFAULT_POLL_MS,
  spinnerIntervalMs = DEFAULT_SPINNER_MS,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval
} = {}) {
  const terminal = terminalFactory();
  const tui = tuiFactory(terminal);
  const editor = editorFactory(tui);

  let timer = null;
  let spinnerTimer = null;
  let stopped = false;
  let resolveDone;
  const done = new Promise((resolvePromise) => { resolveDone = resolvePromise; });

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer) clearIntervalImpl(timer);
    if (spinnerTimer) clearIntervalImpl(spinnerTimer);
    tui.stop();
    resolveDone();
  }

  // The real nextIndex already shown per active runId (see
  // service.readRunTranscript's own doc) — in-memory only, never
  // persisted: a restart just starts tailing from 0 again, which is fine
  // since the run's own real event log still has everything.
  const runTranscriptState = new Map();

  /**
   * Tails every real active run's own transcript for new lines since the
   * last poll and pushes them into the chat, each one tagged with its own
   * real provider (never a generic "Kairo" label) — Kairo can have
   * multiple real runs active across different real providers (Codex,
   * Claude, OpenCode) at once, and each line must stay attributed to
   * whichever one actually produced it. Runs one final tail pass after a
   * run stops being active (to catch its last lines), then stops tracking
   * it. Best-effort: a single run's tail failing must never break the
   * rest of the poll loop.
   * @param {Array<object>} timeline
   */
  async function tailActiveRunTranscripts(timeline) {
    for (const entry of timeline ?? []) {
      const runId = entry.execution?.runId;
      if (!runId) continue;
      if (!entry.execution.active && !runTranscriptState.has(runId)) continue;
      const sinceIndex = runTranscriptState.get(runId) ?? 0;
      try {
        const result = await service.readRunTranscript({ runId, sinceIndex });
        for (const line of result.entries) {
          const tag = line.provider ? `${theme.fg("muted", `[${line.provider}]`)} ` : "";
          pushTranscript("kairo", `${tag}${line.text}`);
        }
        runTranscriptState.set(runId, result.nextIndex);
      } catch {
        // Best-effort — see this function's own doc.
      }
      if (!entry.execution.active) runTranscriptState.delete(runId);
    }
  }

  async function refresh() {
    try {
      const snapshot = await service.snapshot({ cwd });
      view.setSnapshot(snapshot);
      view.setRowsFromTimeline(snapshot.timeline);
      await tailActiveRunTranscripts(snapshot.timeline);
    } catch (error) {
      view.setStatus(`Refresh failed: ${error.message ?? String(error)}`);
    }
  }

  async function runAction(label, fn) {
    view.beginAction(label);
    try {
      await fn();
      view.endAction();
      await refresh();
    } catch (error) {
      view.endAction();
      view.setStatus(`${label} failed: ${error.message ?? String(error)}`);
    }
  }

  const view = new CockpitView({
    requestRender: () => tui.requestRender(),
    // Composer header (basis:2, includes its own spacer row) + editor
    // (basis:3) reserve 5 rows (the VStack below has no gap) — the rest of
    // the terminal is the view's.
    getViewportRows: () => {
      const rows = Number(terminal?.rows);
      return Number.isFinite(rows) && rows > 0 ? Math.max(10, rows - 5) : undefined;
    },
    actions: {
      onShowPlan: (taskId) => {
        return runAction("Loading plan", async () => {
          const plan = await service.showPlan({ cwd, taskId });
          view.showDetail(taskId, plan.planMarkdown || plan.taskMarkdown || "(no plan markdown yet)");
        });
      },
      onApprove: (taskId) => {
        return runAction("Approving", () => service.decidePlan({ cwd, taskId, decision: "approved" }));
      },
      onReject: (taskId) => {
        return runAction("Rejecting", () => service.decidePlan({ cwd, taskId, decision: "rejected" }));
      },
      onRequestExecute: (taskId, role = null) => {
        // `role` comes from the view's own role picker (view.js's
        // projectTeamRoles()/showRoleSelect) whenever the active
        // ProjectStrategy has a real team — the user's explicit choice,
        // never inferred here or anywhere else from the task's text.
        // Omitted entirely (no active team yet) falls back to the legacy
        // text-classification router, unchanged.
        return runAction("Asking the router who should execute this", async () => {
          const decision = await service.planExecution(role ? { cwd, taskId, role } : { cwd, taskId });
          view.showExecuteConfirm(taskId, decision);
        });
      },
      onExecute: (taskId, decision) => {
        const label = decision?.provider ? `Executing with ${decision.provider}` : "Executing";
        // A real ProjectExecutionPreview carries `confirmationTarget` —
        // executePlan revalidates it against a freshly recomputed route
        // before ever reserving quota or launching (see service.js's own
        // doc). A legacy (no-role) decision has no such key at all, and
        // keeps using the old free-form agentId/model override.
        const request = decision?.confirmationTarget
          ? { cwd, taskId, confirmationTarget: decision.confirmationTarget }
          : { cwd, taskId, agentId: decision?.provider ?? null, model: decision?.model ?? null };
        return runAction(label, () => service.executePlan(request));
      },
      onCancel: (taskId) => {
        return runAction("Cancelling run", () => service.cancelExecution({ cwd, taskId }));
      },
      onRefresh: () => { return refresh(); },
      onQuit: () => { stop(); }
    }
  });

  // Every transcript entry a real chat CLI shows is worth keeping across a
  // restart the same way plan/task state already is — so every addition
  // goes through this instead of view.addTranscript directly, and gets
  // persisted to `.ai/kairo/transcript.json`. A save failure surfaces on
  // the status line rather than silently losing the message.
  function pushTranscript(role, text) {
    view.addTranscript(role, text);
    service.appendTranscript?.({ cwd, role, text })?.catch((error) => {
      view.setStatus(`Transcript save failed: ${error.message ?? String(error)}`);
    });
  }

  editor.onSubmit = (text) => {
    const task = text.trim();
    if (!task) return;
    if (task.startsWith("/")) {
      const command = task.split(/\s+/)[0].toLowerCase();
      // Echo the command itself into the transcript before acting on it —
      // without this, scrolling back through history is a wall of Kairo-only
      // blocks with no indication of which command produced which one.
      pushTranscript("user", task);
      if (command === "/help") {
        pushTranscript("kairo", "Shift+Tab cycles ASK/PLAN/AGENT · /project interactive overlay (or analyze/analyst/approve/refresh/status subcommands for scripted use) · /plan <task> force a plan · /usage automatic-provider status (Codex/Claude/Go) · /providers all connections incl. Zen/Cursor (manual) · /models CAPABILITY + EFFICIENT picks (--evidence for raw metrics) · /why eligibility detail · /clear · /quit");
      } else if (command === "/usage") {
        for (const line of view.usageLines()) pushTranscript("kairo", line);
      } else if (command === "/providers") {
        for (const line of view.providerLines()) pushTranscript("kairo", line);
      } else if (command === "/status") {
        for (const line of view.providerLines()) pushTranscript("kairo", line);
        pushTranscript("kairo", view.integrationsLine());
      } else if (command === "/models") {
        // The widgets only show Role -> effective model; /models writes
        // the plain-language why (capability, efficient alternative,
        // fallback), never raw metrics/percentages/ids/sources. Those
        // stay behind the explicit --evidence flag for technical audit.
        const flag = task.slice(command.length).trim();
        const explainLines = flag === "--evidence" ? view.aiTeamDetailLines() : view.modelsExplainLines();
        for (const line of explainLines) pushTranscript("kairo", line);
      } else if (command === "/why") {
        // Drill-down for FIT: which providers were excluded and the exact
        // real reason (quota, availability, PAYG/manual-only policy).
        for (const line of view.fitWhyLines()) pushTranscript("kairo", line);
      } else if (command === "/project") {
        const args = task.slice(command.length).trim().split(/\s+/).filter(Boolean);
        const sub = args[0]?.toLowerCase() ?? "";
        if (!sub) {
          // Bare `/project`: the interactive overlay — real preflight ->
          // select analyst -> confirm -> analyze -> result -> approve,
          // driven by the exact same service calls as the subcommands
          // below. The subcommands themselves stay untouched for scripted/
          // non-interactive use.
          openProjectOverlay({ tui, service, view, cwd, onNarrate: (text) => pushTranscript("kairo", text) });
          editor.setText("");
          return;
        }
        if (sub === "status") {
          const strategy = view.snapshot?.projectStrategy;
          if (!strategy) {
            pushTranscript("kairo", view.pendingProjectAnalysis
              ? "AWAITING_ANALYST — pick a real Project Analyst with /project analyst quality|efficient --confirm."
              : "Project not analyzed. Use /project analyze for a real, project-specific team.");
          } else {
            const approvedNote = strategy.approvedAt ? ` (approved ${strategy.approvedAt})` : "";
            pushTranscript("kairo", `Status: ${strategy.status.toUpperCase()}${approvedNote}`);
            for (const entry of strategy.qualityTeam ?? []) {
              pushTranscript("kairo", `${entry.role}: ${entry.model ? view.aiTeamLabel(entry.model) : "no eligible option"}`);
            }
          }
        } else if (sub === "analyze") {
          // LOCAL_PREFLIGHT: real, read-only evidence + real Project
          // Analyst alternatives — no provider call yet, no ProjectStrategy
          // created yet (AWAITING_ANALYST). The human still has to pick
          // and confirm before anything runs.
          editor.disableSubmit = true;
          editor.setText("");
          return runAction("Analyzing project locally (read-only)", async () => {
            const preflight = await service.preflightProject({ cwd });
            view.pendingProjectAnalysis = preflight;
            if (!preflight.alternatives.length) {
              pushTranscript("kairo", "No real Project Analyst candidate is available right now (ASK only supports Codex/Claude today).");
              return;
            }
            const lines = preflight.alternatives.map((alt) => `  ${alt.choice}: ${view.aiTeamLabel(alt.model)}`).join("\n");
            pushTranscript("kairo", `Select Project Analyst — real alternatives:\n${lines}\nUse /project analyst quality|efficient --confirm to run it (consumes real quota).`);
          }).finally(() => { editor.disableSubmit = false; });
        } else if (sub === "analyst") {
          const choice = args[1]?.toLowerCase();
          const confirmed = args.includes("--confirm");
          if (choice !== "quality" && choice !== "efficient") {
            pushTranscript("kairo", "Usage: /project analyst quality|efficient [--confirm]");
            editor.setText("");
            return;
          }
          if (!view.pendingProjectAnalysis) {
            pushTranscript("kairo", "Nothing awaiting a Project Analyst choice. Run /project analyze first.");
            editor.setText("");
            return;
          }
          const alternative = view.pendingProjectAnalysis.alternatives.find((alt) => alt.choice === choice);
          if (!alternative) {
            pushTranscript("kairo", `"${choice}" is not one of the real available alternatives right now.`);
            editor.setText("");
            return;
          }
          if (!confirmed) {
            pushTranscript("kairo", `This will run ${view.aiTeamLabel(alternative.model)} read-only against your project and consume real quota from that provider. Run again with --confirm to proceed: /project analyst ${choice} --confirm`);
            editor.setText("");
            return;
          }
          editor.disableSubmit = true;
          editor.setText("");
          return runAction(`Analyzing with ${view.aiTeamLabel(alternative.model)} (read-only)`, async () => {
            const { profile, candidates } = view.pendingProjectAnalysis;
            const result = await service.runBootstrapAnalysis({ cwd, profile, candidates, analyst: alternative });
            view.pendingProjectAnalysis = null;
            pushTranscript("kairo", `Suggested project team ready (${result.activeRoles.length} real role${result.activeRoles.length === 1 ? "" : "s"}). Use /project approve to activate.`);
          }).finally(() => { editor.disableSubmit = false; });
        } else if (sub === "approve") {
          editor.disableSubmit = true;
          editor.setText("");
          return runAction("Approving project strategy", async () => {
            await service.approveProjectStrategy({ cwd });
            pushTranscript("kairo", "Project team is now ACTIVE.");
          }).finally(() => { editor.disableSubmit = false; });
        } else if (sub === "refresh") {
          editor.disableSubmit = true;
          editor.setText("");
          return runAction("Refreshing project strategy", async () => {
            const result = await service.refreshProjectStrategy({ cwd });
            pushTranscript("kairo", result ? `Project strategy is now ${result.status.toUpperCase()}.` : "Nothing to refresh yet — use /project analyze first.");
          }).finally(() => { editor.disableSubmit = false; });
        } else {
          pushTranscript("kairo", "Usage: /project status|analyze|analyst quality|efficient [--confirm]|approve|refresh");
        }
      } else if (command === "/plan") {
        const planTask = task.slice(command.length).trim();
        if (!planTask) {
          pushTranscript("kairo", "Usage: /plan <task description>");
          editor.setText("");
          return;
        }
        // Backward-compatible shortcut: /plan switches WorkMode to PLAN
        // (so subsequent plain messages stay in PLAN too, never silently
        // dropping back to whatever mode was active before) and sends the
        // message immediately — real behavior, never just a label change.
        if (view.workMode !== "plan") {
          view.setWorkMode("plan");
          service.setMode?.({ cwd, mode: "plan" })?.catch((error) => {
            view.setStatus(`Mode change not saved: ${error.message ?? String(error)}`);
          });
        }
        editor.disableSubmit = true;
        editor.setText("");
        return runAction("Asking Codex for a plan", async () => {
          await service.submitArchitecture({ cwd, task: planTask });
          pushTranscript("kairo", "Plan requested from Codex. Review it below, then press a to approve.");
          editor.addToHistory(task);
        }).finally(() => { editor.disableSubmit = false; });
      } else if (command === "/clear") {
        view.clearTranscript();
        service.clearTranscript?.({ cwd })?.catch((error) => {
          view.setStatus(`Transcript clear failed: ${error.message ?? String(error)}`);
        });
      } else if (command === "/quit" || command === "/exit") {
        stop();
      } else {
        pushTranscript("kairo", `Unknown command: ${command}. Try /help.`);
      }
      editor.setText("");
      return;
    }
    pushTranscript("user", task);
    editor.disableSubmit = true;
    // The real WorkMode decides outright — ASK always answers read-only,
    // PLAN/AGENT always create a plan (see service.submitTask) — replacing
    // the old isLikelyQuestion guess with what the user explicitly told
    // Kairo they're doing (Shift+Tab / /plan).
    return runAction("Asking Kairo", async () => {
      const result = await service.submitTask({ cwd, task, mode: view.workMode });
      if (result.kind === "answer") {
        pushTranscript("kairo", `${result.provider}${result.model ? ` · ${result.model}` : ""}: ${result.answer}`);
      } else {
        pushTranscript("kairo", "Plan requested from Codex. Review it below, then press a to approve.");
      }
      editor.setText("");
      editor.addToHistory(task);
    }).finally(() => { editor.disableSubmit = false; });
  };

  // view.hasListFocus gates whether the footer claims "a approve · j reject
  // · x implement" — those keys only actually do that while the list has
  // focus; while typing, the same letters just become message text (e.g.
  // pressing "j" to reject, with the composer focused, submits a task
  // literally named "j" instead of rejecting anything).
  function focusEditor() { tui.setFocus(editor); view.hasListFocus = false; }
  function focusList() { tui.setFocus(view); view.hasListFocus = true; }

  if (isViewportTUI(tui)) {
    // Real scroll: the dashboard (USAGE/AI TEAM/EFFICIENT TEAM + footer)
    // and composer/editor stay fixed; only the conversation scrolls, via
    // pi-tui's own ScrollView — it owns viewport windowing, PageUp/
    // PageDown/Home/End, mouse wheel, scrollbar drag, and follow-the-end
    // behavior natively (see scroll-view.js / layout.js), so none of that
    // is reimplemented here.
    tui.setLayoutRoot(buildViewportLayoutRoot(view, editor));
  } else {
    // Test doubles and older pi-tui versions retain the stacked,
    // monolithic-render fallback (view.render() -> renderWorkspace()).
    tui.addChild(view);
    tui.addChild(editor);
  }
  focusEditor();
  // Safety net: raw mode intercepts Ctrl+C before it becomes SIGINT, so make
  // sure the cockpit always exits cleanly even if focus is ever lost. Tab
  // toggles focus between the task input and the plan/run list, ahead of
  // whichever component is currently focused.
  tui.addInputListener?.((data) => {
    if (matchesKey(data, "ctrl+c")) { stop(); return { consume: true }; }
    // Shift+Tab cycles the real WorkMode (ASK -> PLAN -> AGENT -> ASK);
    // plain Tab keeps its existing job (focus toggle) — reserved for
    // autocomplete later, per the plan's own assumption, never repurposed
    // here. Persisting the new mode is pure local state (no provider I/O),
    // so this stays instant even if the write is still in flight.
    if (matchesKey(data, "shift+tab")) {
      const next = CockpitView.nextWorkMode(view.workMode);
      view.setWorkMode(next);
      service.setMode?.({ cwd, mode: next })?.catch((error) => {
        view.setStatus(`Mode change not saved: ${error.message ?? String(error)}`);
      });
      return { consume: true };
    }
    if (matchesKey(data, "tab")) {
      if (tui.getFocusedComponent?.() === editor) focusList(); else focusEditor();
      tui.requestRender();
      return { consume: true };
    }
    return undefined;
  });

  // Load persisted chat history and the real KairoSession (currently just
  // WorkMode) before the first render, so a restart never shows an empty
  // chat or silently resets back to ASK while STATUS still shows a task
  // from before it.
  try {
    view.loadTranscript(await service.loadTranscript?.({ cwd }));
  } catch (error) {
    view.setStatus(`Transcript load failed: ${error.message ?? String(error)}`);
  }
  try {
    const session = await service.getSession?.({ cwd });
    if (session?.mode) view.setWorkMode(session.mode);
  } catch (error) {
    view.setStatus(`Session load failed: ${error.message ?? String(error)}`);
  }
  await refresh();
  tui.start();
  timer = setIntervalImpl(() => refresh(), pollIntervalMs);
  spinnerTimer = setIntervalImpl(() => view.tickSpinner(), spinnerIntervalMs);

  return { tui, view, editor, stop, done, refresh };
}
