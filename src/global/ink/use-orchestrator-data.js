import { useEffect, useMemo, useState } from "react";
import { buildReadOnlyDiagnostics } from "../action-planner.js";
import { buildControlPlaneSnapshot } from "../control-plane-snapshot.js";
import { buildRuntimeDashboardData } from "../runtime/run-cli.js";
import { readRunEvents } from "../runtime/run-store.js";
import { startRun, stopRun } from "../runtime/run-manager.js";
import {
  createLaunchDraft,
  isRunCancellable,
  resolveLaunchPermissions,
  resolveLaunchableAgents
} from "./orchestrator-state.js";
import { LAUNCH_WIZARD_STEPS, ORCHESTRATOR_VIEWS } from "./orchestrator-state.js";
import {
  CONTROL_PLANE_AUTO_SCAN,
  createSerializedReloader,
  loadCockpitScanBundle
} from "./cockpit-scan.js";
import {
  CHANGES_PHASE,
  createChangesActionState,
  reduceChangesAction
} from "./cockpit-changes.js";
import {
  applyGovernanceSync,
  previewGovernanceSync,
  applyGovernanceRollback,
  previewGovernanceRollback
} from "../governance-actions.js";
import {
  RECOVERY_PHASE,
  createRecoveryActionState,
  listRecoverySnapshots,
  reduceRecoveryAction
} from "./cockpit-recovery.js";

