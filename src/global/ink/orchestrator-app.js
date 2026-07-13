import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { BRAND } from "../brand/index.js";
import { buildReadOnlyDiagnostics } from "../action-planner.js";
import { buildRuntimeDashboardData } from "../runtime/run-cli.js";
import { readRunEvents } from "../runtime/run-store.js";
import { stopRun } from "../runtime/run-manager.js";
import { startRun } from "../runtime/run-manager.js";
import {
  ORCHESTRATOR_MENU,
  ORCHESTRATOR_VIEWS,
  LAUNCH_WIZARD_STEPS,
  LAUNCH_PERMISSION_OPTIONS,
  createLaunchDraft,
  formatDashboardSnapshot,
  formatDiagnosticsLines,
  formatLaunchWizardLines,
  formatProviderLines,
  formatRunDetailLines,
  formatRunLines,
  isRunCancellable,
  resolveLaunchPermissions,
  resolveLaunchableAgents,
  resolveMenuItem,
  resolveMenuItemView,
  retreatLaunchWizardStep,
  selectRunFromList,
  shiftMenuIndex
} from "./orchestrator-state.js";
import {
  formatDashboardPurpose,
  resolveDashboardRecommendation
} from "../dashboard-guidance.js";

const COLORS = {
  accent: "cyan",
  success: "green",
  warning: "yellow",
  danger: "red",
  muted: "gray"
};

