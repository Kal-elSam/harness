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
    reload,
    resetLaunchWizard,
    openRunDetail,
    handleLaunch,
    handleCancelRun
  };
}
