import { Editor, ProcessTerminal, TuiAltScreen, matchesKey } from "@earendil-works/pi-tui";
import { createConversationService } from "../conversation/service.js";
import { CockpitView } from "./view.js";
import { editorTheme } from "./theme.js";

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

  editor.onSubmit = (text) => {
    const task = text.trim();
    if (!task) return;
    if (task.startsWith("/")) {
      const command = task.split(/\s+/)[0].toLowerCase();
      if (command === "/help") {
        view.addTranscript("kairo", "/plan <task> force a plan · /usage provider status · /providers connections · /clear · /quit");
      } else if (command === "/usage" || command === "/providers" || command === "/status") {
        for (const line of command === "/usage" ? view.usageLines() : view.providerLines()) {
          view.addTranscript("kairo", line);
        }
        view.addTranscript("kairo", view.integrationsLine());
      } else if (command === "/plan") {
        const planTask = task.slice(command.length).trim();
        if (!planTask) {
          view.addTranscript("kairo", "Usage: /plan <task description>");
          editor.setText("");
          return;
        }
        view.addTranscript("user", planTask);
        editor.disableSubmit = true;
        editor.setText("");
        return runAction("Asking Codex for a plan", async () => {
          await service.submitArchitecture({ cwd, task: planTask });
          view.addTranscript("kairo", "Plan requested from Codex. Review it below, then press a to approve.");
          editor.addToHistory(task);
        }).finally(() => { editor.disableSubmit = false; });
      } else if (command === "/clear") {
        view.clearTranscript();
      } else if (command === "/quit" || command === "/exit") {
        stop();
      } else {
        view.addTranscript("kairo", `Unknown command: ${command}. Try /help.`);
      }
      editor.setText("");
      return;
    }
    view.addTranscript("user", task);
    editor.disableSubmit = true;
    return runAction("Asking Kairo", async () => {
      const result = await service.submitTask({ cwd, task });
      if (result.kind === "answer") {
        view.addTranscript("kairo", `${result.provider}${result.model ? ` · ${result.model}` : ""}: ${result.answer}`);
      } else {
        view.addTranscript("kairo", "Plan requested from Codex. Review it below, then press a to approve.");
      }
      editor.setText("");
      editor.addToHistory(task);
    }).finally(() => { editor.disableSubmit = false; });
  };

  function focusEditor() { tui.setFocus(editor); }
  function focusList() { tui.setFocus(view); }

  tui.addChild(view);
  tui.addChild(editor);
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

  await refresh();
  tui.start();
  timer = setIntervalImpl(() => refresh(), pollIntervalMs);

  return { tui, view, editor, stop, done, refresh };
}