export function OrchestratorApp({
  homeDir,
  workspaceRoot,
  packageName,
  packageRoot,
  cliVersion,
  hasGlobalState = false,
  onComplete
}) {
  const { exit } = useApp();
  const [view, setView] = useState(ORCHESTRATOR_VIEWS.HOME);
  const [menuIndex, setMenuIndex] = useState(0);
  const [listIndex, setListIndex] = useState(0);
  const [launchAgentIndex, setLaunchAgentIndex] = useState(0);
  const [launchStep, setLaunchStep] = useState(LAUNCH_WIZARD_STEPS.AGENT);
  const [launchDraft, setLaunchDraft] = useState(createLaunchDraft);
  const [launchPermissionIndex, setLaunchPermissionIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [selectedRun, setSelectedRun] = useState(null);
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [statusMessage, setStatusMessage] = useState(null);

  const reload = async () => {
    const [dash, diag] = await Promise.all([
      buildRuntimeDashboardData({ homeDir, workspaceRoot, cliVersion }),
      buildReadOnlyDiagnostics({ homeDir, workspaceRoot, packageName, packageRoot, cliVersion })
    ]);
    setDashboard(dash);
    setDiagnostics(diag);
  };

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        await reload();
        if (cancelled) return;
        setLoading(false);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [homeDir, workspaceRoot, packageName, packageRoot, cliVersion]);

  const finish = (outcome) => {
    onComplete(outcome);
    exit();
  };

  const openRunDetail = async (run) => {
    if (!run) return;
    const events = await readRunEvents(homeDir, run.runId, { limit: 20 });
    setSelectedRun(run);
    setSelectedEvents(events);
    setView(ORCHESTRATOR_VIEWS.RUN_DETAIL);
  };

  const launchableAgents = resolveLaunchableAgents(dashboard?.providers ?? []);

  const resetLaunchWizard = () => {
    setLaunchStep(LAUNCH_WIZARD_STEPS.AGENT);
    setLaunchDraft(createLaunchDraft());
    setLaunchAgentIndex(0);
    setLaunchPermissionIndex(0);
  };

  const handleLaunch = async (draft) => {
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
        profile: dashboard?.profile ?? null,
        follow: false,
        wait: false
      });
      await reload();
      const run = (await buildRuntimeDashboardData({ homeDir, workspaceRoot, cliVersion }))
        .runs.find((entry) => entry.runId === runId);
      setStatusMessage(`Run started: ${runId}`);
      resetLaunchWizard();
      setView(ORCHESTRATOR_VIEWS.HOME);
      if (run) await openRunDetail(run);
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

  useInput((inputKey, key) => {
    if (key.escape) {
      if (view === ORCHESTRATOR_VIEWS.HOME) {
        finish({ cancelled: true });
        return;
      }
      setView(ORCHESTRATOR_VIEWS.HOME);
      setSelectedRun(null);
      setListIndex(0);
      return;
    }

    if (loading || error || busy) return;

    if (view === ORCHESTRATOR_VIEWS.LAUNCH) {
      if (launchableAgents.length === 0) {
        if (key.escape) {
          resetLaunchWizard();
          setView(ORCHESTRATOR_VIEWS.HOME);
        }
        return;
      }

      if (launchStep === LAUNCH_WIZARD_STEPS.AGENT) {
        if (key.upArrow) {
          setLaunchAgentIndex((index) => Math.max(0, index - 1));
          return;
        }
        if (key.downArrow) {
          setLaunchAgentIndex((index) => Math.min(launchableAgents.length - 1, index + 1));
          return;
        }
        if (key.return) {
          const agentId = launchableAgents[launchAgentIndex];
          setLaunchDraft((draft) => ({ ...draft, agentId }));
          setLaunchStep(LAUNCH_WIZARD_STEPS.TASK);
        }
        return;
      }

      if (launchStep === LAUNCH_WIZARD_STEPS.TASK) {
        if (key.return) {
          if (!launchDraft.task.trim()) {
            setError("Task cannot be empty.");
            return;
          }
          setLaunchStep(LAUNCH_WIZARD_STEPS.MODEL);
          return;
        }
        if (key.backspace || key.delete) {
          setLaunchDraft((draft) => ({ ...draft, task: draft.task.slice(0, -1) }));
          return;
        }
        if (inputKey && inputKey.length === 1 && !key.ctrl && !key.meta) {
          setLaunchDraft((draft) => ({ ...draft, task: `${draft.task}${inputKey}` }));
        }
        return;
      }

      if (launchStep === LAUNCH_WIZARD_STEPS.MODEL) {
        if (key.return) {
          setLaunchStep(LAUNCH_WIZARD_STEPS.PERMISSIONS);
          return;
        }
        if (key.backspace || key.delete) {
          setLaunchDraft((draft) => ({ ...draft, model: draft.model.slice(0, -1) }));
          return;
        }
        if (inputKey && inputKey.length === 1 && !key.ctrl && !key.meta) {
          setLaunchDraft((draft) => ({ ...draft, model: `${draft.model}${inputKey}` }));
        }
        return;
      }

      if (launchStep === LAUNCH_WIZARD_STEPS.PERMISSIONS) {
        if (key.upArrow) {
          setLaunchPermissionIndex((index) => Math.max(0, index - 1));
          return;
        }
        if (key.downArrow) {
          setLaunchPermissionIndex((index) => Math.min(LAUNCH_PERMISSION_OPTIONS.length - 1, index + 1));
          return;
        }
        if (key.return) {
          setLaunchStep(LAUNCH_WIZARD_STEPS.CONFIRM);
        }
        return;
      }

      if (launchStep === LAUNCH_WIZARD_STEPS.CONFIRM) {
        if (key.return) {
          handleLaunch({ ...launchDraft, permissionIndex: launchPermissionIndex });
        }
        if (key.escape) {
          setLaunchStep(retreatLaunchWizardStep(launchStep));
        }
        return;
      }

      if (inputKey.toLowerCase() === "r") {
        reload().catch((reloadError) => {
          setError(reloadError instanceof Error ? reloadError.message : String(reloadError));
        });
      }
      return;
    }

    if (view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS || view === ORCHESTRATOR_VIEWS.RECENT_RUNS) {
      const runs = view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS
        ? dashboard?.activeRuns ?? []
        : dashboard?.recentRuns ?? [];

      if (key.upArrow) {
        setListIndex((index) => Math.max(0, index - 1));
        return;
      }
      if (key.downArrow) {
        setListIndex((index) => Math.min(Math.max(runs.length - 1, 0), index + 1));
        return;
      }
      if (key.return) {
        openRunDetail(selectRunFromList(runs, listIndex));
      }
      if (inputKey.toLowerCase() === "r") {
        reload().catch((reloadError) => {
          setError(reloadError instanceof Error ? reloadError.message : String(reloadError));
        });
      }
      return;
    }

    if (view === ORCHESTRATOR_VIEWS.RUN_DETAIL) {
      if (inputKey.toLowerCase() === "c" && isRunCancellable(selectedRun)) {
        handleCancelRun();
      }
      if (inputKey.toLowerCase() === "r") {
        openRunDetail(selectedRun);
      }
      return;
    }

    if (view !== ORCHESTRATOR_VIEWS.HOME) {
      if (inputKey.toLowerCase() === "r") {
        reload().catch((reloadError) => {
          setError(reloadError instanceof Error ? reloadError.message : String(reloadError));
        });
      }
      return;
    }

    if (key.upArrow) {
      setMenuIndex((index) => shiftMenuIndex(index, "up"));
      return;
    }

    if (key.downArrow) {
      setMenuIndex((index) => shiftMenuIndex(index, "down"));
      return;
    }

    if (!key.return) return;

    const item = resolveMenuItem(menuIndex);
    if (item?.action === "launch") {
      resetLaunchWizard();
      setView(ORCHESTRATOR_VIEWS.LAUNCH);
      return;
    }

    setView(resolveMenuItemView(menuIndex));
    setListIndex(0);
  });

  if (loading) {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, { bold: true, color: COLORS.accent }, BRAND.displayName),
      React.createElement(Text, { color: COLORS.muted }, "Loading runtime dashboard…")
    );
  }

  if (error) {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, { bold: true, color: COLORS.danger }, "Runtime error"),
      React.createElement(Text, null, error),
      React.createElement(Text, { dimColor: true }, "Esc to exit")
    );
  }

  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, { bold: true, color: COLORS.accent }, `${BRAND.displayName} runtime`),
    React.createElement(Text, { color: COLORS.muted }, formatDashboardPurpose()),
    statusMessage && React.createElement(Text, { color: COLORS.success }, statusMessage),
    React.createElement(Text, null, ""),
    renderView({
      view,
      dashboard,
      diagnostics,
      hasGlobalState,
      menuIndex,
      listIndex,
      launchStep,
      launchDraft,
      launchAgentIndex,
      launchPermissionIndex,
      launchableAgents,
      selectedRun,
      selectedEvents
    }),
    React.createElement(Text, null, ""),
    React.createElement(Text, { dimColor: true }, footerHint(view, selectedRun, launchStep))
  );
}

