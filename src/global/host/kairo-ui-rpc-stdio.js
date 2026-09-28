/**
 * Thin JSONL sidecar: Rust kairo-ui ↔ openPiRpcBridge ↔ Pi RPC.
 *
 * stdin commands (one JSON object per LF-terminated line):
 *   { "op": "prompt", "message": "..." }
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
export async function emitTranscriptFromPi(bridge, cwd, writeOut) {
  const rows = await fetchTranscriptRows(bridge);
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
  saveDraft: saveDraftImpl = saveDraftDefault
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

  bridge.onEvent((ev) => writeOut(ev));

  let buffer = "";
  let stopped = false;

  const applyEngineAndMaybeTranscript = async ({
    reloadTranscript = false,
    reapplyArchitect = false
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
    if (reloadTranscript) {
      await emitTranscriptFromPi(bridge, cwd, writeOut);
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
        const message = typeof cmd.message === "string" ? cmd.message : "";
        await bridge.request({ type: "prompt", message });
      } else if (op === "abort") {
        await bridge.request({ type: "abort" });
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
        await applyEngineAndMaybeTranscript({
          reloadTranscript: true,
          reapplyArchitect: true
        });
        // Extension (when loaded) may already have minted+bound; otherwise
        // the new Pi file stays unbound. Never invent an id here — New's
        // draft is always empty.
        activeKairoSessionId = await lookupKairoIdForPi(bridge.engine?.sessionId ?? null);
        await emitActiveDraft({ text: "" });
      } else if (op === "switch_session") {
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
        await applyEngineAndMaybeTranscript({
          reloadTranscript: true,
          reapplyArchitect: true
        });
        const matched = sessionFiles.find((f) => f.path === sessionPath);
        activeKairoSessionId = await lookupKairoIdForPi(
          matched?.sessionId ?? bridge.engine?.sessionId ?? null
        );
        await emitActiveDraft();
      } else if (op === "switch_session_index") {
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
          reapplyArchitect: true
        });
        activeKairoSessionId = await lookupKairoIdForPi(target.sessionId ?? null);
        await emitActiveDraft();
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
        await applyEngineAndMaybeTranscript({
          reloadTranscript: true,
          reapplyArchitect: true
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
        writeOut({ type: "notice", message: "Session forked — now on the new copy." });
      } else if (op === "stop") {
        if (activeKairoSessionId && projectRoot) {
          const draftText = typeof cmd.draft === "string" ? cmd.draft : "";
          try {
            await saveDraftImpl(homeDir, projectRoot, activeKairoSessionId, draftText);
          } catch {
            // Best-effort — never block shutdown over a failed draft save.
          }
        }
        stopped = true;
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
