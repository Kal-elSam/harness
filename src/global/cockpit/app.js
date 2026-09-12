import { Editor, ProcessTerminal, TuiAltScreen, VStack, isViewportTUI, matchesKey } from "@earendil-works/pi-tui";
import { createConversationService } from "../conversation/service.js";
import { CockpitView } from "./view.js";
import { editorTheme, theme } from "./theme.js";
import { CARD_TONE, cardTop } from "./card.js";

// The composer is otherwise just two flat, muted rules from pi-tui's Editor
// (no title, no corners) — easy to miss right under the cockpit's colorful
// framed cards. This title bar gives it the same rounded-corner, titled
// look as the rest of the cockpit so it reads as its own zone: a blank
// spacer row separates it from whatever is above (SESSION), then the title
// sits directly on top of the editor's own rule with no gap, so the two
// read as one continuous framed box rather than two disconnected pieces.
function composerHeader(width) {
  return ["", cardTop("Message Kairo", CARD_TONE.SUCCESS, theme, width)];
}

const DEFAULT_POLL_MS = 2000;

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
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval
} = {}) {
  const terminal = terminalFactory();
  const tui = tuiFactory(terminal);
  const editor = editorFactory(tui);

  let timer = null;
  let stopped = false;
  let resolveDone;
  const done = new Promise((resolvePromise) => { resolveDone = resolvePromise; });

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer) clearIntervalImpl(timer);
    tui.stop();
    resolveDone();
  }

  async function refresh() {
    try {
      const snapshot = await service.snapshot({ cwd });
      view.setSnapshot(snapshot);
      view.setRowsFromTimeline(snapshot.timeline);
    } catch (error) {
      view.setStatus(`Refresh failed: ${error.message ?? String(error)}`);
    }
  }

  async function runAction(label, fn) {
    try {
      view.setStatus(`${label}…`);
      await fn();
      view.setStatus("");
      await refresh();
    } catch (error) {
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
        runAction("Loading plan", async () => {
          const plan = await service.showPlan({ cwd, taskId });
          view.showDetail(taskId, plan.planMarkdown || plan.taskMarkdown || "(no plan markdown yet)");
        });
      },
      onApprove: (taskId) => {
        runAction("Approving", () => service.decidePlan({ cwd, taskId, decision: "approved" }));
      },
      onReject: (taskId) => {
        runAction("Rejecting", () => service.decidePlan({ cwd, taskId, decision: "rejected" }));
      },
      onRequestExecute: (taskId) => {
        runAction("Asking the router who should execute this", async () => {
          const decision = await service.planExecution({ cwd, taskId });
          view.showExecuteConfirm(taskId, decision);
        });
      },
      onExecute: (taskId, decision) => {
        const label = decision?.provider ? `Executing with ${decision.provider}` : "Executing";
        runAction(label, () => service.executePlan({
          cwd, taskId, agentId: decision?.provider ?? null, model: decision?.model ?? null
        }));
      },
      onCancel: (taskId) => {
        runAction("Cancelling run", () => service.cancelExecution({ cwd, taskId }));
      },
      onRefresh: () => { refresh(); },
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
      if (command === "/help") {
        pushTranscript("kairo", "/plan <task> force a plan · /usage provider status · /providers connections · /models model signals · /why eligibility detail · /clear · /quit");
      } else if (command === "/usage" || command === "/providers" || command === "/status") {
        for (const line of command === "/usage" ? view.usageLines() : view.providerLines()) {
          pushTranscript("kairo", line);
        }
        pushTranscript("kairo", view.integrationsLine());
      } else if (command === "/models") {
        // MODEL SIGNALS renders in the widget; /models also writes its factual
        // global evidence summary to the chat transcript.
        for (const line of view.fitLines()) pushTranscript("kairo", line);
      } else if (command === "/why") {
        // Drill-down for FIT: which providers were excluded and the exact
        // real reason (quota, availability, PAYG/manual-only policy).
        for (const line of view.fitWhyLines()) pushTranscript("kairo", line);
      } else if (command === "/plan") {
        const planTask = task.slice(command.length).trim();
        if (!planTask) {
          pushTranscript("kairo", "Usage: /plan <task description>");
          editor.setText("");
          return;
        }
        pushTranscript("user", planTask);
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
    return runAction("Asking Kairo", async () => {
      const result = await service.submitTask({ cwd, task });
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
    tui.setLayoutRoot(new VStack([
      { component: view, grow: 1, minSize: 4 },
      { component: { render: composerHeader }, basis: 2, shrink: 0 },
      { component: editor, basis: 3, shrink: 0 }
    ], { gap: 0 }));
  } else {
    // Test doubles and older pi-tui versions retain the stacked fallback.
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
    if (matchesKey(data, "tab")) {
      if (tui.getFocusedComponent?.() === editor) focusList(); else focusEditor();
      tui.requestRender();
      return { consume: true };
    }
    return undefined;
  });

  // Load persisted chat history before the first render so a restart never
  // shows an empty chat while STATUS still shows a task from before it.
  try {
    view.loadTranscript(await service.loadTranscript?.({ cwd }));
  } catch (error) {
    view.setStatus(`Transcript load failed: ${error.message ?? String(error)}`);
  }
  await refresh();
  tui.start();
  timer = setIntervalImpl(() => refresh(), pollIntervalMs);

  return { tui, view, editor, stop, done, refresh };
}
