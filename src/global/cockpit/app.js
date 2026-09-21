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
 * @returns {Promise<{ tui: object, view: CockpitView, stop: () => void, done: Promise<void>, ready: Promise<void>, refresh: () => Promise<void> }>}
 */
export async function runCockpitApp({
  cwd,
  sessionId: explicitSessionId = null,
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
  // The real, active session id for this run — resolved once, right before
  // the transcript/session load below, via service.resolveActiveSession
  // (today: "pick up the most recently updated real session, or create one").
  // Every transcript/ASK-history/WorkMode call below is scoped to it once
  // it's set; null only for the brief window before that resolution runs.
  let sessionId = explicitSessionId;
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

  async function performRefresh() {
    try {
      const snapshot = await service.snapshot({ cwd, sessionId });
      view.setSnapshot(snapshot);
      view.setRowsFromTimeline(snapshot.timeline);
      await tailActiveRunTranscripts(snapshot.timeline);
    } catch (error) {
      view.setStatus(`Refresh failed: ${error.message ?? String(error)}`);
    }
  }

  // Serializes real snapshot() calls — the interval timer, every runAction,
  // the onRefresh key, and the initial background hydration below can all
  // request a refresh at once, and two concurrent service.snapshot() calls
  // racing would let an older, slower one overwrite the view with stale
  // data after a newer one already rendered. At most one real cycle runs
  // at a time; any refresh() requested while one is in flight coalesces
  // into a single queued follow-up (never an unbounded backlog) that starts
  // right after the current cycle finishes, so every caller still
  // eventually gets a real refresh covering their request.
  let inFlight = null;
  let pending = null;

  function startRefreshCycle() {
    pending = null;
    inFlight = performRefresh().finally(() => { inFlight = null; });
    return inFlight;
  }

  function refresh() {
    if (inFlight) {
      if (!pending) pending = inFlight.then(startRefreshCycle, startRefreshCycle);
      return pending;
    }
    return startRefreshCycle();
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
          const plan = await service.showPlan({ cwd, taskId, sessionId });
          view.showDetail(taskId, plan.planMarkdown || plan.taskMarkdown || "(no plan markdown yet)");
        });
      },
      onApprove: (taskId) => {
        return runAction("Approving", () => service.decidePlan({ cwd, taskId, decision: "approved", sessionId }));
      },
      onReject: (taskId) => {
        return runAction("Rejecting", () => service.decidePlan({ cwd, taskId, decision: "rejected", sessionId }));
      },
      onRequestExecute: (taskId, role) => {
        // `role` comes from the view's own role picker (view.js's
        // projectTeamRoles()/showRoleSelect) — always the user's own
        // explicit choice from the active ProjectStrategy's real team,
        // never inferred here or anywhere else from the task's text.
        // PROJECT TEAM is the sole authority for execution: this is only
        // ever called once a real role has been picked (see view.js's
        // handleListInput — 'x' never calls this without one).
        return runAction("Asking PROJECT TEAM who should execute this", async () => {
          const decision = await service.planExecution({ cwd, taskId, role, sessionId });
          // WAIT_FOR_PROJECT_TEAM with a real suggested alternative: the
          // human already explicitly asked for this task to execute now
          // (picked the role, pressed execute) — the assigned model just
          // isn't the one that got them there. Kairo runs the real,
          // currently-eligible fallback automatically, with zero extra
          // y/n gate, and narrates the substitution into the transcript
          // so it stays visible even without a confirm prompt. Every
          // other decision (ROUTED, MANUAL_HANDOFF, or WAIT_FOR_PROJECT_TEAM
          // with no real alternative) is unchanged — still an explicit
          // confirm step.
          if (decision.decision === "WAIT_FOR_PROJECT_TEAM" && decision.confirmationTarget?.selection === "suggested-alternative") {
            const blockedLabel = decision.blockedAssignment?.model?.displayName ?? decision.blockedAssignment?.model?.modelId ?? decision.blockedAssignment?.provider ?? "the assigned model";
            const alt = decision.suggestedAlternative;
            const altLabel = alt?.model?.displayName ?? alt?.model?.modelId ?? "unknown model";
            pushTranscript("kairo", `${blockedLabel} is unavailable for ${decision.role} — automatically falling back to ${alt?.provider} · ${altLabel}.`);
            await service.executePlan({ cwd, taskId, confirmationTarget: decision.confirmationTarget, sessionId });
            return;
          }
          view.showExecuteConfirm(taskId, decision);
          // MANUAL_HANDOFF: Kairo can't launch this itself, so the real
          // task text (the exact same one an automatic run would get —
          // see service.js's buildExecutionTaskPrompt) goes into the
          // transcript, ready to paste into the assigned provider's own
          // chat — never just naming the model and leaving the human to
          // reconstruct the prompt themselves.
          if (decision.decision === "MANUAL_HANDOFF" && decision.taskPrompt) {
            const modelLabel = decision.modelRef?.displayName ?? decision.model ?? "the assigned model";
            pushTranscript("kairo", `${decision.provider} · ${modelLabel} can't be launched automatically — paste this into its chat:\n\n${decision.taskPrompt}`);
          }
        });
      },
      onExecute: (taskId, decision) => {
        const label = decision?.provider ? `Executing with ${decision.provider}` : "Executing";
        // executePlan revalidates the confirmationTarget against a
        // freshly recomputed route before ever reserving quota or
        // launching (see service.js's own doc) — there is no free-form
        // agentId/model override anymore.
        return runAction(label, () => service.executePlan({ cwd, taskId, confirmationTarget: decision?.confirmationTarget, sessionId }));
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
    service.appendTranscript?.({ cwd, role, text, sessionId })?.catch((error) => {
      view.setStatus(`Transcript save failed: ${error.message ?? String(error)}`);
    });
  }

  editor.onSubmit = async (text) => {
    const task = text.trim();
    if (!task) return;
    if (task.startsWith("/")) {
      const command = task.split(/\s+/)[0].toLowerCase();
      // Echo the command itself into the transcript before acting on it —
      // without this, scrolling back through history is a wall of Kairo-only
      // blocks with no indication of which command produced which one.
      pushTranscript("user", task);
      if (command === "/help") {
        pushTranscript("kairo", "Shift+Tab cycles ASK/PLAN/AGENT · /project interactive overlay (or analyze/analyst/approve/refresh/status/cursor exhausted|available subcommands for scripted use) · /plan <task> force a plan · /usage automatic-provider status (Codex/Claude/Go) · /providers all connections incl. Zen/Cursor (manual) · /models CAPABILITY + EFFICIENT picks (--evidence for raw metrics; --verify-access [--refresh] for Claude entitlement) · /why eligibility detail · /clear · /quit");
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
        // --verify-access [--refresh] is the only path that spawns Claude
        // entitlement probes (never on snapshot / first poll).
        const flags = new Set(task.slice(command.length).trim().split(/\s+/).filter(Boolean));
        if (flags.has("--verify-access")) {
          const refresh = flags.has("--refresh");
          editor.disableSubmit = true;
          editor.setText("");
          return runAction("Verifying Claude model access", async () => {
            const summary = await service.verifyClaudeEntitlements({
              cwd,
              refresh,
              beforeProbe: ({ costStatement }) => {
                pushTranscript("kairo", costStatement);
              },
              onProgress: ({ modelId, index, total }) => {
                view.beginAction(`Verifying Claude access (${index + 1}/${total}): ${modelId}`);
              }
            });
            const allowed = summary.results.filter((r) => r.status === "allowed").length;
            const denied = summary.results.filter((r) => r.status === "denied").length;
            const unverified = summary.results.filter((r) => r.status === "unverified").length;
            if (summary.probed.length === 0) {
              pushTranscript("kairo", "Claude access already verified for the current catalog (use --refresh to re-probe).");
            } else {
              pushTranscript(
                "kairo",
                `Claude access check: ${summary.probed.length} probed · ${allowed} allowed · ${denied} denied · ${unverified} unverified${summary.persisted ? " · cache updated" : " · cache unchanged"}.`
              );
            }
          }).finally(() => { editor.disableSubmit = false; });
        }
        const explainLines = flags.has("--evidence") ? view.aiTeamDetailLines() : view.modelsExplainLines();
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
            pushTranscript("kairo", "Project not analyzed. Use /project analyze for a real, project-specific team.");
          } else {
            const approvedNote = strategy.approvedAt ? ` (approved ${strategy.approvedAt})` : "";
            pushTranscript("kairo", `Status: ${strategy.status.toUpperCase()}${approvedNote}`);
            // The real operational team, same as the dashboard panel and
            // the /project overlay — never qualityTeam (comparative
            // reference only), so /project status never disagrees with
            // what's actually running.
            for (const entry of strategy.projectTeam ?? strategy.qualityTeam ?? []) {
              pushTranscript("kairo", `${entry.role}: ${entry.model ? view.aiTeamLabel(entry.model) : "no eligible option"}`);
            }
          }
        } else if (sub === "analyze") {
          // The SAME overlay used for first analysis and in-overlay
          // re-analysis. `forceReanalyze` bypasses an existing strategy at
          // construction time, so startup performs exactly one preflight.
          openProjectOverlay({
            tui, service, view, cwd, forceReanalyze: true,
            onNarrate: (text) => pushTranscript("kairo", text)
          });
          editor.setText("");
          return;
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
        } else if (sub === "cursor") {
          // Cursor exposes no real, zero-cost local usage read (see
          // execution-router.js's checkCandidate doc) — this manual toggle
          // is the only way Kairo learns its quota state, ever. Never
          // auto-detected, never inferred from a failed run.
          const state = args[1]?.toLowerCase();
          if (state !== "exhausted" && state !== "available") {
            pushTranscript("kairo", "Usage: /project cursor exhausted|available");
            editor.setText("");
            return;
          }
          editor.setText("");
          return runAction(`Marking Cursor ${state}`, async () => {
            await service.setCursorManualQuota({ exhausted: state === "exhausted" });
            pushTranscript("kairo", state === "exhausted"
              ? "Cursor marked out of credits — excluded from team suggestions until you run /project cursor available."
              : "Cursor marked available again — back in team suggestions.");
          });
        } else {
          pushTranscript("kairo", "Usage: /project status|analyze|approve|refresh|cursor exhausted|available");
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
          service.setMode?.({ cwd, mode: "plan", sessionId })?.catch((error) => {
            view.setStatus(`Mode change not saved: ${error.message ?? String(error)}`);
          });
        }
        editor.disableSubmit = true;
        editor.setText("");
        return runAction("Asking Codex for a plan", async () => {
          await service.submitArchitecture({ cwd, task: planTask, sessionId });
          pushTranscript("kairo", "Plan requested from Codex. Review it below, then press a to approve.");
          editor.addToHistory(task);
        }).finally(() => { editor.disableSubmit = false; });
      } else if (command === "/clear") {
        view.clearTranscript();
        service.clearTranscript?.({ cwd, sessionId })?.catch((error) => {
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
    //
    // Kairo is the system, never the thing actually answering — a real
    // adapter (Codex, Claude, …) always is, and that real name should be
    // visible from the moment the wait starts, not just in a successful
    // result or leaked incidentally through an error message. PLAN/AGENT
    // is deterministically Codex (see submitArchitecture/createPlan), so
    // that label needs no extra call; ASK's real provider depends on
    // current quota/eligibility, so a cheap planAsk preview (the same
    // routing submitTask itself will use, its probes cached — see
    // service.js's planAsk doc) resolves it first. A caller that predates
    // planAsk (or a preview that itself fails) falls back to the old
    // generic label rather than ever blocking the real submit on it.
    const mode = view.workMode;
    let askLabel = "Asking Kairo";
    if (mode === "plan" || mode === "agent") {
      askLabel = "Asking Codex to plan";
    } else {
      try {
        const preview = await service.planAsk?.({ cwd, task });
        if (preview?.decision?.decision === "ROUTED") {
          const provider = preview.decision.provider;
          const providerLabel = provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : null;
          if (providerLabel) {
            askLabel = `Asking ${providerLabel}${preview.decision.model ? ` · ${preview.decision.model}` : ""}`;
          }
        }
      } catch {
        // Best-effort label only — a real routing failure still surfaces
        // through submitTask itself below, never swallowed here.
      }
    }
    return runAction(askLabel, async () => {
      const result = await service.submitTask({ cwd, task, mode: view.workMode, sessionId });
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
      service.setMode?.({ cwd, mode: next, sessionId })?.catch((error) => {
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

  // A real, already-resolved sessionId (from `kairo start`/`resume`) is used
  // as-is — no auto-resolution needed or wanted, since the caller already
  // made the real choice (always-new for start, explicit/picked for
  // resume). Only when none was given (any embedder that predates explicit
  // session selection) does this fall back to resolveActiveSession's own
  // "most recently updated, or create one" policy. A resolution failure
  // leaves sessionId null, which every service call above already treats
  // as "fall back to the legacy project-wide files" — never a hard crash
  // on startup.
  if (!sessionId) {
    try {
      const active = await service.resolveActiveSession?.({ cwd });
      if (active?.id) sessionId = active.id;
    } catch (error) {
      view.setStatus(`Session resolution failed: ${error.message ?? String(error)}`);
    }
  }
  view.setSessionId(sessionId);
  // Load persisted chat history and the real KairoSession (currently just
  // WorkMode) before the first render, so a restart never shows an empty
  // chat or silently resets back to ASK while STATUS still shows a task
  // from before it.
  try {
    view.loadTranscript(await service.loadTranscript?.({ cwd, sessionId }));
  } catch (error) {
    view.setStatus(`Transcript load failed: ${error.message ?? String(error)}`);
  }
  try {
    const session = await service.getSession?.({ cwd, sessionId });
    if (session?.mode) view.setWorkMode(session.mode);
  } catch (error) {
    view.setStatus(`Session load failed: ${error.message ?? String(error)}`);
  }

  // Everything above this point is local, filesystem-only I/O (session
  // resolution, transcript, WorkMode) — fast and already resolved by here.
  // The real snapshot (usage/model-intelligence probes, which can
  // legitimately take up to ~20s — see service.snapshot's own provider TTLs)
  // hydrates in the BACKGROUND, after the TUI is already visible and
  // interactive, never before: a human should never stare at a blank
  // terminal waiting on quota probes just to start typing. The existing
  // beginAction/spinner mechanism (the same one every other in-flight
  // action already uses) covers this window with a compact, real "loading"
  // indicator instead of a static screen. `ready` lets a test or consumer
  // that genuinely needs the first real snapshot wait for it explicitly,
  // without that wait ever blocking startup itself.
  tui.start();
  timer = setIntervalImpl(() => refresh(), pollIntervalMs);
  spinnerTimer = setIntervalImpl(() => view.tickSpinner(), spinnerIntervalMs);

  view.beginAction("Loading usage and model intelligence");
  const ready = refresh().finally(() => view.endAction());

  return { tui, view, editor, stop, done, ready, refresh };
}