export function useOrchestratorData({
  homeDir,
  workspaceRoot,
  packageName,
  packageRoot,
  cliVersion
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [statusMessage, setStatusMessage] = useState(null);
  const [launchAgentIndex, setLaunchAgentIndex] = useState(0);
  const [launchStep, setLaunchStep] = useState(LAUNCH_WIZARD_STEPS.AGENT);
  const [launchDraft, setLaunchDraft] = useState(createLaunchDraft);
  const [launchPermissionIndex, setLaunchPermissionIndex] = useState(0);
  const [changesAction, setChangesAction] = useState(createChangesActionState);
  const [recoveryAction, setRecoveryAction] = useState(createRecoveryActionState);

  const serializedReload = useMemo(() => createSerializedReloader(() => loadCockpitScanBundle({
    homeDir,
    workspaceRoot,
    packageName,
    packageRoot,
    cliVersion,
    buildDashboard: buildRuntimeDashboardData,
    buildDiagnostics: buildReadOnlyDiagnostics,
    buildSnapshot: buildControlPlaneSnapshot
  })), [homeDir, workspaceRoot, packageName, packageRoot, cliVersion]);

  const reload = async ({ showLoading = false, asRetry = false } = {}) => {
    if (showLoading) setLoading(true);
    if (asRetry) setRetrying(true);
    const outcome = await serializedReload();
    // Keep retrying=true across stale completions so overlapping retries don't clear too early.
    if (outcome.stale) return outcome;

    if (outcome.error) {
      setError(outcome.error instanceof Error ? outcome.error.message : String(outcome.error));
      setLoading(false);
      setRetrying(false);
      throw outcome.error;
    }

    setDashboard(outcome.result.dashboard);
    setDiagnostics(outcome.result.diagnostics);
    setSnapshot(outcome.result.snapshot);
    setError(null);
    setLoading(false);
    setRetrying(false);
    return outcome;
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        await reload({ showLoading: true });
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [homeDir, workspaceRoot, packageName, packageRoot, cliVersion]);

  const resetLaunchWizard = () => {
    setLaunchStep(LAUNCH_WIZARD_STEPS.AGENT);
    setLaunchDraft(createLaunchDraft());
    setLaunchAgentIndex(0);
    setLaunchPermissionIndex(0);
  };

  const openRunDetail = async (run, dispatch, returnView = null) => {
    if (!run) return;
    const events = await readRunEvents(homeDir, run.runId, { limit: 20 });
    setSelectedRun(run);
    setSelectedEvents(events);
    dispatch({
      type: "set-view",
      view: ORCHESTRATOR_VIEWS.RUN_DETAIL,
      returnView: returnView ?? null
    });
  };

  const handleLaunch = async (draft, profile, dispatch) => {
    if (!draft.agentId || !draft.task.trim()) {
      setError("Agent and task are required.");
      return;
    }
    setBusy(true);
    setStatusMessage(`Launching ${draft.agentId}…`);
    try {
      const permissions = resolveLaunchPermissions({
        ...draft,
        permissionIndex: launchPermissionIndex
      });
      const { runId } = await startRun({
        homeDir,
        agentId: draft.agentId,
        task: draft.task.trim(),
        cwd: workspaceRoot,
        model: draft.model.trim() || null,
        permissions,
        cliVersion,
        profile: profile ?? null,
        follow: false,
        wait: false
      });
      await reload();
      const run = (await buildRuntimeDashboardData({ homeDir, workspaceRoot, cliVersion }))
        .runs.find((entry) => entry.runId === runId);
      setStatusMessage(`Run started: ${runId}`);
      resetLaunchWizard();
      dispatch({ type: "set-view", view: ORCHESTRATOR_VIEWS.RUNS });
      if (run) await openRunDetail(run, dispatch, ORCHESTRATOR_VIEWS.ACTIVE_RUNS);
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : String(launchError));
    } finally {
      setBusy(false);
    }
  };

  const handleCancelRun = async () => {
    if (!selectedRun || !isRunCancellable(selectedRun)) return;
    setBusy(true);
    try {
      await stopRun(homeDir, selectedRun.runId);
      await reload();
      const refreshed = await buildRuntimeDashboardData({ homeDir, workspaceRoot, cliVersion });
      const run = refreshed.runs.find((entry) => entry.runId === selectedRun.runId);
      const events = await readRunEvents(homeDir, selectedRun.runId, { limit: 20 });
      setSelectedRun(run ?? selectedRun);
      setSelectedEvents(events);
      setStatusMessage(`Cancelled ${selectedRun.runId}`);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : String(cancelError));
    } finally {
      setBusy(false);
    }
  };

  const previewChanges = async () => {
    setChangesAction((prev) => reduceChangesAction(prev, { type: "preview-start" }));
    setBusy(true);
    try {
      const preview = await previewGovernanceSync({
        homeDir, workspaceRoot, packageName, packageRoot, cliVersion
      });
      setChangesAction((prev) => reduceChangesAction(prev, { type: "preview-ready", preview }));
      return preview;
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : String(previewError);
      setChangesAction((prev) => reduceChangesAction(prev, {
        type: "preview-failed", error: "preview-failed", message
      }));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const cancelChanges = () => {
    setChangesAction((prev) => reduceChangesAction(prev, { type: "cancel" }));
    setStatusMessage("Cancelled — no files written.");
  };

  const confirmApplyChanges = async () => {
    let preview = null;
    setChangesAction((prev) => {
      if (prev.phase !== CHANGES_PHASE.CONFIRMING || !prev.preview) return prev;
      preview = prev.preview;
      return reduceChangesAction(prev, { type: "apply-start" });
    });
    if (!preview) return null;
    setBusy(true);
    try {
      const result = await applyGovernanceSync({
        preview,
        homeDir, workspaceRoot, packageName, packageRoot, cliVersion
      });
      if (result.reason === "stale-preview") {
        setChangesAction((prev) => reduceChangesAction(prev, {
          type: "apply-done",
          ok: false,
          reason: "stale-preview",
          preview: result.preview,
          message: "Preview stale — press A for a fresh preview."
        }));
        return result;
      }
      if (result.reason === "setup-required") {
        setChangesAction((prev) => reduceChangesAction(prev, {
          type: "preview-ready",
          preview: { setupRequired: true }
        }));
        return result;
      }
      await reload();
      setChangesAction((prev) => reduceChangesAction(prev, {
        type: "apply-done",
        ok: result.ok,
        reason: result.reason,
        receipt: result.receipt,
        message: result.ok
          ? (result.partial ? "Applied with partial evidence — re-scan complete." : "Applied — re-scan complete.")
          : `Apply ${result.reason}.`
      }));
      setStatusMessage(result.ok ? "Governance apply recorded." : null);
      return result;
    } catch (applyError) {
      const message = applyError instanceof Error ? applyError.message : String(applyError);
      setChangesAction((prev) => reduceChangesAction(prev, {
        type: "apply-done", ok: false, reason: "apply-failed", message
      }));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const rescanChanges = async () => {
    setChangesAction(() => createChangesActionState());
    await reload();
  };

  const previewRecovery = async (snapshotName) => {
    if (!snapshotName) return null;
    setRecoveryAction((prev) => reduceRecoveryAction(prev, {
      type: "preview-start", snapshot: snapshotName
    }));
    setBusy(true);
    try {
      const preview = await previewGovernanceRollback({ homeDir, snapshot: snapshotName });
      setRecoveryAction((prev) => reduceRecoveryAction(prev, { type: "preview-ready", preview }));
      return preview;
    } catch (previewError) {
      const message = previewError instanceof Error ? previewError.message : String(previewError);
      setRecoveryAction((prev) => reduceRecoveryAction(prev, {
        type: "preview-failed", error: "preview-failed", message
      }));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const cancelRecovery = () => {
    setRecoveryAction((prev) => reduceRecoveryAction(prev, { type: "cancel" }));
    setStatusMessage("Cancelled — previous snapshot kept.");
  };

  const confirmApplyRecovery = async () => {
    let preview = null;
    setRecoveryAction((prev) => {
      if (prev.phase !== RECOVERY_PHASE.CONFIRMING || !prev.preview) return prev;
      preview = prev.preview;
      return reduceRecoveryAction(prev, { type: "apply-start" });
    });
    if (!preview) return null;
    setBusy(true);
    try {
      const result = await applyGovernanceRollback({
        preview, homeDir, cliVersion
      });
      if (result.reason === "stale-preview") {
        setRecoveryAction((prev) => reduceRecoveryAction(prev, {
          type: "apply-done",
          ok: false,
          reason: "stale-preview",
          preview: result.preview,
          message: "Preview stale — press Enter for a fresh preview."
        }));
        return result;
      }
      await reload();
      setRecoveryAction((prev) => reduceRecoveryAction(prev, {
        type: "apply-done",
        ok: result.ok,
        reason: result.reason,
        receipt: result.receipt,
        message: result.ok ? "Rollback applied — re-scan complete." : `Rollback ${result.reason}.`
      }));
      setStatusMessage(result.ok ? "Rollback recorded." : null);
      return result;
    } catch (applyError) {
      const message = applyError instanceof Error ? applyError.message : String(applyError);
      // Keep prior preview so the selected snapshot remains visible after failure.
      setRecoveryAction((prev) => reduceRecoveryAction(prev, {
        type: "apply-done", ok: false, reason: "apply-failed", message, preview: prev.preview
      }));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const rescanRecovery = async () => {
    setRecoveryAction(() => createRecoveryActionState());
    await reload();
  };

  return {
    loading,
    busy,
    retrying,
    error,
    setError,
    dashboard,
    diagnostics,
    snapshot,
    selectedRun,
    setSelectedRun,
    selectedEvents,
    statusMessage,
    launchAgentIndex,
    setLaunchAgentIndex,
    launchStep,
    setLaunchStep,
    launchDraft,
    setLaunchDraft,
    launchPermissionIndex,
    setLaunchPermissionIndex,
    launchableAgents: resolveLaunchableAgents(dashboard?.providers ?? []),
    scanOptions: CONTROL_PLANE_AUTO_SCAN,
    changesAction,
    recoveryAction,
    reload,
    resetLaunchWizard,
    openRunDetail,
    handleLaunch,
    handleCancelRun,
    previewChanges,
    cancelChanges,
    confirmApplyChanges,
    rescanChanges,
    previewRecovery,
    cancelRecovery,
    confirmApplyRecovery,
    rescanRecovery,
    recoverySnapshots: listRecoverySnapshots(snapshot)
  };
}
