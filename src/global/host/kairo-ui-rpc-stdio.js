/**
 * Thin JSONL sidecar: Rust kairo-ui ↔ openPiRpcBridge ↔ Pi RPC.
 *
 * stdin commands (one JSON object per LF-terminated line):
 *   { "op": "prompt", "message": "..." }  — U4a: routes through service.submitTask
 *     with the active session's WorkMode (ask|plan|agent); never Pi `prompt`
 *   { "op": "set_mode", "mode": "ask"|"plan"|"agent" }  — persist under activeKairoSessionId
 *   { "op": "plans.list" }  — U4b: timeline via service.snapshot (session-scoped)
 *   { "op": "plans.show", "taskId": "..." }  — U4b: showPlan (taskMarkdown+planMarkdown)
 *   { "op": "plans.decide", "taskId": "...", "decision": "approved"|"rejected" }
 *     — U4b: decidePlan + refresh list; never executePlan / planExecution
 *   { "op": "plans.preview", "taskId": "...", "role": "..." }  — U4c: planExecution preview
 *     WAIT_FOR_PROJECT_TEAM + suggested-alternative auto-calls executePlan (cockpit parity)
 *   { "op": "plans.execute", "taskId": "...", "confirmationTarget": {...} }  — U4c: executePlan
 *   { "op": "plans.cancel", "taskId": "..." }  — U4c: cancelExecution
 *   { "op": "plans.transcript", "runId": "...", "sinceIndex"?: number }  — U4c: readRunTranscript
 *   { "op": "slash.info", "kind": "usage"|"providers"|"status"|"models"|"why",
 *     "evidence"?: bool, "verifyAccess"?: bool, "refresh"?: bool }  — U4d diagnostics
 *   { "op": "slash.clear" }  — U4d: clearTranscript for active session
 *   { "op": "slash.project_status" }  — U4d: /project status lines
 *   { "op": "ops.snapshot" }  — U5a/U5b: Operations hub (+ runs/alerts/reviews/backups)
 *   { "op": "ops.sync.preview" }  — U5b: governance sync dry-run preview
 *   { "op": "ops.sync.apply", "preview": {...} }  — U5b: apply confirmed sync preview
 *   { "op": "ops.rollback.preview", "snapshot": "..." }  — U5b: rollback preview
 *   { "op": "ops.rollback.apply", "preview": {...} }  — U5b: apply confirmed rollback
 *   { "op": "ops.runs.cancel", "runId": "..." }  — U5b: cancel a cancellable run
 *   { "op": "ops.alerts.dismiss", "alertId": "...", "confirmed": true }  — U5b
 *   { "op": "settings.snapshot" }  — U5b: profile/integrations/connections (+ setup stub)
 *   { "op": "settings.integration.confirm", "id": "..." }  — U5b: curated intent receipt (no install)
 *   { "op": "project.refresh" }  — U4d: refreshProjectStrategy
 *   { "op": "team.edit.catalog", "role": "..." }  — U4d: getProjectTeamEditCatalog
 *   { "op": "team.edit.assign", "role": "...", "candidateKey": "..." }  — U4d: setProjectTeamAssignment (SUGGESTED only)
 *   { "op": "abort" }
 *   { "op": "compact" }
 *   { "op": "cycle_model" }
 *   { "op": "new_session", "draft"?: "<unsent editor text for the current active Kairo id>" }
 *   { "op": "switch_session", "sessionPath": "...", "draft"?: "<...>" }
 *   { "op": "switch_session_index", "index": 0, "draft"?: "<...>" }
 *   { "op": "list_sessions" }
 *   { "op": "reload_snapshot" }
 *   { "op": "project.preflight" }
 *   { "op": "project.analyze", "analyst"?: { model, selectionSource, recommendationTags, choice } }
 *   { "op": "team.approve" }
 *   { "op": "team.revalidate" }
 *   { "op": "team.recovery.preview" }
 *   { "op": "team.recovery.apply" }
 *   { "op": "team.recovery.reject" }
 *   { "op": "rename_session", "name": "..." }
 *   { "op": "fork_session", "draft"?: "<...>" }
 *   { "op": "extension_ui_response", "id": "<same id as extension_ui_request>", "value"|"confirmed"|"cancelled": ... }
 *   { "op": "stop", "draft"?: "<unsent editor text, saved under the active Kairo session id>" }
 *
 * Sessions (U3a): each entry in `sessions` / the `ready.sessions` array
 * carries `kairoSessionId` — the real Kairo session id (`kairo list` /
 * `kairo resume`'s own id, from `pi-session-bindings.js`) bound to that Pi
 * session file, or `null` when it was never bound (e.g. created outside
 * `kairo start`/`resume`). On startup, when `KAIRO_SESSION_ID` names a real
 * session bound to one of these Pi files, the sidecar switches Pi to that
 * exact file before emitting `ready` — `kairo resume <id>` reopens the same
 * transcript the picker/labels agree is bound to that id, not a fresh
 * no-session Pi start. `ready.draft` carries any unsent editor text saved
 * for that same Kairo session (see `saveDraft`/`loadDraft`), or `null`.
 *
 * Active identity (U3a close): `activeKairoSessionId` starts from env
 * `KAIRO_SESSION_ID` (after the resume auto-switch above) and updates only
 * on a successful switch/new/fork. Outgoing `draft` on those ops is saved
 * under the *current* active id BEFORE the transition. After success the
 * sidecar emits `{ type: "draft", text, kairoSessionId }` (empty text for
 * New/Fork; destination load for Switch). Cancel keeps the prior active
 * id and never loads a destination draft. Fork mints a new Kairo session
 * + `recordPiBinding`; a binding failure after clone is fail-closed:
 * active becomes unbound (`null`) — never falls back to saving the fork's
 * editor under the previous id. `stop` always persists under the active id
 * (not the boot env alone).
 *
 * stdout records (JSONL): { type: "ready", engine, snapshot?, kairoModels?, sessions?, draft? },
 * { type: "mode", mode } (ask|plan|agent — emitted on ready/switch/new/fork/set_mode),
 * { type: "task_result", kind: "answer"|"plan", ... } (U4a submitTask outcome; never execute),
 * { type: "plans", timeline, projectTeamRoles? } (U4b/U4c list / post-decide / post-exec refresh),
 * { type: "plan_detail", taskId, taskMarkdown, planMarkdown, state, ... } (U4b show),
 * { type: "plan_decision", taskId, decision, state, ... } (U4b decide),
 * { type: "plan_preview", taskId, decision, confirmationTarget, taskPrompt, autoExecuted, ... } (U4c),
 * { type: "plan_execute", taskId, execution?, autoExecuted?, ... } (U4c),
 * { type: "plan_cancel", taskId, ... } (U4c),
 * { type: "run_transcript", runId, nextIndex, entries } (U4c),
 * { type: "slash_lines", kind, lines } (U4d),
 * { type: "ops_snapshot", ok, error, health, fleet, usage, diagnostics, runs, alerts, reviews, backups, hints } (U5a/U5b),
 * { type: "ops_sync_preview"|"ops_sync_result"|"ops_rollback_preview"|"ops_rollback_result"|"ops_run_cancel"|"ops_alert_dismiss", ... } (U5b),
 * { type: "settings_snapshot"|"settings_integration_result", ... } (U5b),
 * { type: "team_edit_catalog", role, models, currentCandidateKey?, recommendedCandidateKey? } (U4d),
 * { type: "team_edit_saved", role, strategy } (U4d),
 * { type: "engine", engine }, { type: "transcript", messages }, { type: "sessions", sessions },
 * { type: "draft", text, kairoSessionId }, { type: "kairoModels", kairoModels },
 * { type: "team", op, ok, state, teamRows, roles, analyst },
 * { type: "preflight", ok, analystCatalog?, profile?, candidates?, reason? } (the ratatui host's own
 * analyst picker — T2, no cockpit), { type: "availability", ok, reason? } (real re-probe result for
 * `team.revalidate`, followed by a fresh `snapshot`), { type: "recovery", op: "preview"|"apply"|"reject",
 * outcome, ...} (team-recovery.js's own outcomes — "proposed"/"activated"/"approved"/"rejected"/
 * "kept-previous"/"skipped"/"baseline"/"error" — never invented; a stale/refused apply comes back as
 * outcome:"error" and touches nothing), forwarded Pi session events (including
 * `extension_ui_request`), { type: "error", message }, and bridge engine_unavailable.
 *
 * Extension UI (U3b): Pi dialog methods emit `extension_ui_request` (forwarded
 * verbatim). The host answers with `{ op: "extension_ui_response", id, ... }` —
 * written to Pi stdin via `bridge.sendRaw` (never `bridge.request`), preserving
 * the original request `id`. Notify / setStatus / setTitle are fire-and-forget
 * (no response required).
 */

