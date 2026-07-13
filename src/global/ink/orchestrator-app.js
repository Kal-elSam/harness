import React, { useEffect, useReducer } from "react";
import { Box, Text, useApp, useInput } from "ink";
import {
  ORCHESTRATOR_VIEWS,
  isRunCancellable,
  selectRunFromList
} from "./orchestrator-state.js";
import {
  createCockpitUiState,
  reduceCockpitUi,
  resolveNavAction
} from "./cockpit-controller.js";
import {
  COCKPIT_REGIONS,
  buildFooterModel,
  buildHomeMissionModel,
  buildNavModel,
  buildSystemStripModel,
  buildTopBarModel,
  resolveProjectName
} from "./cockpit-models.js";
import { CockpitShell } from "./cockpit/primitives.js";
import { renderCockpitView } from "./cockpit-views.js";
import { handleLaunchInput } from "./launch-input.js";
import { useTerminalSize } from "./use-terminal-size.js";
import { useOrchestratorData } from "./use-orchestrator-data.js";
import { resolveTerminalCapabilities } from "./terminal-capabilities.js";
import { COCKPIT_COLORS } from "./theme.js";
import { LAYOUT_MODES } from "./layout.js";

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
  const { columns, rows, layoutMode } = useTerminalSize();
  const caps = resolveTerminalCapabilities({ columns, rows, isTTY: true });
  const [ui, dispatch] = useReducer(
    reduceCockpitUi,
    createCockpitUiState({
      layoutMode: layoutMode ?? LAYOUT_MODES.COMPACT,
      region: COCKPIT_REGIONS.NAV
    })
  );
  const data = useOrchestratorData({
    homeDir,
    workspaceRoot,
    packageName,
    packageRoot,
    cliVersion
  });

  useEffect(() => {
    if (layoutMode) dispatch({ type: "resize", layoutMode });
  }, [layoutMode]);

  const finish = (outcome) => {
    onComplete(outcome);
    exit();
  };

  useInput((inputKey, key) => {
    if (key.escape) {
      const next = reduceCockpitUi(ui, { type: "escape" });
      if (next.shouldExit) {
        finish({ cancelled: true });
        return;
      }
      data.setSelectedRun(null);
      data.resetLaunchWizard();
      dispatch({ type: "escape" });
      return;
    }

    if (data.loading || data.error || data.busy) return;

    if (inputKey === "?") {
      dispatch({ type: "toggle-help" });
      return;
    }
    if (key.tab) {
      dispatch({ type: "tab" });
      return;
    }

    if (ui.view === ORCHESTRATOR_VIEWS.LAUNCH && data.launchableAgents.length > 0) {
      if (handleLaunchInput({
        key,
        inputKey,
        launchStep: data.launchStep,
        launchDraft: data.launchDraft,
        launchableAgents: data.launchableAgents,
        launchAgentIndex: data.launchAgentIndex,
        launchPermissionIndex: data.launchPermissionIndex,
        setLaunchAgentIndex: data.setLaunchAgentIndex,
        setLaunchDraft: data.setLaunchDraft,
        setLaunchStep: data.setLaunchStep,
        setLaunchPermissionIndex: data.setLaunchPermissionIndex,
        setError: data.setError,
        handleLaunch: (draft) => data.handleLaunch(draft, data.dashboard?.profile, dispatch),
        reload: data.reload
      })) {
        return;
      }
    }

    if (ui.view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS || ui.view === ORCHESTRATOR_VIEWS.RECENT_RUNS) {
      const runs = ui.view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS
        ? data.dashboard?.activeRuns ?? []
        : data.dashboard?.recentRuns ?? [];
      if (key.upArrow || key.downArrow) {
        dispatch({
          type: "arrow",
          direction: key.upArrow ? "up" : "down",
          listLength: runs.length
        });
        return;
      }
      if (key.return) {
        data.openRunDetail(selectRunFromList(runs, ui.listIndex), dispatch);
        return;
      }
    }

    if (ui.view === ORCHESTRATOR_VIEWS.RUN_DETAIL) {
      if (inputKey.toLowerCase() === "c" && isRunCancellable(data.selectedRun)) {
        data.handleCancelRun();
        return;
      }
      if (inputKey.toLowerCase() === "r") {
        data.openRunDetail(data.selectedRun, dispatch);
        return;
      }
    }

    if (inputKey.toLowerCase() === "r" && ui.view !== ORCHESTRATOR_VIEWS.LAUNCH) {
      data.reload().catch((reloadError) => {
        data.setError(reloadError instanceof Error ? reloadError.message : String(reloadError));
      });
      return;
    }

    if (ui.view === ORCHESTRATOR_VIEWS.HOME || ui.region === COCKPIT_REGIONS.NAV) {
      if (key.upArrow || key.downArrow) {
        dispatch({ type: "arrow", direction: key.upArrow ? "up" : "down" });
        return;
      }
      if (key.return) {
        const item = resolveNavAction(ui.navIndex);
        if (item?.action === "launch") {
          data.resetLaunchWizard();
          dispatch({ type: "set-view", view: ORCHESTRATOR_VIEWS.LAUNCH });
          return;
        }
        dispatch({ type: "enter-nav" });
      }
    }
  });

  if (data.loading) {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, { bold: true, color: COCKPIT_COLORS.primary }, "KAIRO"),
      React.createElement(Text, { color: COCKPIT_COLORS.muted }, "Loading cockpit…")
    );
  }

  if (data.error) {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, { bold: true, color: COCKPIT_COLORS.danger }, "Runtime error"),
      React.createElement(Text, null, data.error),
      React.createElement(Text, { dimColor: true }, "Esc to exit")
    );
  }

  const mode = ui.layoutMode ?? LAYOUT_MODES.COMPACT;
  const colorEnabled = caps.color;
  const unicode = caps.unicode;

  return React.createElement(Box, { flexDirection: "column" },
    data.statusMessage && React.createElement(Text, {
      color: COCKPIT_COLORS.success
    }, data.statusMessage),
    React.createElement(CockpitShell, {
      topBar: buildTopBarModel({
        projectName: resolveProjectName(workspaceRoot),
        systemOnline: true,
        unicode
      }),
      footer: buildFooterModel({
        view: ui.view,
        region: ui.region,
        helpOpen: ui.helpOpen,
        canCancel: isRunCancellable(data.selectedRun),
        unicode
      }),
      layoutMode: mode,
      nav: buildNavModel({
        navIndex: ui.navIndex,
        focused: ui.region === COCKPIT_REGIONS.NAV,
        unicode
      }),
      system: buildSystemStripModel({
        dashboard: data.dashboard,
        diagnostics: data.diagnostics,
        healthKind: "ready"
      }),
      navFocused: ui.region === COCKPIT_REGIONS.NAV,
      contentFocused: ui.region === COCKPIT_REGIONS.CONTENT,
      systemFocused: ui.region === COCKPIT_REGIONS.SYSTEM,
      colorEnabled
    },
      renderCockpitView({
        view: ui.view,
        dashboard: data.dashboard,
        diagnostics: data.diagnostics,
        listIndex: ui.listIndex,
        launchStep: data.launchStep,
        launchDraft: data.launchDraft,
        launchAgentIndex: data.launchAgentIndex,
        launchPermissionIndex: data.launchPermissionIndex,
        launchableAgents: data.launchableAgents,
        selectedRun: data.selectedRun,
        selectedEvents: data.selectedEvents,
        homeMission: buildHomeMissionModel({
          hasGlobalState,
          diagnostics: data.diagnostics,
          dashboard: data.dashboard,
          layoutMode: mode,
          activityLines: (data.dashboard?.recentRuns ?? []).map((run) =>
            `${run.runId} ${run.state} ${run.agentId}`
          )
        }),
        colorEnabled
      })
    )
  );
}
