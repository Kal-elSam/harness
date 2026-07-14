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
  resolveNavAction,
  routeCockpitKey,
  isContentInteractiveView
} from "./cockpit-controller.js";
import {
  COCKPIT_NAV,
  COCKPIT_REGIONS,
  buildFooterModel,
  buildNavModel,
  buildSystemStripModel,
  buildTopBarModel,
  navIndexForView,
  resolveProjectName
} from "./cockpit-models.js";
import { buildControlCenterModel } from "./cockpit-control-center.js";
import { resolveEnterNavIntent } from "./cockpit-enter.js";
import { resolveRunsHubItem, RUNS_HUB_ITEMS } from "./cockpit-runs.js";
import { resolveProjectReadiness } from "../dashboard-guidance.js";
import { CONTROL_PLANE_HEALTH } from "../control-plane-snapshot.js";
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

  const openDestination = (destinationKey) => {
    const view = resolveCtaDestinationView(destinationKey);
    if (!view) return false;
    dispatch({
      type: "set-view",
      view,
      navIndex: navIndexForView(view)
    });
    return true;
  };

  useInput((inputKey, key) => {
    if (data.loading) return;

    if (data.error) {
      if (key.escape) {
        finish({ cancelled: true });
        return;
      }
      if (inputKey.toLowerCase() === "r") {
        if (data.retrying) return;
        // Keep the error screen until success so Esc stays available during retry.
        data.reload({ asRetry: true }).catch(() => {});
      }
      return;
    }

    if (data.busy) return;

    if (key.escape) {
      if (ui.view === ORCHESTRATOR_VIEWS.LAUNCH && data.launchableAgents.length > 0) {
        const retreated = handleLaunchInput({
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
          reload: data.reload,
          allowEscapeRetreat: true
        });
        if (retreated === "retreated") return;
      }

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

    if (inputKey === "?") {
      dispatch({ type: "toggle-help" });
      return;
    }

    const listLength = ui.view === ORCHESTRATOR_VIEWS.RUNS
      ? RUNS_HUB_ITEMS.length
      : ui.view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS
        ? (data.dashboard?.activeRuns ?? []).length
        : ui.view === ORCHESTRATOR_VIEWS.RECENT_RUNS
          ? (data.dashboard?.recentRuns ?? []).length
          : 0;

    let routed = null;
    if (key.tab) {
      routed = routeCockpitKey(ui, { type: "tab" });
    } else if (key.upArrow || key.downArrow) {
      routed = routeCockpitKey(ui, {
        type: "arrow",
        direction: key.upArrow ? "up" : "down",
        listLength
      });
    } else if (key.return) {
      routed = routeCockpitKey(ui, { type: "enter" });
    }

    if (routed) {
      if (routed.type === "enter-nav") {
        const item = resolveNavAction(ui.navIndex);
        const intent = resolveEnterNavIntent({
          currentView: ui.view,
          navItem: item,
          ctaDestination: data.snapshot?.cta?.destination ?? null
        });
        if (intent.kind === "activate-cta") {
          if (openDestination(intent.destination)) return;
        }
        if (intent.kind === "launch") {
          data.resetLaunchWizard();
          dispatch({
            type: "set-view",
            view: ORCHESTRATOR_VIEWS.LAUNCH,
            navIndex: ui.navIndex
          });
          return;
        }
      }
      dispatch(routed);
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

    if (ui.region === COCKPIT_REGIONS.CONTENT
      && ui.view === ORCHESTRATOR_VIEWS.RUNS
      && key.return) {
      const hubItem = resolveRunsHubItem(ui.listIndex);
      if (!hubItem) return;
      if (hubItem.action === "launch") {
        data.resetLaunchWizard();
      }
      dispatch({
        type: "set-view",
        view: hubItem.view,
        navIndex: navIndexForView(ORCHESTRATOR_VIEWS.RUNS)
      });
      return;
    }

    if (ui.region === COCKPIT_REGIONS.CONTENT
      && (ui.view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS || ui.view === ORCHESTRATOR_VIEWS.RECENT_RUNS)
      && key.return) {
      const runs = ui.view === ORCHESTRATOR_VIEWS.ACTIVE_RUNS
        ? data.dashboard?.activeRuns ?? []
        : data.dashboard?.recentRuns ?? [];
      data.openRunDetail(selectRunFromList(runs, ui.listIndex), dispatch, ui.view);
      return;
    }

    if (ui.view === ORCHESTRATOR_VIEWS.RUN_DETAIL) {
      if (inputKey.toLowerCase() === "c" && isRunCancellable(data.selectedRun)) {
        data.handleCancelRun();
        return;
      }
      if (inputKey.toLowerCase() === "r") {
        data.openRunDetail(data.selectedRun, dispatch, ui.returnView);
        return;
      }
    }

    if (inputKey.toLowerCase() === "r" && ui.view !== ORCHESTRATOR_VIEWS.LAUNCH) {
      data.reload().catch(() => {});
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
      React.createElement(Text, { dimColor: true },
        data.retrying ? "Retrying read-only scan…" : "R Retry · Esc to exit")
    );
  }

  const mode = ui.layoutMode ?? LAYOUT_MODES.COMPACT;
  const colorEnabled = caps.color;
  const unicode = caps.unicode;
  const projectName = resolveProjectName(workspaceRoot);
  const readiness = resolveProjectReadiness({
    hasGlobalState,
    diagnostics: data.diagnostics,
    dashboard: data.dashboard
  });
  const controlCenter = buildControlCenterModel({
    projectName,
    snapshot: data.snapshot,
    layoutMode: mode
  });
  const systemOnline = data.snapshot
    ? data.snapshot.health !== CONTROL_PLANE_HEALTH.NOT_CONFIGURED
      && data.snapshot.health !== CONTROL_PLANE_HEALTH.CHECK_FAILED
    : readiness.kind !== "needs_setup";

  return React.createElement(Box, { flexDirection: "column" },
    data.statusMessage && React.createElement(Text, {
      color: COCKPIT_COLORS.success
    }, data.statusMessage),
    React.createElement(CockpitShell, {
      topBar: buildTopBarModel({
        projectName,
        systemOnline,
        unicode
      }),
      footer: buildFooterModel({
        view: ui.view,
        region: ui.region,
        navIndex: ui.navIndex,
        helpOpen: ui.helpOpen,
        canCancel: isRunCancellable(data.selectedRun),
        unicode
      }),
      layoutMode: mode,
      nav: buildNavModel({
        navIndex: ui.navIndex,
        currentView: ui.view,
        focused: ui.region === COCKPIT_REGIONS.NAV || !isContentInteractiveView(ui.view),
        unicode,
        dashboard: data.dashboard,
        diagnostics: data.diagnostics,
        snapshot: data.snapshot
      }),
      system: buildSystemStripModel({
        dashboard: data.dashboard,
        diagnostics: data.diagnostics,
        readiness: data.snapshot
          ? {
            kind: data.snapshot.health.toLowerCase(),
            label: controlCenter.health.label,
            healthKind: data.snapshot.health === CONTROL_PLANE_HEALTH.HEALTHY
              ? "ready"
              : data.snapshot.health === CONTROL_PLANE_HEALTH.CHECK_FAILED
                ? "error"
                : "warn"
          }
          : readiness
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
        snapshot: data.snapshot,
        listIndex: ui.listIndex,
        launchStep: data.launchStep,
        launchDraft: data.launchDraft,
        launchAgentIndex: data.launchAgentIndex,
        launchPermissionIndex: data.launchPermissionIndex,
        launchableAgents: data.launchableAgents,
        selectedRun: data.selectedRun,
        selectedEvents: data.selectedEvents,
        controlCenter,
        layoutMode: mode,
        colorEnabled
      })
    )
  );
}

function resolveCtaDestinationView(destinationKey) {
  switch (destinationKey) {
    case "changes":
      return ORCHESTRATOR_VIEWS.CHANGES;
    case "control-center":
      return ORCHESTRATOR_VIEWS.HOME;
    case "ides":
      return ORCHESTRATOR_VIEWS.IDES;
    case "runs":
      return ORCHESTRATOR_VIEWS.RUNS;
    default:
      return null;
  }
}
