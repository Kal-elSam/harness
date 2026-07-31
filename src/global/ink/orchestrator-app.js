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
  COCKPIT_REGIONS,
  buildFooterModel,
  buildNavModel,
  buildTopBarModel,
  navIndexForView,
  resolveProjectName
} from "./cockpit-models.js";
import { buildControlCenterModel } from "./cockpit-control-center.js";
import {
  buildPaletteActions,
  buildPaletteModel,
  canOpenPalette,
  PALETTE_KINDS,
  resolvePaletteDestination
} from "./cockpit-palette.js";
import { resolveEnterNavIntent } from "./cockpit-enter.js";
import { resolveRunsHubItem, RUNS_HUB_ITEMS } from "./cockpit-runs.js";
import { selectReviewFromList } from "./cockpit-reviews.js";
import { selectAlertFromList } from "./cockpit-alerts.js";
import { ALERT_STATES } from "../runtime/alerts/alert-types.js";
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
import { CHANGES_PHASE } from "./cockpit-changes.js";
import { RECOVERY_PHASE, listRecoverySnapshots } from "./cockpit-recovery.js";
import { SETTINGS_PHASE } from "./cockpit-settings.js";

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
    const view = resolvePaletteDestination(destinationKey);
    if (!view) return false;
    dispatch({
      type: "set-view",
      view,
      navIndex: navIndexForView(view)
    });
    return true;
  };

  const confirming = data.changesAction?.phase === CHANGES_PHASE.CONFIRMING
    || data.recoveryAction?.phase === RECOVERY_PHASE.CONFIRMING
    || data.settingsAction?.phase === SETTINGS_PHASE.CONFIRMING;
  const paletteActions = buildPaletteActions({
    ctaDestination: data.snapshot?.cta?.destination ?? null,
    ctaTitle: data.snapshot?.cta?.title ?? null,
    ctaDetail: data.snapshot?.cta?.detail ?? null
  });

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

    if (ui.paletteOpen) {
      if (key.escape) {
        dispatch({ type: "close-palette" });
        return;
      }
      if (inputKey === "/") {
        dispatch({ type: "toggle-palette" });
        return;
      }
      if (key.upArrow || key.downArrow) {
        dispatch({
          type: "palette-arrow",
          direction: key.upArrow ? "up" : "down",
          listLength: paletteActions.length
        });
        return;
      }
      if (key.return) {
        const selected = paletteActions[ui.paletteIndex] ?? null;
        if (!selected) return;
        if (selected.kind === PALETTE_KINDS.REFRESH) {
          dispatch({ type: "run-palette", kind: selected.kind });
          data.reload().catch(() => {});
          return;
        }
        if (selected.kind === PALETTE_KINDS.SETUP) {
          finish({ cancelled: false, action: "setup" });
          return;
        }
        dispatch({
          type: "run-palette",
          kind: selected.kind,
          view: selected.view
        });
      }
      return;
    }

    if (inputKey === "/"
      && canOpenPalette({ loading: data.loading, busy: data.busy, confirming })) {
      dispatch({ type: "toggle-palette" });
      return;
    }

    if (inputKey === " " && ui.view === ORCHESTRATOR_VIEWS.HOME && !ui.paletteOpen) {
      dispatch({ type: "toggle-overview-details" });
      return;
    }

    if (inputKey === " " && ui.view === ORCHESTRATOR_VIEWS.CHANGES && !ui.paletteOpen) {
      dispatch({ type: "toggle-governance-details" });
      return;
    }

    if (inputKey === " "
      && ui.view === ORCHESTRATOR_VIEWS.ACTIVITY
      && !ui.paletteOpen
      && data.recoveryAction?.preview) {
      dispatch({ type: "toggle-activity-details" });
      return;
    }

    if (key.escape) {
      if (ui.view === ORCHESTRATOR_VIEWS.CHANGES
        && data.changesAction?.phase === CHANGES_PHASE.CONFIRMING) {
        data.cancelChanges();
        return;
      }
      if (ui.view === ORCHESTRATOR_VIEWS.ACTIVITY
        && data.recoveryAction?.phase === RECOVERY_PHASE.CONFIRMING) {
        data.cancelRecovery();
        return;
      }
      if (ui.view === ORCHESTRATOR_VIEWS.PROFILE) {
        const settingsPhase = data.settingsAction?.phase;
        if (settingsPhase === SETTINGS_PHASE.CONFIRMING) {
          data.cancelSettings();
          return;
        }
        if (settingsPhase === SETTINGS_PHASE.PREVIEW
          || settingsPhase === SETTINGS_PHASE.COMPLETED) {
          data.resetSettings();
          return;
        }
      }

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
      data.setSelectedReview(null);
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
          : ui.view === ORCHESTRATOR_VIEWS.REVIEWS
            ? (data.reviews ?? []).length
            : ui.view === ORCHESTRATOR_VIEWS.ALERTS
              ? (Array.isArray(data.alerts) ? data.alerts : [])
                .filter((alert) => alert.state === ALERT_STATES.OPEN).length
              : ui.view === ORCHESTRATOR_VIEWS.ACTIVITY
                ? listRecoverySnapshots(data.snapshot).length
                : ui.view === ORCHESTRATOR_VIEWS.PROFILE
                    && data.settingsAction?.phase === SETTINGS_PHASE.BROWSE
                  ? data.curatedIntegrations.length
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
        if (intent.kind === "activate-setup") {
          finish({ cancelled: false, action: "setup" });
          return;
        }
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
      if (hubItem.view === ORCHESTRATOR_VIEWS.REVIEWS) {
        data.loadReviews().catch(() => {});
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

    if (ui.region === COCKPIT_REGIONS.CONTENT
      && ui.view === ORCHESTRATOR_VIEWS.REVIEWS
      && key.return) {
      data.openReviewDetail(selectReviewFromList(data.reviews ?? [], ui.listIndex), dispatch);
      return;
    }

    if (ui.region === COCKPIT_REGIONS.CONTENT
      && ui.view === ORCHESTRATOR_VIEWS.ALERTS) {
      const selected = selectAlertFromList(data.alerts, ui.listIndex);
      if (key.return) {
        data.handleAlertTransition(selected, "resolve").catch(() => {});
        return;
      }
      if (inputKey.toLowerCase() === "d") {
        data.handleAlertTransition(selected, "dismiss").catch(() => {});
        return;
      }
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

    if (ui.view === ORCHESTRATOR_VIEWS.CHANGES) {
      const keyName = inputKey.toLowerCase();
      if (keyName === "a") {
        data.previewChanges().then((preview) => {
          if (preview?.setupRequired) openDestination("control-center");
        }).catch(() => {});
        return;
      }
      if (keyName === "y" && data.changesAction?.phase === CHANGES_PHASE.CONFIRMING) {
        data.confirmApplyChanges().then((result) => {
          if (result?.reason === "setup-required") openDestination("control-center");
        }).catch(() => {});
        return;
      }
      if (keyName === "n") {
        if (data.changesAction?.phase === CHANGES_PHASE.CONFIRMING) data.cancelChanges();
        return;
      }
      if (keyName === "r") {
        data.rescanChanges().catch(() => {});
        return;
      }
    }

    if (ui.view === ORCHESTRATOR_VIEWS.ACTIVITY) {
      const keyName = inputKey.toLowerCase();
      if (key.return && ui.region === COCKPIT_REGIONS.CONTENT) {
        const entry = listRecoverySnapshots(data.snapshot)[ui.listIndex];
        if (entry?.name) data.previewRecovery(entry.name).catch(() => {});
        return;
      }
      if (keyName === "y" && data.recoveryAction?.phase === RECOVERY_PHASE.CONFIRMING) {
        data.confirmApplyRecovery().catch(() => {});
        return;
      }
      if (keyName === "n") {
        if (data.recoveryAction?.phase === RECOVERY_PHASE.CONFIRMING) data.cancelRecovery();
        return;
      }
      if (keyName === "r") {
        data.rescanRecovery().catch(() => {});
        return;
      }
    }

    if (ui.view === ORCHESTRATOR_VIEWS.PROFILE) {
      const keyName = inputKey.toLowerCase();
      const phase = data.settingsAction?.phase ?? SETTINGS_PHASE.BROWSE;
      if (key.return && ui.region === COCKPIT_REGIONS.CONTENT) {
        if (phase === SETTINGS_PHASE.BROWSE) {
          const entry = data.curatedIntegrations[ui.listIndex];
          if (entry?.id) data.previewSettings(entry.id);
          return;
        }
        if (phase === SETTINGS_PHASE.PREVIEW) {
          data.promptConfirmSettings();
          return;
        }
      }
      if (keyName === "y" && phase === SETTINGS_PHASE.CONFIRMING) {
        data.confirmSettings();
        return;
      }
      if (keyName === "n" && phase === SETTINGS_PHASE.CONFIRMING) {
        data.cancelSettings();
        return;
      }
    }

    if (inputKey.toLowerCase() === "r" && ui.view !== ORCHESTRATOR_VIEWS.LAUNCH) {
      if (ui.view === ORCHESTRATOR_VIEWS.REVIEWS || ui.view === ORCHESTRATOR_VIEWS.REVIEW_DETAIL) {
        data.loadReviews().catch(() => {});
        return;
      }
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
    dashboard: data.dashboard,
    layoutMode: mode,
    alerts: data.alerts
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
        paletteOpen: ui.paletteOpen,
        canCancel: isRunCancellable(data.selectedRun),
        unicode,
        changesPhase: data.changesAction?.phase ?? null,
        recoveryPhase: data.recoveryAction?.phase ?? null,
        recoveryHasPreview: Boolean(data.recoveryAction?.preview),
        settingsPhase: data.settingsAction?.phase ?? null,
        columns
      }),
      layoutMode: mode,
      columns,
      nav: buildNavModel({
        navIndex: ui.navIndex,
        currentView: ui.view,
        focused: ui.region === COCKPIT_REGIONS.NAV || !isContentInteractiveView(ui.view),
        unicode,
        dashboard: data.dashboard,
        diagnostics: data.diagnostics,
        snapshot: data.snapshot
      }),
      navFocused: ui.region === COCKPIT_REGIONS.NAV,
      contentFocused: ui.region === COCKPIT_REGIONS.CONTENT,
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
        reviews: data.reviews,
        selectedReview: data.selectedReview,
        alerts: data.alerts,
        changesAction: data.changesAction,
        recoveryAction: data.recoveryAction,
        settingsAction: data.settingsAction,
        controlCenter,
        palette: ui.paletteOpen
          ? buildPaletteModel({
            actions: paletteActions,
            index: ui.paletteIndex,
            unicode
          })
          : null,
        layoutMode: mode,
        colorEnabled,
        unicode,
        overviewDetailsOpen: ui.overviewDetailsOpen,
        governanceDetailsOpen: ui.governanceDetailsOpen,
        activityDetailsOpen: ui.activityDetailsOpen,
        contentFocused: ui.region === COCKPIT_REGIONS.CONTENT,
        homeDir
      })
    )
  );
}