function renderView({
  view,
  dashboard,
  diagnostics,
  hasGlobalState,
  menuIndex,
  listIndex,
  launchStep,
  launchDraft,
  launchAgentIndex,
  launchPermissionIndex,
  launchableAgents,
  selectedRun,
  selectedEvents
}) {
  switch (view) {
    case ORCHESTRATOR_VIEWS.HOME: {
      const nextStep = resolveDashboardRecommendation({
        hasGlobalState,
        diagnostics,
        dashboard
      });
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Next"),
        React.createElement(Text, { color: COLORS.accent }, nextStep.message),
        React.createElement(Text, null, ""),
        React.createElement(Text, { bold: true }, "Operations"),
        ORCHESTRATOR_MENU.map((item, index) =>
          React.createElement(Text, {
            key: item.id,
            color: index === menuIndex ? COLORS.accent : undefined,
            bold: index === menuIndex
          }, `${index === menuIndex ? "› " : "  "}${item.label}`)
        ),
        React.createElement(Text, null, ""),
        React.createElement(Text, { bold: true }, "Snapshot"),
        formatDashboardSnapshot(dashboard)
          .map((line) => React.createElement(Text, { key: line }, line))
      );
    }
    case ORCHESTRATOR_VIEWS.ACTIVE_RUNS:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Active runs"),
        formatRunLines(dashboard?.activeRuns ?? [], { emptyMessage: "No active runs." })
          .map((line, index) => React.createElement(Text, {
            key: line,
            color: index === listIndex ? COLORS.accent : undefined,
            bold: index === listIndex
          }, `${index === listIndex ? "› " : "  "}${line}`))
      );
    case ORCHESTRATOR_VIEWS.RECENT_RUNS:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Recent runs"),
        formatRunLines(dashboard?.recentRuns ?? [], { emptyMessage: "No completed runs yet." })
          .map((line, index) => React.createElement(Text, {
            key: line,
            color: index === listIndex ? COLORS.accent : undefined,
            bold: index === listIndex
          }, `${index === listIndex ? "› " : "  "}${line}`))
      );
    case ORCHESTRATOR_VIEWS.PROVIDERS:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Providers"),
        formatProviderLines(dashboard?.providers ?? [])
          .map((line) => React.createElement(Text, { key: line }, line))
      );
    case ORCHESTRATOR_VIEWS.LAUNCH:
      if (launchableAgents.length === 0) {
        return React.createElement(Box, { flexDirection: "column" },
          React.createElement(Text, { bold: true }, "Launch run"),
          React.createElement(Text, { color: COLORS.warning }, "No launchable agents detected."),
          React.createElement(Text, { dimColor: true }, "Esc to return")
        );
      }
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Launch run"),
        formatLaunchWizardLines({
          step: launchStep,
          draft: launchDraft,
          launchableAgents,
          agentIndex: launchAgentIndex,
          permissionIndex: launchPermissionIndex
        }).map((line) => React.createElement(Text, { key: line, color: line.startsWith("›") ? COLORS.accent : undefined }, line))
      );
    case ORCHESTRATOR_VIEWS.RUN_DETAIL:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Run detail"),
        formatRunDetailLines(selectedRun, selectedEvents)
          .map((line) => React.createElement(Text, { key: line }, line))
      );
    case ORCHESTRATOR_VIEWS.DIAGNOSTICS:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Diagnostics"),
        formatDiagnosticsLines(diagnostics)
          .map((line) => React.createElement(Text, { key: line }, line))
      );
    case ORCHESTRATOR_VIEWS.HELP:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Help"),
        React.createElement(Text, null, "Kairo runtime launches and audits agent CLIs you manage."),
        React.createElement(Text, null, "CLI: kairo run --agent <id> --task \"...\""),
        React.createElement(Text, null, "CLI: kairo runs list|show|stop"),
        React.createElement(Text, null, "Audit trail: ~/.harness/runs/<runId>/"),
        React.createElement(Text, null, "Transcripts are opt-in via --capture-transcript."),
        React.createElement(Text, null, "Credentials stay in environment variables — never in profiles.")
      );
    default: {
      const _exhaustive = view;
      return React.createElement(Text, null, `Unknown view: ${_exhaustive}`);
    }
  }
}

function footerHint(view, selectedRun, launchStep) {
  if (view === ORCHESTRATOR_VIEWS.HOME) return "↑↓ navigate · Enter select · Esc quit";
  if (view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS || view === ORCHESTRATOR_VIEWS.RECENT_RUNS) {
    return "↑↓ select run · Enter inspect · R refresh · Esc menu";
  }
  if (view === ORCHESTRATOR_VIEWS.LAUNCH) {
    if (launchStep === LAUNCH_WIZARD_STEPS.TASK || launchStep === LAUNCH_WIZARD_STEPS.MODEL) {
      return "Type · Enter next · Esc menu";
    }
    if (launchStep === LAUNCH_WIZARD_STEPS.CONFIRM) {
      return "Enter launch · Esc back · R refresh";
    }
    return "↑↓ navigate · Enter select · Esc menu";
  }
  if (view === ORCHESTRATOR_VIEWS.RUN_DETAIL) {
    if (isRunCancellable(selectedRun)) return "C cancel · R refresh · Esc menu";
    return "R refresh · Esc menu";
  }
  return "R refresh · Esc menu";
}