import { fileURLToPath } from "node:url";
import {
  openPiRpcBridge,
  classifyPiEngineFromState,
  resolveArchitectRouteForRpc
} from "./pi-rpc-bridge.js";
import {
  loadKairoWorkspaceSnapshot,
  revalidateKairoTeamAvailability as revalidateTeamAvailabilityImpl,
  recoverKairoProjectTeam as recoverProjectTeamImpl,
  approveKairoRecovery as approveRecoveryProposalImpl,
  rejectKairoRecovery as rejectRecoveryProposalImpl
} from "./workspace-snapshot.js";
import { loadKairoProviderModels } from "./kairo-route-provider.js";
import {
  analyzeProjectTeam as analyzeProjectTeamImpl,
  approveProjectTeam as approveProjectTeamImpl,
  preflightProjectTeam as preflightProjectTeamImpl
} from "./project-team-sidecar.js";
import { buildOpsSnapshot } from "./ops-sidecar.js";
import {
  applyOpsRollback,
  applyOpsSync,
  cancelOpsRun,
  dismissOpsAlert,
  previewOpsRollback,
  previewOpsSync
} from "./ops-mutations.js";
import { buildSettingsSnapshot } from "./settings-sidecar.js";
import {
  getCuratedIntegration,
  reduceSettingsAction,
  createSettingsActionState
} from "../ink/cockpit-settings.js";
import { listPiSessionFilesForCwd } from "./pi-rpc-sessions.js";
import { mapPiMessagesToTranscriptRows } from "./pi-rpc-transcript.js";
import {
  formatEngineModelLabel,
  kairoSetModelCommand,
  pickNextKairoModel
} from "./pi-rpc-kairo-models.js";
import { resolveHomeDir } from "../paths.js";
import { resolveProjectRoot as resolveProjectRootDefault } from "../architect/architect-store.js";
import {
  lookupPiBinding as lookupPiBindingDefault,
  recordPiBinding as recordPiBindingDefault
} from "../conversation/pi-session-bindings.js";
import {
  createSession as createSessionDefault,
  getSession as getSessionDefault,
  isValidSessionId,
  loadDraft as loadDraftDefault,
  saveDraft as saveDraftDefault
} from "../conversation/session-registry.js";
import { createConversationService } from "../conversation/service.js";
import { CockpitView } from "../cockpit/view.js";
import {
  appendAskRecord,
  clearAskEvents,
  readAskTurns
} from "../conversation/ask-events-store.js";
import { mergeAskTurnsIntoRows } from "../conversation/ask-events-restore.js";

/** Fail-closed WorkMode values — same set as session-registry / cockpit. */
const WORK_MODES = new Set(["ask", "plan", "agent"]);

/** Stub actions so CockpitView formatters work without a TUI (U4d slash). */
const SLASH_VIEW_ACTIONS = {
  onShowPlan() {},
  onApprove() {},
  onReject() {},
  onRequestExecute() {},
  onExecute() {},
  onCancel() {},
  onRefresh() {},
  onQuit() {}
};

/**
 * Build cockpit-parity diagnostic lines from a conversation snapshot.
 * @param {object|null|undefined} snap
 * @param {"usage"|"providers"|"status"|"models"|"why"|"models_evidence"} kind
 * @returns {string[]}
 */
export function slashDiagnosticLines(snap, kind) {
  const view = new CockpitView({ actions: SLASH_VIEW_ACTIONS });
  view.snapshot = snap ?? {};
  switch (kind) {
    case "usage":
      return view.usageLines();
    case "providers":
      return view.providerLines();
    case "status":
      return [...view.providerLines(), view.integrationsLine()];
    case "models_evidence":
      return view.aiTeamDetailLines();
    case "models":
      return view.modelsExplainLines();
    case "why":
      return view.fitWhyLines();
    default:
      return [`Unknown slash diagnostics kind: ${kind}`];
  }
}

/**
 * `/project status` lines from a conversation snapshot.
 * @param {object|null|undefined} snap
 * @returns {string[]}
 */
export function projectStatusLines(snap) {
  const strategy = snap?.projectStrategy;
  if (!strategy) {
    return ["Project not analyzed. Use /project analyze for a real, project-specific team."];
  }
  const approvedNote = strategy.approvedAt ? ` (approved ${strategy.approvedAt})` : "";
  const lines = [`Status: ${String(strategy.status).toUpperCase()}${approvedNote}`];
  const team = strategy.projectTeam ?? strategy.qualityTeam ?? [];
  for (const entry of team) {
    const model = entry?.model;
    const label = model?.displayName ?? model?.modelId ?? model?.id ?? "no eligible option";
    const provider = model?.adapterId ?? model?.provider ?? "";
    lines.push(
      provider ? `${entry.role}: ${provider} · ${label}` : `${entry.role}: ${label}`
    );
  }
  return lines;
}

/** U4b: decidePlan only accepts these — never execute / handoff. */
const PLAN_DECISIONS = new Set(["approved", "rejected"]);

/**
 * Notice after a PLAN/AGENT submitTask plan outcome. Uses y/n (not `a`) so
 * ratatui team analyze (`a`) / approve (`A`) never clash with plan decide.
 */
export const PLAN_REQUESTED_NOTICE =
  "Plan requested from Codex. Press p for plans, then y to approve or n to reject.";

/**
 * @param {unknown} mode
 * @returns {"ask"|"plan"|"agent"}
 */
export function normalizeWorkMode(mode) {
  return WORK_MODES.has(mode) ? mode : "ask";
}

/**
 * Active ProjectStrategy roles only — same gate as cockpit `projectTeamRoles()`.
 * @param {object|null|undefined} snap
 * @returns {string[]}
 */
export function projectTeamRolesFromSnapshot(snap) {
  const strategy = snap?.projectStrategy;
  if (!strategy || strategy.status !== "active" || !Array.isArray(strategy.projectTeam)) {
    return [];
  }
  return strategy.projectTeam
    .map((entry) => (typeof entry?.role === "string" ? entry.role : null))
    .filter(Boolean);
}

/** Lazy default conversation service — reused so probes stay cached. */
let defaultConversationService = null;
function defaultConversation() {
  if (!defaultConversationService) {
    defaultConversationService = createConversationService({ enableProviderProbes: true });
  }
  return defaultConversationService;
}

/**
 * @param {object[]} models
 * @returns {object[]}
 */
export function serializeKairoModelsForHost(models) {
  if (!Array.isArray(models)) return [];
  return models.map((m) => ({
    id: m?.id ?? null,
    name: m?.name ?? null,
    role: m?.kairoRoute?.role ?? null
  }));
}

/**
 * @param {import("./pi-rpc-bridge.js").openPiRpcBridge extends Function ? Awaited<ReturnType<typeof openPiRpcBridge>> : never} bridge
 */
export async function fetchTranscriptRows(bridge) {
  const data = await bridge.request({ type: "get_messages" });
  return mapPiMessagesToTranscriptRows(data?.messages);
}

/**
 * Refresh host engine from Pi `get_state`.
 * When `reapplyArchitect` is true (session create/switch only — never after
 * `cycle_model`), re-select Architect via `resolveArchitectRouteForRpc`.
 *
 * @param {object} bridge
 * @param {string} cwd
 * @param {object} [options]
 * @param {boolean} [options.reapplyArchitect]
 * @param {(args: { cwd: string }) => Promise<object[]>} [options.loadKairoProviderModels]
 * @param {number} [options.connectTimeoutMs]
 */
export async function refreshHostEngine(
  bridge,
  cwd,
  {
    reapplyArchitect = false,
    loadKairoProviderModels: loadModels = loadKairoProviderModels,
    connectTimeoutMs
  } = {}
) {
  const state = await bridge.request({ type: "get_state" });
  const engine = reapplyArchitect
    ? await resolveArchitectRouteForRpc(bridge, {
        cwd,
        loadKairoProviderModels: loadModels,
        connectTimeoutMs,
        initialState: state
      })
    : classifyPiEngineFromState(state);
  bridge.engine = engine;
  return engine;
}

/**
 * @param {object} bridge
 * @param {string} cwd
 * @param {(record: object) => void} writeOut
 */
export async function emitTranscriptFromPi(bridge, cwd, writeOut, { mergeRows } = {}) {
  let rows = await fetchTranscriptRows(bridge);
  if (mergeRows) {
    // Best-effort: a failing merge (e.g. unreadable ASK store) must never cost
    // the human their Pi history.
    try {
      rows = await mergeRows(rows);
    } catch {
      // keep the plain Pi rows
    }
  }
  writeOut({ type: "transcript", messages: rows });
}

