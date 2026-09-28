/**
 * Thin JSONL sidecar: Rust kairo-ui ↔ openPiRpcBridge ↔ Pi RPC.
 *
 * stdin commands (one JSON object per LF-terminated line):
 *   { "op": "prompt", "message": "..." }
 *   { "op": "abort" }
 *   { "op": "compact" }
 *   { "op": "cycle_model" }
 *   { "op": "new_session" }
 *   { "op": "switch_session", "sessionPath": "..." }
 *   { "op": "switch_session_index", "index": 0 }
 *   { "op": "list_sessions" }
 *   { "op": "reload_snapshot" }
 *   { "op": "project.preflight" }
 *   { "op": "project.analyze", "analyst"?: { model, selectionSource, recommendationTags, choice } }
 *   { "op": "team.approve" }
 *   { "op": "team.revalidate" }
 *   { "op": "team.recovery.preview" }
 *   { "op": "team.recovery.apply" }
 *   { "op": "team.recovery.reject" }
 *   { "op": "stop" }
 *
 * stdout records (JSONL): { type: "ready", engine, snapshot?, kairoModels?, sessions? },
 * { type: "engine", engine }, { type: "transcript", messages }, { type: "sessions", sessions },
 * { type: "kairoModels", kairoModels }, { type: "team", op, ok, state, teamRows, roles, analyst },
 * { type: "preflight", ok, analystCatalog?, profile?, candidates?, reason? } (the ratatui host's own
 * analyst picker — T2, no cockpit), { type: "availability", ok, reason? } (real re-probe result for
 * `team.revalidate`, followed by a fresh `snapshot`), { type: "recovery", op: "preview"|"apply"|"reject",
 * outcome, ...} (team-recovery.js's own outcomes — "proposed"/"activated"/"approved"/"rejected"/
 * "kept-previous"/"skipped"/"baseline"/"error" — never invented; a stale/refused apply comes back as
 * outcome:"error" and touches nothing), forwarded Pi session events, { type: "error", message }, and
 * bridge engine_unavailable.
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
 */
export async function runKairoUiRpcStdio({
  stdin = process.stdin,
  stdout = process.stdout,
  cwd = process.cwd(),
  openBridge = openPiRpcBridge,
  loadKairoProviderModels: loadModels = loadKairoProviderModels,
  loadSnapshot = loadKairoWorkspaceSnapshot,
  analyzeProjectTeam = analyzeProjectTeamImpl,
  approveProjectTeam = approveProjectTeamImpl,
  preflightProjectTeam = preflightProjectTeamImpl,
  revalidateTeamAvailability = revalidateTeamAvailabilityImpl,
  recoverProjectTeam = recoverProjectTeamImpl,
  approveRecoveryProposal = approveRecoveryProposalImpl,
  rejectRecoveryProposal = rejectRecoveryProposalImpl
} = {}) {
  const bridge = await openBridge({ cwd });
  let kairoModels = [];
  try {
    kairoModels = await loadModels({ cwd });
  } catch {
    kairoModels = [];
  }
  let sessionFiles = listPiSessionFilesForCwd({ cwd, env: process.env });

  const writeOut = (record) => {
    stdout.write(`${JSON.stringify(record)}\n`);
  };

  writeOut({
    type: "ready",
    engine: bridge.engine,
    snapshot: bridge.snapshot,
    kairoModels: serializeKairoModelsForHost(kairoModels),
    sessions: sessionFiles.map(({ path, sessionId, label }) => ({
      path,
      sessionId,
      label
    })),
    sessionsNote:
      sessionFiles.length === 0
        ? "No Pi session files on disk for this cwd (RPC has no list_sessions; use new_session or create via Pi)."
        : null
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
        const result = await bridge.request({ type: "new_session" });
        if (result?.cancelled) {
          writeOut({ type: "notice", message: "New session cancelled by extension" });
          return;
        }
        sessionFiles = listPiSessionFilesForCwd({ cwd, env: process.env });
        writeOut({
          type: "sessions",
          sessions: sessionFiles.map(({ path, sessionId, label }) => ({
            path,
            sessionId,
            label
          }))
        });
        await applyEngineAndMaybeTranscript({
          reloadTranscript: true,
          reapplyArchitect: true
        });
      } else if (op === "switch_session") {
        const sessionPath = typeof cmd.sessionPath === "string" ? cmd.sessionPath : "";
        if (!sessionPath) {
          writeOut({ type: "error", message: "switch_session requires sessionPath" });
          return;
        }
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
      } else if (op === "switch_session_index") {
        sessionFiles = listPiSessionFilesForCwd({ cwd, env: process.env });
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
      } else if (op === "list_sessions") {
        sessionFiles = listPiSessionFilesForCwd({ cwd, env: process.env });
        writeOut({
          type: "sessions",
          sessions: sessionFiles.map(({ path, sessionId, label }) => ({
            path,
            sessionId,
            label
          })),
          sessionsNote:
            sessionFiles.length === 0
              ? "No Pi session files on disk for this cwd (RPC has no list_sessions)."
              : null
        });
      } else if (op === "stop") {
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