/**
 * @param {object} [options]
 * @param {NodeJS.ReadableStream} [options.stdin]
 * @param {NodeJS.WritableStream} [options.stdout]
 * @param {string} [options.cwd]
 * @param {typeof openPiRpcBridge} [options.openBridge]
 * @param {(args: { cwd: string }) => Promise<object[]>} [options.loadKairoProviderModels]
 * @param {(args: { cwd: string }) => Promise<object>} [options.loadSnapshot]
 * @param {typeof analyzeProjectTeamImpl} [options.analyzeProjectTeam]
 * @param {typeof approveProjectTeamImpl} [options.approveProjectTeam]
 * @param {typeof preflightProjectTeamImpl} [options.preflightProjectTeam]
 * @param {typeof revalidateTeamAvailabilityImpl} [options.revalidateTeamAvailability]
 * @param {typeof recoverProjectTeamImpl} [options.recoverProjectTeam]
 * @param {typeof approveRecoveryProposalImpl} [options.approveRecoveryProposal]
 * @param {typeof rejectRecoveryProposalImpl} [options.rejectRecoveryProposal]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof listPiSessionFilesForCwd} [options.listPiSessionFilesForCwd]
 * @param {typeof resolveHomeDir} [options.resolveHomeDir]
 * @param {typeof resolveProjectRootDefault} [options.resolveProjectRoot]
 * @param {typeof lookupPiBindingDefault} [options.lookupPiBinding]
 * @param {typeof recordPiBindingDefault} [options.recordPiBinding]
 * @param {typeof createSessionDefault} [options.createSession]
 * @param {typeof getSessionDefault} [options.getSession]
 * @param {typeof loadDraftDefault} [options.loadDraft]
 * @param {typeof saveDraftDefault} [options.saveDraft]
 * @param {(args: { cwd: string, mode: "ask"|"plan"|"agent", sessionId?: string|null }) => Promise<object>} [options.setMode]
 * @param {(args: { cwd: string, task: string, mode?: string|null, sessionId?: string|null }) => Promise<object>} [options.submitTask]
 * @param {(args: { cwd: string, sessionId?: string|null }) => Promise<object>} [options.snapshot]
 * @param {(args: { cwd: string, taskId: string, sessionId?: string|null }) => Promise<object>} [options.showPlan]
 * @param {(args: { cwd: string, taskId: string, decision: "approved"|"rejected", sessionId?: string|null }) => Promise<object>} [options.decidePlan]
 * @param {(args: { cwd: string, taskId: string, role: string, sessionId?: string|null }) => Promise<object>} [options.planExecution]
 * @param {(args: { cwd: string, taskId: string, confirmationTarget: object, sessionId?: string|null }) => Promise<object>} [options.executePlan]
 * @param {(args: { cwd: string, taskId: string }) => Promise<object>} [options.cancelExecution]
 * @param {(args: { runId: string, sinceIndex?: number }) => Promise<object>} [options.readRunTranscript]
 * @param {(args: { cwd: string, role: string }) => Promise<object>} [options.getProjectTeamEditCatalog]
 * @param {(args: { cwd: string, role: string, candidateKey: string }) => Promise<object>} [options.setProjectTeamAssignment]
 * @param {(args: { cwd: string, sessionId?: string|null }) => Promise<void>} [options.clearTranscript]
 * @param {(args: { cwd: string, refresh?: boolean, beforeProbe?: Function, onProgress?: Function }) => Promise<object>} [options.verifyClaudeEntitlements]
 * @param {(args: { cwd: string }) => Promise<object|null>} [options.refreshProjectStrategy]
 * @param {(args?: object) => Promise<object>} [options.buildOpsSnapshot]
 * @param {(args?: object) => Promise<object>} [options.previewOpsSync]
 * @param {(args?: object) => Promise<object>} [options.applyOpsSync]
 * @param {(args?: object) => Promise<object>} [options.previewOpsRollback]
 * @param {(args?: object) => Promise<object>} [options.applyOpsRollback]
 * @param {(args?: object) => Promise<object>} [options.cancelOpsRun]
 * @param {(args?: object) => Promise<object>} [options.dismissOpsAlert]
 * @param {(args?: object) => Promise<object>} [options.buildSettingsSnapshot]
 */
export async function runKairoUiRpcStdio({
  stdin = process.stdin,
  stdout = process.stdout,
  cwd = process.cwd(),
  env = process.env,
  openBridge = openPiRpcBridge,
  loadKairoProviderModels: loadModels = loadKairoProviderModels,
  loadSnapshot = loadKairoWorkspaceSnapshot,
  analyzeProjectTeam = analyzeProjectTeamImpl,
  approveProjectTeam = approveProjectTeamImpl,
  preflightProjectTeam = preflightProjectTeamImpl,
  revalidateTeamAvailability = revalidateTeamAvailabilityImpl,
  recoverProjectTeam = recoverProjectTeamImpl,
  approveRecoveryProposal = approveRecoveryProposalImpl,
  rejectRecoveryProposal = rejectRecoveryProposalImpl,
  listPiSessionFilesForCwd: listSessionFilesImpl = listPiSessionFilesForCwd,
  resolveHomeDir: resolveHomeDirImpl = resolveHomeDir,
  resolveProjectRoot: resolveProjectRootImpl = resolveProjectRootDefault,
  lookupPiBinding: lookupPiBindingImpl = lookupPiBindingDefault,
  recordPiBinding: recordPiBindingImpl = recordPiBindingDefault,
  createSession: createSessionImpl = createSessionDefault,
  getSession: getSessionImpl = getSessionDefault,
  loadDraft: loadDraftImpl = loadDraftDefault,
  saveDraft: saveDraftImpl = saveDraftDefault,
  setMode: setModeImpl = (args) => defaultConversation().setMode(args),
  submitTask: submitTaskImpl = (args) => defaultConversation().submitTask(args),
  askCancelWaitMs = 5000,
  snapshot: snapshotImpl = (args) => defaultConversation().snapshot(args),
  showPlan: showPlanImpl = (args) => defaultConversation().showPlan(args),
  decidePlan: decidePlanImpl = (args) => defaultConversation().decidePlan(args),
  planExecution: planExecutionImpl = (args) => defaultConversation().planExecution(args),
  executePlan: executePlanImpl = (args) => defaultConversation().executePlan(args),
  cancelExecution: cancelExecutionImpl = (args) => defaultConversation().cancelExecution(args),
  readRunTranscript: readRunTranscriptImpl = (args) => defaultConversation().readRunTranscript(args),
  getProjectTeamEditCatalog: getProjectTeamEditCatalogImpl = (args) =>
    defaultConversation().getProjectTeamEditCatalog(args),
  setProjectTeamAssignment: setProjectTeamAssignmentImpl = (args) =>
    defaultConversation().setProjectTeamAssignment(args),
  clearTranscript: clearTranscriptImpl = (args) => defaultConversation().clearTranscript(args),
  verifyClaudeEntitlements: verifyClaudeEntitlementsImpl = (args) =>
    defaultConversation().verifyClaudeEntitlements(args),
  refreshProjectStrategy: refreshProjectStrategyImpl = (args) =>
    defaultConversation().refreshProjectStrategy(args),
  buildOpsSnapshot: buildOpsSnapshotImpl = buildOpsSnapshot,
  previewOpsSync: previewOpsSyncImpl = previewOpsSync,
  applyOpsSync: applyOpsSyncImpl = applyOpsSync,
  previewOpsRollback: previewOpsRollbackImpl = previewOpsRollback,
  applyOpsRollback: applyOpsRollbackImpl = applyOpsRollback,
  cancelOpsRun: cancelOpsRunImpl = cancelOpsRun,
  dismissOpsAlert: dismissOpsAlertImpl = dismissOpsAlert,
  buildSettingsSnapshot: buildSettingsSnapshotImpl = buildSettingsSnapshot
} = {}) {
  const bridge = await openBridge({ cwd });
  let kairoModels = [];
  try {
    kairoModels = await loadModels({ cwd });
  } catch {
    kairoModels = [];
  }
  let sessionFiles = listSessionFilesImpl({ cwd, env });

  // Kairo session id <-> Pi file binding (U3a). `projectRoot` may fail to
  // resolve (no Git repo, a test cwd that doesn't exist) — every
  // binding-dependent feature below degrades to "unbound" rather than
  // crashing the host over it.
  const homeDir = resolveHomeDirImpl(env);
  let projectRoot = null;
  try {
    projectRoot = await resolveProjectRootImpl(cwd);
  } catch {
    projectRoot = null;
  }
  const envSessionId =
    typeof env?.KAIRO_SESSION_ID === "string" && isValidSessionId(env.KAIRO_SESSION_ID)
      ? env.KAIRO_SESSION_ID
      : null;
  // Active Kairo identity owns drafts for this sidecar process. Starts from
  // the boot env (after the resume auto-switch below) and only moves on a
  // successful switch / new / fork — never on a cancelled transition.
  let activeKairoSessionId = envSessionId;
  // Live WorkMode for prompt routing (U4a). Fail-closed default; restored
  // from the active session document on ready/switch/new/fork.
  let currentMode = "ask";

  /** Attach the real bound Kairo session id (or null) to each Pi file entry. */
  const annotateSessions = async (files) => {
    if (!projectRoot) {
      return files.map(({ path, sessionId, label }) => ({ path, sessionId, label, kairoSessionId: null }));
    }
    const out = [];
    for (const { path, sessionId, label } of files) {
      let kairoSessionId = null;
      if (sessionId) {
        try {
          kairoSessionId = await lookupPiBindingImpl(homeDir, projectRoot, sessionId);
        } catch {
          kairoSessionId = null;
        }
      }
      out.push({ path, sessionId, label, kairoSessionId });
    }
    return out;
  };

  /** Best-effort save of the host's live editor text under the current active id. */
  const persistOutgoingDraft = async (draftField) => {
    if (!activeKairoSessionId || !projectRoot) return;
    const draftText = typeof draftField === "string" ? draftField : "";
    try {
      await saveDraftImpl(homeDir, projectRoot, activeKairoSessionId, draftText);
    } catch {
      // Best-effort — never block a session transition over a failed draft save.
    }
  };

  const lookupKairoIdForPi = async (piSessionId) => {
    if (!projectRoot || !piSessionId) return null;
    try {
      return await lookupPiBindingImpl(homeDir, projectRoot, piSessionId);
    } catch {
      return null;
    }
  };

  /** Emit the draft the host should show for the (new) active Kairo id. */
  const emitActiveDraft = async ({ text = undefined } = {}) => {
    let draftText = text;
    if (draftText === undefined) {
      draftText = "";
      if (activeKairoSessionId && projectRoot) {
        try {
          draftText = (await loadDraftImpl(homeDir, projectRoot, activeKairoSessionId)) ?? "";
        } catch {
          draftText = "";
        }
      }
    }
    writeOut({
      type: "draft",
      text: typeof draftText === "string" ? draftText : "",
      kairoSessionId: activeKairoSessionId
    });
  };

  /** Resolve WorkMode for the active Kairo session — fail-closed to ask. */
  const resolveActiveMode = async () => {
    if (!activeKairoSessionId || !projectRoot) return "ask";
    try {
      const session = await getSessionImpl(homeDir, projectRoot, activeKairoSessionId);
      return normalizeWorkMode(session?.mode);
    } catch {
      return "ask";
    }
  };

  const emitMode = (mode) => {
    const next = normalizeWorkMode(mode);
    currentMode = next;
    writeOut({ type: "mode", mode: next });
  };

  const restoreAndEmitMode = async () => {
    emitMode(await resolveActiveMode());
  };

  // `kairo resume <id>` (or `start`) launches this host with
  // `KAIRO_SESSION_ID` set. If one of the real Pi files on disk is already
  // bound to that exact Kairo id, switch Pi to it before `ready` — the host
  // reopens the same transcript the picker/labels agree is bound to that
  // id, instead of always starting from Pi's own fresh `--no-session` run.
  if (envSessionId && projectRoot) {
    for (const file of sessionFiles) {
      if (!file.sessionId) continue;
      let bound = null;
      try {
        bound = await lookupPiBindingImpl(homeDir, projectRoot, file.sessionId);
      } catch {
        bound = null;
      }
      if (bound !== envSessionId) continue;
      if (bridge.engine?.sessionId !== file.sessionId) {
        try {
          const result = await bridge.request({ type: "switch_session", sessionPath: file.path });
          if (!result?.cancelled) {
            bridge.engine = await refreshHostEngine(bridge, cwd, {
              reapplyArchitect: true,
              loadKairoProviderModels: loadModels
            });
          }
        } catch {
          // Leave the fresh no-model session active — never crash the host
          // over a failed auto-bind switch.
        }
      }
      break;
    }
  }

  let draft = null;
  if (envSessionId && projectRoot) {
    try {
      draft = await loadDraftImpl(homeDir, projectRoot, envSessionId);
    } catch {
      draft = null;
    }
  }

  const writeOut = (record) => {
    stdout.write(`${JSON.stringify(record)}\n`);
  };

  // ---- ASK persistence (A4) ---------------------------------------------
  // ASK turns are appended to `<sessionDir>/ask-events.jsonl` as they are
  // emitted (see ask-events-store.js) and merged into the Pi rows whenever a
  // transcript is emitted. Writes run on one serial chain so lines keep their
  // order; every step is best-effort and never rejects into the ASK flow.
  let askWrites = Promise.resolve();
  const enqueueAskWrite = (fn) => {
    askWrites = askWrites.then(fn).catch(() => {});
  };
  // Pi rows in the last transcript emitted/fetched: the fallback anchor when a
  // fresh count is not available at submit time.
  let lastPiRowCount = null;
  const PI_ANCHOR_TIMEOUT_MS = 1500;
  const currentPiRowCount = async () => {
    let timer = null;
    try {
      const rows = await Promise.race([
        fetchTranscriptRows(bridge),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), PI_ANCHOR_TIMEOUT_MS);
          timer.unref?.();
        })
      ]);
      lastPiRowCount = rows.length;
      return rows.length;
    } catch {
      return lastPiRowCount;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const persistAsk = (sessionId, record) => {
    if (!sessionId || !projectRoot) return;
    enqueueAskWrite(() =>
      appendAskRecord(homeDir, projectRoot, sessionId, { ...record, at: new Date().toISOString() })
    );
  };
  // Emits the Pi transcript with the given Kairo session's stored ASK turns
  // merged in (`kairoSessionId` null/undefined => Pi rows only).
  const emitTranscript = async (kairoSessionId) => {
    await emitTranscriptFromPi(bridge, cwd, writeOut, {
      mergeRows: async (piRows) => {
        lastPiRowCount = piRows.length;
        if (!kairoSessionId || !projectRoot) return piRows;
        await askWrites;
        return mergeAskTurnsIntoRows(piRows, await readAskTurns(homeDir, projectRoot, kairoSessionId));
      }
    });
  };

  writeOut({
    type: "ready",
    engine: bridge.engine,
    snapshot: bridge.snapshot,
    kairoModels: serializeKairoModelsForHost(kairoModels),
    sessions: await annotateSessions(sessionFiles),
    sessionsNote:
      sessionFiles.length === 0
        ? "No Pi session files on disk for this cwd (RPC has no list_sessions; use new_session or create via Pi)."
        : null,
    draft
  });
  await restoreAndEmitMode();

  bridge.onEvent((ev) => writeOut(ev));

  // `kairo resume <id>`: rebuild the visible history (Pi rows + stored ASK
  // turns) only when the session actually has ASK turns; a session without
  // any keeps today's behavior (no startup transcript).
  if (envSessionId && projectRoot) {
    try {
      if ((await readAskTurns(homeDir, projectRoot, envSessionId)).length > 0) {
        await emitTranscript(activeKairoSessionId);
      }
    } catch {
      // Best-effort restore; the host still starts.
    }
  }

  let buffer = "";
  let stopped = false;

  // ---- ASK turn lifecycle (A2) ------------------------------------------
  // Exactly one ASK runs at a time: {turnId, sessionId, controller, seq,
  // provider, emitted, closed, promise}. A second `prompt` is rejected (not
  // queued). Every provider_event / terminal record is written only while
  // its turn is still the active, unclosed one, so late or foreign events
  // are dropped. `finishAsk` is idempotent: the first terminal kind wins.
  // Terminal kinds are exactly `done`, `cancelled` and `failed`; a provider's
  // own `error` event is informational and never ends the turn.
  const ASK_TERMINAL_KINDS = new Set(["done", "cancelled", "failed"]);
  let activeAsk = null;
  let askTurnCounter = 0;

  const emitAskRecord = (ask, kind, fields = {}) => {
    ask.seq += 1;
    writeOut({
      type: "provider_event",
      turnId: ask.turnId,
      sessionId: ask.sessionId,
      seq: ask.seq,
      provider: fields.provider ?? ask.provider,
      kind,
      ...fields
    });
    // Terminal kinds close the stored turn; everything else is one event.
    if (ASK_TERMINAL_KINDS.has(kind)) {
      persistAsk(ask.sessionId, {
        type: "turn_end",
        turnId: ask.turnId,
        seq: ask.seq,
        status: kind,
        ...(typeof fields.message === "string" ? { message: fields.message } : {})
      });
    } else {
      persistAsk(ask.sessionId, {
        ...fields,
        type: "event",
        turnId: ask.turnId,
        seq: ask.seq,
        provider: fields.provider ?? ask.provider,
        kind
      });
    }
  };

  const finishAsk = (ask, kind, fields = {}) => {
    if (ask.closed) return;
    emitAskRecord(ask, kind, fields);
    ask.closed = true;
    if (activeAsk === ask) activeAsk = null;
  };

  // Abort the active ASK, wait (bounded) for its provider run to settle, then
  // emit the terminal `cancelled` record. Safe to call with no active ASK.
  const cancelActiveAsk = async () => {
    const ask = activeAsk;
    if (!ask) return false;
    ask.controller.abort();
    let timer = null;
    await Promise.race([
      ask.promise.catch(() => {}),
      new Promise((resolve) => {
        timer = setTimeout(resolve, askCancelWaitMs);
        timer.unref?.();
      })
    ]);
    if (timer) clearTimeout(timer);
    finishAsk(ask, "cancelled");
    return true;
  };

  const runAskTurn = async ({ message, mode }) => {
    const ask = {
      turnId: `ask-${Date.now().toString(36)}-${++askTurnCounter}`,
      sessionId: activeKairoSessionId ?? null,
      controller: new AbortController(),
      seq: 0,
      provider: null,
      emitted: false,
      hasText: false,
      closed: false,
      promise: null
    };
    activeAsk = ask;
    if (ask.sessionId && projectRoot) {
      const anchor = currentPiRowCount();
      enqueueAskWrite(async () =>
        appendAskRecord(homeDir, projectRoot, ask.sessionId, {
          type: "turn_start",
          turnId: ask.turnId,
          seq: 0,
          at: new Date().toISOString(),
          prompt: message,
          piAnchor: (await anchor) ?? null
        })
      );
    }
    const onEvent = (event) => {
      if (ask.closed || activeAsk !== ask || ask.controller.signal.aborted) return;
      if (!event || typeof event.kind !== "string") return;
      // Terminal kinds are owned by the sidecar (finishAsk); a provider can
      // only send informational events, including a non-terminal `error`.
      if (ASK_TERMINAL_KINDS.has(event.kind)) return;
      if (event.provider) ask.provider = event.provider;
      const { kind, ...rest } = event;
      // The final answer travels in `task_result`; never repeat its text here.
      if (kind === "final") delete rest.text;
      ask.emitted = true;
      if (kind === "text" && typeof rest.text === "string" && rest.text !== "") ask.hasText = true;
      emitAskRecord(ask, kind, rest);
    };
    ask.promise = (async () =>
      submitTaskImpl({
        cwd,
        task: message,
        mode,
        sessionId: ask.sessionId,
        signal: ask.controller.signal,
        onEvent
      }))();
    let result;
    try {
      result = await ask.promise;
    } catch (err) {
      if (ask.closed) return;
      if (ask.controller.signal.aborted) {
        finishAsk(ask, "cancelled");
        return;
      }
      const message_ = err?.message ?? String(err);
      writeOut({ type: "error", message: message_ });
      finishAsk(ask, "failed", { message: message_ });
      return;
    }
    if (ask.closed) return; // cancelled/timed out meanwhile: drop the late result
    if (result?.kind === "cancelled" || ask.controller.signal.aborted) {
      finishAsk(ask, "cancelled");
      return;
    }
    if (result?.provider) ask.provider = result.provider;
    if (result?.kind === "answer") {
      // Mirror the host's dedup rule: the answer is stored on its own only
      // when no non-empty `text` event already carried it.
      if (!ask.hasText) {
        persistAsk(ask.sessionId, {
          type: "event",
          turnId: ask.turnId,
          seq: ask.seq,
          kind: "answer",
          provider: result.provider ?? null,
          model: result.model ?? null,
          text: result.answer ?? ""
        });
      }
      writeOut({
        type: "task_result",
        kind: "answer",
        provider: result.provider ?? null,
        model: result.model ?? null,
        answer: result.answer ?? ""
      });
      // Turns that streamed provider_events already showed their activity;
      // the legacy notice would repeat the answer text, so it is kept only
      // for turns that emitted nothing.
      if (!ask.emitted) {
        writeOut({
          type: "notice",
          message: `${result.provider ?? "kairo"}${result.model ? ` · ${result.model}` : ""}: ${result.answer ?? ""}`
        });
      }
    }
    finishAsk(ask, "done");
  };

  // `resolveSession` (optional) resolves the Kairo session the transcript
  // belongs to AFTER the engine refresh, so a switch merges the destination
  // session's ASK turns, not the outgoing one's. `mergeAsk: false` (fork)
  // emits Pi rows only: a fork starts with no ASK turns.
  const applyEngineAndMaybeTranscript = async ({
    reloadTranscript = false,
    reapplyArchitect = false,
    resolveSession = null,
    mergeAsk = true
  } = {}) => {
    const engine = await refreshHostEngine(bridge, cwd, {
      reapplyArchitect,
      loadKairoProviderModels: loadModels
    });
    writeOut({
      type: "engine",
      engine,
      modelLabel: formatEngineModelLabel(engine.model)
    });
    if (resolveSession) activeKairoSessionId = await resolveSession();
    if (reloadTranscript) {
      await emitTranscript(mergeAsk ? activeKairoSessionId : null);
    }
    return engine;
  };

  const emitSnapshot = async () => {
    const snapshot = await loadSnapshot({ cwd });
    writeOut({ type: "snapshot", snapshot });
  };

  /**
   * One team mutation (analyze / approve). Emits a structured `team`
   * record either way, so the host never infers success from prose, then
   * rethrows so the shared handler reports the real error text.
   * @param {"project.analyze"|"team.approve"} op
   * @param {() => Promise<object>} run
   */
  const runTeamOp = async (op, run) => {
    try {
      const summary = await run();
      writeOut({
        type: "team",
        op,
        ok: true,
        state: summary.state,
        teamRows: summary.teamRows,
        roles: summary.roles,
        analyst: summary.analyst ?? null
      });
      return summary;
    } catch (err) {
      writeOut({ type: "team", op, ok: false, reason: err?.message ?? String(err) });
      throw err;
    }
  };

  /** Emit session-scoped plan timeline (U4b/U4c). */
  const emitPlansList = async () => {
    const snap = await snapshotImpl({
      cwd,
      sessionId: activeKairoSessionId
    });
    const timeline = Array.isArray(snap?.timeline) ? snap.timeline : [];
    writeOut({
      type: "plans",
      timeline,
      projectTeamRoles: projectTeamRolesFromSnapshot(snap)
    });
    return timeline;
  };

  /** Serialize a planExecution preview for the host (U4c). */
  const emitPlanPreview = (taskId, decision, { autoExecuted = false } = {}) => {
    writeOut({
      type: "plan_preview",
      taskId,
      decision: decision?.decision ?? null,
      role: decision?.role ?? null,
      provider: decision?.provider ?? null,
      model: decision?.model ?? null,
      why: decision?.why ?? null,
      confirmationTarget: decision?.confirmationTarget ?? null,
      taskPrompt: decision?.taskPrompt ?? null,
      blockedAssignment: decision?.blockedAssignment ?? null,
      suggestedAlternative: decision?.suggestedAlternative ?? null,
      modelRef: decision?.modelRef ?? null,
      autoExecuted: autoExecuted === true
    });
  };

  const handleLine = async (line) => {
    if (!line.trim() || stopped) return;
    let cmd;
    try {
      cmd = JSON.parse(line);
    } catch (err) {
      writeOut({
        type: "error",
        message: `Invalid JSON command: ${err?.message ?? err}`
      });
      return;
    }
    const op = cmd?.op;
    try {
      if (op === "prompt") {
        // U4a: ASK/PLAN/AGENT route through conversation submitTask — never
        // Pi `prompt` (ASK answers; PLAN/AGENT produce a plan only).
        const message = typeof cmd.message === "string" ? cmd.message : "";
        const mode = normalizeWorkMode(cmd.mode ?? currentMode);
        if (mode === "ask") {
          if (activeAsk) {
            writeOut({ type: "error", message: "A previous request is still running" });
            return;
          }
          await runAskTurn({ message, mode });
          return;
        }
        const result = await submitTaskImpl({
          cwd,
          task: message,
          mode,
          sessionId: activeKairoSessionId
        });
        if (result?.kind === "answer") {
          writeOut({
            type: "task_result",
            kind: "answer",
            provider: result.provider ?? null,
            model: result.model ?? null,
            answer: result.answer ?? ""
          });
          writeOut({
            type: "notice",
            message: `${result.provider ?? "kairo"}${result.model ? ` · ${result.model}` : ""}: ${result.answer ?? ""}`
          });
        } else {
          writeOut({
            type: "task_result",
            kind: "plan",
            taskId: result?.taskId ?? null
          });
          writeOut({
            type: "notice",
            message: PLAN_REQUESTED_NOTICE
          });
          // U4b: refresh the plan/timeline list so the host can open it.
          try {
            await emitPlansList();
          } catch (listErr) {
            writeOut({
              type: "error",
              message: `plans.list after plan failed: ${listErr?.message ?? listErr}`
            });
          }
        }
      } else if (op === "set_mode") {
        const raw = cmd?.mode;
        if (!WORK_MODES.has(raw)) {
          writeOut({
            type: "error",
            message: `Unknown work mode "${raw ?? ""}"`
          });
          return;
        }
        const mode = raw;
        try {
          await setModeImpl({ cwd, mode, sessionId: activeKairoSessionId });
          emitMode(mode);
        } catch (err) {
          writeOut({
            type: "notice",
            message: `Mode change not saved: ${err?.message ?? String(err)}`
          });
        }
      } else if (op === "plans.list") {
        await emitPlansList();
      } else if (op === "plans.show") {
        const taskId = typeof cmd.taskId === "string" ? cmd.taskId : "";
        if (!taskId) {
          writeOut({ type: "error", message: "plans.show requires taskId" });
          return;
        }
        const plan = await showPlanImpl({
          cwd,
          taskId,
          sessionId: activeKairoSessionId
        });
        writeOut({
          type: "plan_detail",
          taskId: plan?.taskId ?? taskId,
          state: plan?.state ?? null,
          approval: plan?.approval ?? null,
          taskMarkdown: plan?.taskMarkdown ?? null,
          planMarkdown: plan?.planMarkdown ?? null,
          planReady: plan?.planReady ?? false,
          sessionId: plan?.sessionId ?? null
        });
      } else if (op === "plans.decide") {
        const taskId = typeof cmd.taskId === "string" ? cmd.taskId : "";
        const decision = cmd?.decision;
        if (!taskId) {
          writeOut({ type: "error", message: "plans.decide requires taskId" });
          return;
        }
        if (!PLAN_DECISIONS.has(decision)) {
          writeOut({
            type: "error",
            message: 'Decision must be "approved" or "rejected".'
          });
          return;
        }
        const decided = await decidePlanImpl({
          cwd,
          taskId,
          decision,
          sessionId: activeKairoSessionId
        });
        writeOut({
          type: "plan_decision",
          taskId: decided?.taskId ?? taskId,
          decision,
          state: decided?.state ?? decision,
          approval: decided?.approval ?? null,
          sessionId: decided?.sessionId ?? null
        });
        writeOut({
          type: "notice",
          message:
            decision === "approved"
              ? `Plan ${taskId} approved.`
              : `Plan ${taskId} rejected.`
        });
        await emitPlansList();
      } else if (op === "plans.preview") {
        // U4c: role → planExecution. WAIT_FOR + suggested-alternative auto-
        // executes (cockpit parity). Everything else waits for host confirm.
        const taskId = typeof cmd.taskId === "string" ? cmd.taskId : "";
        const role = typeof cmd.role === "string" ? cmd.role : "";
        if (!taskId) {
          writeOut({ type: "error", message: "plans.preview requires taskId" });
          return;
        }
        if (!role) {
          writeOut({ type: "error", message: "plans.preview requires role" });
          return;
        }
        const decision = await planExecutionImpl({
          cwd,
          taskId,
          role,
          sessionId: activeKairoSessionId
        });
        const isAutoFallback =
          decision?.decision === "WAIT_FOR_PROJECT_TEAM" &&
          decision?.confirmationTarget?.selection === "suggested-alternative";
        if (isAutoFallback) {
          const blockedLabel =
            decision.blockedAssignment?.model?.displayName ??
            decision.blockedAssignment?.model?.modelId ??
            decision.blockedAssignment?.provider ??
            "the assigned model";
          const alt = decision.suggestedAlternative;
          const altLabel =
            alt?.model?.displayName ?? alt?.model?.modelId ?? "unknown model";
          emitPlanPreview(taskId, decision, { autoExecuted: true });
          writeOut({
            type: "notice",
            message: `${blockedLabel} is unavailable for ${decision.role} — automatically falling back to ${alt?.provider} · ${altLabel}.`
          });
          const executed = await executePlanImpl({
            cwd,
            taskId,
            confirmationTarget: decision.confirmationTarget,
            sessionId: activeKairoSessionId
          });
          writeOut({
            type: "plan_execute",
            taskId: executed?.taskId ?? taskId,
            execution: executed?.execution ?? null,
            reused: executed?.reused ?? false,
            autoExecuted: true
          });
          await emitPlansList();
          return;
        }
        emitPlanPreview(taskId, decision, { autoExecuted: false });
        if (decision?.decision === "MANUAL_HANDOFF" && decision?.taskPrompt) {
          const modelLabel =
            decision.modelRef?.displayName ?? decision.model ?? "the assigned model";
          writeOut({
            type: "notice",
            message: `${decision.provider} · ${modelLabel} can't be launched automatically — paste this into its chat:\n\n${decision.taskPrompt}`
          });
        }
      } else if (op === "plans.execute") {
        const taskId = typeof cmd.taskId === "string" ? cmd.taskId : "";
        const confirmationTarget = cmd?.confirmationTarget;
        if (!taskId) {
          writeOut({ type: "error", message: "plans.execute requires taskId" });
          return;
        }
        if (!confirmationTarget || typeof confirmationTarget !== "object") {
          writeOut({
            type: "error",
            message:
              "plans.execute requires confirmationTarget from a fresh planExecution preview"
          });
          return;
        }
        const executed = await executePlanImpl({
          cwd,
          taskId,
          confirmationTarget,
          sessionId: activeKairoSessionId
        });
        writeOut({
          type: "plan_execute",
          taskId: executed?.taskId ?? taskId,
          execution: executed?.execution ?? null,
          reused: executed?.reused ?? false,
          autoExecuted: false
        });
        writeOut({
          type: "notice",
          message: executed?.execution?.message
            ?? `Execution started for ${taskId}.`
        });
        await emitPlansList();
      } else if (op === "plans.cancel") {
        const taskId = typeof cmd.taskId === "string" ? cmd.taskId : "";
        if (!taskId) {
          writeOut({ type: "error", message: "plans.cancel requires taskId" });
          return;
        }
        const cancelled = await cancelExecutionImpl({ cwd, taskId });
        writeOut({
          type: "plan_cancel",
          taskId: cancelled?.taskId ?? taskId,
          execution: cancelled?.execution ?? null
        });
        writeOut({
          type: "notice",
          message: `Cancelled run for ${taskId}.`
        });
        await emitPlansList();
      } else if (op === "plans.transcript") {
        const runId = typeof cmd.runId === "string" ? cmd.runId : "";
        if (!runId) {
          writeOut({ type: "error", message: "plans.transcript requires runId" });
          return;
        }
        const sinceIndex = Number.isFinite(Number(cmd.sinceIndex))
          ? Number(cmd.sinceIndex)
          : 0;
        const result = await readRunTranscriptImpl({ runId, sinceIndex });
        writeOut({
          type: "run_transcript",
          runId: result?.runId ?? runId,
          nextIndex: result?.nextIndex ?? sinceIndex,
          entries: Array.isArray(result?.entries) ? result.entries : []
        });
      } else if (op === "slash.info") {
        // U4d: /usage /providers /status /models[/flags] /why
        const kind = typeof cmd.kind === "string" ? cmd.kind : "";
        const snap = await snapshotImpl({
          cwd,
          sessionId: activeKairoSessionId
        });
        if (kind === "models" && cmd.verifyAccess === true) {
          const refresh = cmd.refresh === true;
          const summary = await verifyClaudeEntitlementsImpl({
            cwd,
            refresh,
            beforeProbe: ({ costStatement }) => {
              writeOut({ type: "slash_lines", kind: "models_verify", lines: [costStatement] });
            }
          });
          const allowed = summary.results.filter((r) => r.status === "allowed").length;
          const denied = summary.results.filter((r) => r.status === "denied").length;
          const unverified = summary.results.filter((r) => r.status === "unverified").length;
          const lines =
            summary.probed.length === 0
              ? [
                  "Claude access already verified for the current catalog (use --refresh to re-probe)."
                ]
              : [
                  `Claude access check: ${summary.probed.length} probed · ${allowed} allowed · ${denied} denied · ${unverified} unverified${summary.persisted ? " · cache updated" : " · cache unchanged"}.`
                ];
          writeOut({ type: "slash_lines", kind: "models_verify", lines });
          return;
        }
        const diagKind =
          kind === "models" && cmd.evidence === true ? "models_evidence" : kind;
        const lines = slashDiagnosticLines(snap, diagKind);
        writeOut({ type: "slash_lines", kind: diagKind, lines });
      } else if (op === "slash.clear") {
        await clearTranscriptImpl({ cwd, sessionId: activeKairoSessionId });
        if (activeKairoSessionId && projectRoot) {
          // ask-history.json (prompt context) is cleared by the service; the
          // display log is ours. Wait for in-flight appends so none lands after.
          await askWrites;
          await clearAskEvents(homeDir, projectRoot, activeKairoSessionId);
        }
        writeOut({ type: "slash_lines", kind: "clear", lines: ["Transcript cleared."] });
        writeOut({ type: "transcript", messages: [] });
      } else if (op === "slash.project_status") {
        const snap = await snapshotImpl({
          cwd,
          sessionId: activeKairoSessionId
        });
        writeOut({
          type: "slash_lines",
          kind: "project_status",
          lines: projectStatusLines(snap)
        });
      } else if (op === "ops.snapshot") {
        // U5a/U5b: Operations hub — health/fleet/usage/diagnostics + actionable lists.
        let conversationSnap = null;
        try {
          conversationSnap = await snapshotImpl({
            cwd,
            sessionId: activeKairoSessionId
          });
        } catch {
          conversationSnap = null;
        }
        const ops = await buildOpsSnapshotImpl({
          homeDir,
          workspaceRoot: projectRoot ?? cwd,
          conversationSnapshot: conversationSnap
        });
        writeOut({
          type: "ops_snapshot",
          ok: ops.ok !== false,
          error: ops.error ?? null,
          health: Array.isArray(ops.health) ? ops.health : ["Health unavailable."],
          fleet: Array.isArray(ops.fleet) ? ops.fleet : ["Fleet unavailable."],
          usage: Array.isArray(ops.usage) ? ops.usage : ["Usage unavailable."],
          diagnostics: Array.isArray(ops.diagnostics)
            ? ops.diagnostics
            : ["Diagnostics unavailable."],
          runs: Array.isArray(ops.runs) ? ops.runs : [],
          alerts: Array.isArray(ops.alerts) ? ops.alerts : [],
          reviews: Array.isArray(ops.reviews) ? ops.reviews : [],
          backups: Array.isArray(ops.backups) ? ops.backups : [],
          hints: typeof ops.hints === "string" ? ops.hints : "Esc → Work"
        });
      } else if (op === "ops.sync.preview") {
        const preview = await previewOpsSyncImpl({
          homeDir,
          workspaceRoot: projectRoot ?? cwd
        });
        writeOut({ type: "ops_sync_preview", ...preview });
      } else if (op === "ops.sync.apply") {
        const preview = cmd.preview && typeof cmd.preview === "object" ? cmd.preview : null;
        const result = await applyOpsSyncImpl({
          preview,
          homeDir,
          workspaceRoot: projectRoot ?? cwd
        });
        writeOut({ type: "ops_sync_result", ...result });
      } else if (op === "ops.rollback.preview") {
        const snapshotName = typeof cmd.snapshot === "string" ? cmd.snapshot : "";
        const preview = await previewOpsRollbackImpl({
          homeDir,
          snapshot: snapshotName
        });
        writeOut({ type: "ops_rollback_preview", ...preview });
      } else if (op === "ops.rollback.apply") {
        const preview = cmd.preview && typeof cmd.preview === "object" ? cmd.preview : null;
        const result = await applyOpsRollbackImpl({
          preview,
          homeDir
        });
        writeOut({ type: "ops_rollback_result", ...result });
      } else if (op === "ops.runs.cancel") {
        const runId = typeof cmd.runId === "string" ? cmd.runId : "";
        const result = await cancelOpsRunImpl({ homeDir, runId });
        writeOut({ type: "ops_run_cancel", ...result });
      } else if (op === "ops.alerts.dismiss") {
        const alertId = typeof cmd.alertId === "string" ? cmd.alertId : "";
        const result = await dismissOpsAlertImpl({
          alertId,
          confirmed: cmd.confirmed === true,
          homeDir
        });
        writeOut({ type: "ops_alert_dismiss", ...result });
      } else if (op === "settings.snapshot") {
        const settings = await buildSettingsSnapshotImpl({
          homeDir,
          workspaceRoot: projectRoot ?? cwd
        });
        writeOut({
          type: "settings_snapshot",
          ok: settings.ok !== false,
          error: settings.error ?? null,
          profile: Array.isArray(settings.profile) ? settings.profile : ["Profile unavailable."],
          integrations: Array.isArray(settings.integrations)
            ? settings.integrations
            : ["Integrations unavailable."],
          connections: Array.isArray(settings.connections)
            ? settings.connections
            : ["Connections unavailable."],
          catalog: Array.isArray(settings.catalog) ? settings.catalog : [],
          setup: settings.setup ?? {
            wired: false,
            label: "Interactive setup · not wired"
          },
          hints: typeof settings.hints === "string" ? settings.hints : "Esc → Work"
        });
      } else if (op === "settings.integration.confirm") {
        // Curated intent receipt only — never installs files (cockpit-settings).
        const id = typeof cmd.id === "string" ? cmd.id : "";
        const entry = getCuratedIntegration(id);
        if (!entry) {
          writeOut({
            type: "settings_integration_result",
            ok: false,
            reason: "not-found",
            wroteFiles: false,
            receipt: null
          });
        } else {
          let state = createSettingsActionState();
          state = reduceSettingsAction(state, { type: "preview", id });
          state = reduceSettingsAction(state, { type: "confirm-prompt" });
          state = reduceSettingsAction(state, { type: "confirm" });
          writeOut({
            type: "settings_integration_result",
            ok: true,
            reason: "intent-recorded",
            wroteFiles: false,
            receipt: state.receipt,
            message: state.message
          });
        }
      } else if (op === "project.refresh") {
        const result = await refreshProjectStrategyImpl({ cwd });
        writeOut({
          type: "notice",
          message: result
            ? `Project strategy is now ${String(result.status).toUpperCase()}.`
            : "Nothing to refresh yet — use /project analyze first."
        });
        await emitSnapshot();
      } else if (op === "team.edit.catalog") {
        const role = typeof cmd.role === "string" ? cmd.role : "";
        if (!role) {
          writeOut({ type: "error", message: "team.edit.catalog requires role" });
          return;
        }
        const catalog = await getProjectTeamEditCatalogImpl({ cwd, role });
        const snap = await snapshotImpl({
          cwd,
          sessionId: activeKairoSessionId
        });
        const entry = snap?.projectStrategy?.projectTeam?.find((e) => e.role === role);
        writeOut({
          type: "team_edit_catalog",
          role,
          models: Array.isArray(catalog?.models) ? catalog.models : [],
          currentCandidateKey: entry?.model?.candidateKey ?? null,
          recommendedCandidateKey:
            entry?.recommendedAssignment?.model?.candidateKey ??
            entry?.model?.candidateKey ??
            null
        });
      } else if (op === "team.edit.assign") {
        const role = typeof cmd.role === "string" ? cmd.role : "";
        const candidateKey =
          typeof cmd.candidateKey === "string" ? cmd.candidateKey : "";
        if (!role || !candidateKey) {
          writeOut({
            type: "error",
            message: "team.edit.assign requires role and candidateKey"
          });
          return;
        }
        const strategy = await setProjectTeamAssignmentImpl({
          cwd,
          role,
          candidateKey
        });
        writeOut({
          type: "team_edit_saved",
          role,
          strategy,
          state: strategy?.status ?? null
        });
        writeOut({
          type: "notice",
          message: `Updated ${role} assignment (SUGGESTED).`
        });
        await emitSnapshot();
      } else if (op === "abort") {
        // An active ASK owns the abort; Pi's abort is only forwarded when no
        // ASK is running (Pi-owned operations keep their own semantics).
        if (!(await cancelActiveAsk())) await bridge.request({ type: "abort" });
      } else if (op === "compact") {
        await bridge.request({ type: "compact" });
        writeOut({ type: "notice", message: "Compaction requested" });
        await applyEngineAndMaybeTranscript({ reloadTranscript: true });
      } else if (op === "cycle_model") {
        if (kairoModels.length === 0) {
          writeOut({
            type: "error",
            message: "No launchable Kairo projectTeam models to cycle"
          });
          return;
        }
        const currentId = bridge.engine?.model?.id ?? null;
        const next = pickNextKairoModel(kairoModels, currentId);
        if (!next) {
          writeOut({ type: "error", message: "Model cycle failed: no candidate" });
          return;
        }
        try {
          await bridge.request(kairoSetModelCommand(next));
          await applyEngineAndMaybeTranscript({ reloadTranscript: false });
        } catch (err) {
          writeOut({
            type: "error",
            message: `set_model failed: ${err?.message ?? err}`
          });
        }
      } else if (op === "new_session") {
        await cancelActiveAsk();
        await persistOutgoingDraft(cmd.draft);
        const result = await bridge.request({ type: "new_session" });
        if (result?.cancelled) {
          writeOut({ type: "notice", message: "New session cancelled by extension" });
          return;
        }
        sessionFiles = listSessionFilesImpl({ cwd, env });
        writeOut({
          type: "sessions",
          sessions: await annotateSessions(sessionFiles)
        });
        // Extension (when loaded) may already have minted+bound; otherwise
        // the new Pi file stays unbound. Never invent an id here — New's
        // draft is always empty.
        await applyEngineAndMaybeTranscript({
          reloadTranscript: true,
          reapplyArchitect: true,
          resolveSession: () => lookupKairoIdForPi(bridge.engine?.sessionId ?? null)
        });
        await emitActiveDraft({ text: "" });
        await restoreAndEmitMode();
      } else if (op === "switch_session") {
        await cancelActiveAsk();
        const sessionPath = typeof cmd.sessionPath === "string" ? cmd.sessionPath : "";
        if (!sessionPath) {
          writeOut({ type: "error", message: "switch_session requires sessionPath" });
          return;
        }
        await persistOutgoingDraft(cmd.draft);
        const result = await bridge.request({
          type: "switch_session",
          sessionPath
        });
        if (result?.cancelled) {
          writeOut({ type: "notice", message: "Session switch cancelled by extension" });
          return;
        }
        const matched = sessionFiles.find((f) => f.path === sessionPath);
        await applyEngineAndMaybeTranscript({
          reloadTranscript: true,
          reapplyArchitect: true,
          resolveSession: () =>
            lookupKairoIdForPi(matched?.sessionId ?? bridge.engine?.sessionId ?? null)
        });
        await emitActiveDraft();
        await restoreAndEmitMode();
      } else if (op === "switch_session_index") {
        await cancelActiveAsk();
        sessionFiles = listSessionFilesImpl({ cwd, env });
        const index = Number(cmd.index);
        if (!Number.isInteger(index) || index < 0 || index >= sessionFiles.length) {
          writeOut({
            type: "error",
            message:
              sessionFiles.length === 0
                ? "No Pi sessions on disk for this cwd"
                : `Session index out of range (0..${sessionFiles.length - 1})`
          });
          return;
        }
        await persistOutgoingDraft(cmd.draft);
        const target = sessionFiles[index];
        const result = await bridge.request({
          type: "switch_session",
          sessionPath: target.path
        });
        if (result?.cancelled) {
          writeOut({ type: "notice", message: "Session switch cancelled by extension" });
          return;
        }
        await applyEngineAndMaybeTranscript({
          reloadTranscript: true,
          reapplyArchitect: true,
          resolveSession: () => lookupKairoIdForPi(target.sessionId ?? null)
        });
        await emitActiveDraft();
        await restoreAndEmitMode();
      } else if (op === "list_sessions") {
        sessionFiles = listSessionFilesImpl({ cwd, env });
        writeOut({
          type: "sessions",
          sessions: await annotateSessions(sessionFiles),
          sessionsNote:
            sessionFiles.length === 0
              ? "No Pi session files on disk for this cwd (RPC has no list_sessions)."
              : null
        });
      } else if (op === "rename_session") {
        // Pi RPC's `set_session_name` renames the CURRENTLY active session
        // only (no sessionPath) — persisted into that session file's own
        // header, so a fresh `listPiSessionFilesForCwd` picks up the new
        // label. Never invents a name when the human sent an empty one.
        const name = typeof cmd.name === "string" ? cmd.name.trim() : "";
        if (!name) {
          writeOut({ type: "error", message: "rename_session requires a non-empty name" });
          return;
        }
        await bridge.request({ type: "set_session_name", name });
        sessionFiles = listSessionFilesImpl({ cwd, env });
        writeOut({ type: "sessions", sessions: await annotateSessions(sessionFiles) });
        writeOut({ type: "notice", message: `Session renamed to "${name}"` });
      } else if (op === "fork_session") {
        await cancelActiveAsk();
        // Pi RPC's `fork` takes an `entryId` and edits/regenerates history
        // from a specific past message (its response is `{text, cancelled}`,
        // not a new session) — not what "fork the whole session" means here.
        // `clone` is the dedicated RPC command for exactly that: it forks at
        // the CURRENT leaf, creating a new session file distinct from the
        // source (the source file is never touched) and switches Pi's live
        // session to the new one. After a successful clone we mint a NEW
        // Kairo session id and bind it to the new Pi file so the fork
        // appears in `kairo list` / annotateSessions independently of the
        // source (source bindings + drafts stay untouched).
        const priorActive = activeKairoSessionId;
        await persistOutgoingDraft(cmd.draft);
        const result = await bridge.request({ type: "clone" });
        if (result?.cancelled) {
          writeOut({ type: "notice", message: "Fork cancelled by extension" });
          return;
        }
        // A fork starts with no ASK turns (ask-history.json is not copied
        // either): emit the cloned Pi rows only.
        await applyEngineAndMaybeTranscript({
          reloadTranscript: true,
          reapplyArchitect: true,
          mergeAsk: false
        });
        const newPiSessionId = bridge.engine?.sessionId ?? null;

        if (projectRoot && newPiSessionId) {
          try {
            let mode = "ask";
            if (priorActive) {
              try {
                const previous = await getSessionImpl(homeDir, projectRoot, priorActive);
                if (previous?.mode) mode = previous.mode;
              } catch {
                mode = "ask";
              }
            }
            const session = await createSessionImpl(homeDir, projectRoot, { mode });
            await recordPiBindingImpl(homeDir, projectRoot, newPiSessionId, session.id);
            activeKairoSessionId = session.id;
          } catch (err) {
            // Fail-closed: Pi already moved to the fork, but we have no
            // honest Kairo id for it. Do NOT keep priorActive (that would
            // make stop/draft saves for the fork contaminate the source
            // identity) and do NOT invent a fallback binding under the
            // previous id.
            activeKairoSessionId = null;
            writeOut({
              type: "error",
              message: `Fork Kairo binding failed: ${err?.message ?? err}`
            });
            sessionFiles = listSessionFilesImpl({ cwd, env });
            writeOut({
              type: "sessions",
              sessions: await annotateSessions(sessionFiles)
            });
            return;
          }
        } else {
          // No project root (or Pi gave no session id) — degrade to unbound
          // rather than crashing; the Pi fork itself still succeeded.
          activeKairoSessionId = null;
        }

        sessionFiles = listSessionFilesImpl({ cwd, env });
        writeOut({ type: "sessions", sessions: await annotateSessions(sessionFiles) });
        await emitActiveDraft({ text: "" });
        await restoreAndEmitMode();
        writeOut({ type: "notice", message: "Session forked — now on the new copy." });
      } else if (op === "stop") {
        await cancelActiveAsk();
        if (activeKairoSessionId && projectRoot) {
          const draftText = typeof cmd.draft === "string" ? cmd.draft : "";
          try {
            await saveDraftImpl(homeDir, projectRoot, activeKairoSessionId, draftText);
          } catch {
            // Best-effort — never block shutdown over a failed draft save.
          }
        }
        stopped = true;
        await askWrites; // let the last ASK records reach disk
        await bridge.stop();
        process.exitCode = 0;
      } else if (op === "reload_snapshot") {
        await emitSnapshot();
      } else if (op === "project.preflight") {
        // Read-only: the ratatui host's own analyst picker (T2, no
        // cockpit) — lists the real catalog so a human can choose which
        // Bootstrap Analyst runs `project.analyze`, before anything is
        // sent to a provider. Never persists, never picks for the human.
        try {
          const preflight = await preflightProjectTeam({ cwd });
          writeOut({
            type: "preflight",
            ok: true,
            analystCatalog: preflight.analystCatalog,
            profile: preflight.profile,
            candidates: preflight.candidates,
            pickerNotice: preflight.pickerNotice ?? null,
            exclusionCauses: Array.isArray(preflight.exclusionCauses) ? preflight.exclusionCauses : [],
            unverifiedClaudeNotice: preflight.unverifiedClaudeNotice ?? null
          });
        } catch (err) {
          writeOut({ type: "preflight", ok: false, reason: err?.message ?? String(err) });
        }
      } else if (op === "project.analyze") {
        // Team setup lives here, in the ratatui host: default analyst
        // (or the human's own pick from `project.preflight`'s catalog,
        // via `cmd.analyst` — same clean modelRef shape the cockpit's
        // ProjectOverlay onSelect builds), real read-only analysis,
        // SUGGESTED strategy. Never active — that stays `team.approve`.
        const requestedAnalyst = cmd?.analyst ?? null;
        writeOut({
          type: "notice",
          message: "Analyzing project team… (real read-only provider call, can take a minute)"
        });
        const summary = await runTeamOp("project.analyze", () =>
          analyzeProjectTeam({ cwd, analyst: requestedAnalyst })
        );
        if (summary.notice) writeOut({ type: "notice", message: summary.notice });
        await emitSnapshot();
        writeOut({
          type: "notice",
          message:
            `Suggested team ready: ${summary.teamRows} role${summary.teamRows === 1 ? "" : "s"}` +
            `${summary.analyst ? ` via ${summary.analyst}` : ""} — approve to enable chat.`
        });
      } else if (op === "team.approve") {
        const summary = await runTeamOp("team.approve", () => approveProjectTeam({ cwd }));
        // Approval is what makes a launchable projectTeam route exist:
        // refresh the cached Kairo routes, then re-select Architect on the
        // live bridge (the same reapply the session ops do) so chat
        // unblocks without restarting the host.
        try {
          kairoModels = await loadModels({ cwd });
        } catch {
          kairoModels = [];
        }
        writeOut({
          type: "kairoModels",
          kairoModels: serializeKairoModelsForHost(kairoModels)
        });
        await applyEngineAndMaybeTranscript({ reapplyArchitect: true });
        await emitSnapshot();
        writeOut({
          type: "notice",
          message: `Team active: ${summary.teamRows} role${summary.teamRows === 1 ? "" : "s"}.`
        });
      } else if (op === "team.revalidate") {
        // On-demand re-probe (U2c): same real conversation-service snapshot
        // call the second render phase uses, never a synthesized cause. The
        // sidebar/CTA update from whatever this returns — real evidence, or
        // an honest failure — never a fabricated "available".
        writeOut({ type: "notice", message: "Revalidating provider availability…" });
        const result = await revalidateTeamAvailability({ cwd });
        writeOut({ type: "availability", ok: result.ok, reason: result.reason ?? null });
        writeOut({ type: "snapshot", snapshot: result.snapshot });
      } else if (op === "team.recovery.preview") {
        // Builds (and persists) a SUGGESTED recovery proposal — never
        // activates (see team-recovery.js's runTeamRecovery). The human's
        // own explicit team.recovery.apply / .reject is the only path that
        // ever mutates the active team.
        writeOut({ type: "notice", message: "Checking for a recovered team…" });
        const result = await recoverProjectTeam({ cwd });
        writeOut({ type: "recovery", op: "preview", ...result });
        if (result?.outcome === "proposed" || result?.outcome === "activated") {
          await emitSnapshot();
        }
      } else if (op === "team.recovery.apply") {
        // Re-verifies the pending proposal against CURRENT eligibility
        // before activating (see approveRecoveryProposal) — a stale
        // proposal, or none at all, comes back as outcome:"error" and
        // never touches the model or the strategy file.
        const result = await approveRecoveryProposal({ cwd });
        writeOut({ type: "recovery", op: "apply", ...result });
        if (result?.outcome === "approved") {
          try {
            kairoModels = await loadModels({ cwd });
          } catch {
            kairoModels = [];
          }
          writeOut({
            type: "kairoModels",
            kairoModels: serializeKairoModelsForHost(kairoModels)
          });
          await applyEngineAndMaybeTranscript({ reapplyArchitect: true });
          await emitSnapshot();
        }
      } else if (op === "team.recovery.reject") {
        // The active team was never touched by the proposal — rejection
        // only closes the fingerprint record (see rejectRecoveryProposal).
        const result = await rejectRecoveryProposal({ cwd });
        writeOut({ type: "recovery", op: "reject", ...result });
        if (result?.outcome === "rejected") {
          await emitSnapshot();
        }
      } else if (op === "extension_ui_response") {
        // U3b: one-way stdin write back to Pi. Must preserve the host's
        // request id exactly and must NOT go through bridge.request (that
        // would mint a kairo-* id and wait for a typed response envelope).
        const id = typeof cmd.id === "string" ? cmd.id : "";
        if (!id) {
          writeOut({
            type: "error",
            message: "extension_ui_response requires a non-empty id matching the request"
          });
          return;
        }
        const payload = { type: "extension_ui_response", id };
        if (cmd.cancelled === true) {
          payload.cancelled = true;
        } else if (typeof cmd.confirmed === "boolean") {
          payload.confirmed = cmd.confirmed;
        } else if (typeof cmd.value === "string") {
          payload.value = cmd.value;
        } else {
          writeOut({
            type: "error",
            message:
              "extension_ui_response needs cancelled:true, confirmed:boolean, or value:string"
          });
          return;
        }
        if (typeof bridge.sendRaw !== "function") {
          writeOut({
            type: "error",
            message: "Pi bridge does not support sendRaw for extension_ui_response"
          });
          return;
        }
        bridge.sendRaw(payload);
      } else {
        writeOut({ type: "error", message: `Unknown op: ${String(op)}` });
      }
    } catch (err) {
      writeOut({
        type: "error",
        message: err?.message ?? String(err)
      });
    }
  };

  stdin.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      const idx = buffer.indexOf("\n");
      if (idx < 0) break;
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      void handleLine(line);
    }
  });

  await new Promise((resolve) => {
    if (stdin.readableEnded) {
      resolve();
      return;
    }
    stdin.on("end", resolve);
  });
}

function parseArgvCwd(argv) {
  const idx = argv.indexOf("--cwd");
  if (idx >= 0 && typeof argv[idx + 1] === "string") {
    return argv[idx + 1];
  }
  return process.cwd();
}

const isMain =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const cwd = parseArgvCwd(process.argv);
  runKairoUiRpcStdio({ cwd }).catch((err) => {
    process.stderr.write(`${err?.stack ?? err}\n`);
    process.exitCode = 1;
  });
}
