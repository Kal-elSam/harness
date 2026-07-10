import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { BRAND } from "../brand/index.js";
import { PLAN_ACTIONS, buildActionPlan, buildReadOnlyDiagnostics } from "../action-planner.js";
import { buildProfileJson, resolveProfile } from "../profile.js";
import {
  ORCHESTRATOR_MENU,
  ORCHESTRATOR_VIEWS,
  formatAgentStatusLines,
  formatIntelligenceLines,
  formatPlanLines,
  formatProfileLines
} from "./orchestrator-state.js";

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
  onComplete
}) {
  const { exit } = useApp();
  const [view, setView] = useState(ORCHESTRATOR_VIEWS.HOME);
  const [menuIndex, setMenuIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const [profileJson, setProfileJson] = useState(null);
  const [plan, setPlan] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [diag, profileResolved] = await Promise.all([
          buildReadOnlyDiagnostics({ homeDir, workspaceRoot, packageName, packageRoot, cliVersion }),
          resolveProfile({ homeDir, workspaceRoot })
        ]);

        if (cancelled) return;
        setDiagnostics(diag);
        setProfileJson(buildProfileJson(profileResolved));
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

  useInput((inputKey, key) => {
    if (key.escape) {
      if (view === ORCHESTRATOR_VIEWS.HOME) {
        finish({ cancelled: true });
        return;
      }
      setView(ORCHESTRATOR_VIEWS.HOME);
      setPlan(null);
      return;
    }

    if (loading || error) return;

    if (view === ORCHESTRATOR_VIEWS.CONFIRM) {
      if (inputKey.toLowerCase() === "y") {
        finish({ cancelled: false, action: plan?.action ?? PLAN_ACTIONS.SETUP, confirmed: true, plan });
      }
      if (inputKey.toLowerCase() === "n") {
        setView(ORCHESTRATOR_VIEWS.HOME);
        setPlan(null);
      }
      return;
    }

    if (view !== ORCHESTRATOR_VIEWS.HOME) return;

    if (key.upArrow) {
      setMenuIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (key.downArrow) {
      setMenuIndex((index) => Math.min(ORCHESTRATOR_MENU.length - 1, index + 1));
      return;
    }

    if (!key.return) return;

    const item = ORCHESTRATOR_MENU[menuIndex];
    if (item.action === "setup") {
      buildActionPlan({
        action: PLAN_ACTIONS.SETUP,
        homeDir,
        workspaceRoot,
        packageName,
        options: { packageRoot, cliVersion }
      }).then((builtPlan) => {
        setPlan(builtPlan);
        setView(ORCHESTRATOR_VIEWS.CONFIRM);
      }).catch((planError) => {
        setError(planError instanceof Error ? planError.message : String(planError));
      });
      return;
    }

    setView(item.view);
  });

  if (loading) {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, { bold: true, color: COLORS.accent }, BRAND.displayName),
      React.createElement(Text, { color: COLORS.muted }, "Loading agent capabilities…")
    );
  }

  if (error) {
    return React.createElement(Box, { flexDirection: "column" },
      React.createElement(Text, { bold: true, color: COLORS.danger }, "Orchestrator error"),
      React.createElement(Text, null, error),
      React.createElement(Text, { dimColor: true }, "Esc to exit")
    );
  }

  return React.createElement(Box, { flexDirection: "column" },
    React.createElement(Text, { bold: true, color: COLORS.accent }, `${BRAND.displayName} orchestrator`),
    React.createElement(Text, { color: COLORS.muted }, "Harness Engineering · local-first · cloud opt-in"),
    React.createElement(Text, null, ""),
    renderView({ view, diagnostics, profileJson, plan, menuIndex }),
    React.createElement(Text, null, ""),
    React.createElement(Text, { dimColor: true }, footerHint(view))
  );
}

function renderView({ view, diagnostics, profileJson, plan, menuIndex }) {
  switch (view) {
    case ORCHESTRATOR_VIEWS.HOME:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Menu"),
        ORCHESTRATOR_MENU.map((item, index) =>
          React.createElement(Text, {
            key: item.id,
            color: index === menuIndex ? COLORS.accent : undefined,
            bold: index === menuIndex
          }, `${index === menuIndex ? "› " : "  "}${item.label}`)
        ),
        React.createElement(Text, null, ""),
        React.createElement(Text, { bold: true }, "Snapshot"),
        React.createElement(Text, null, `Agents detected: ${diagnostics.diagnostics.detected}/${diagnostics.capabilities.length}`),
        React.createElement(Text, null, `Available: ${diagnostics.diagnostics.available}`),
        diagnostics.intelligence && React.createElement(
          Text,
          null,
          `Intelligence: local=${diagnostics.intelligence.summary.localAvailable ? "yes" : "no"} cloud=${diagnostics.intelligence.summary.cloudAuthenticated ? "yes" : "no"}`
        )
      );
    case ORCHESTRATOR_VIEWS.AGENTS:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Agent capabilities"),
        formatAgentStatusLines(diagnostics.capabilities)
          .map((line) => React.createElement(Text, { key: line }, line))
      );
    case ORCHESTRATOR_VIEWS.INTELLIGENCE:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Intelligence backends"),
        formatIntelligenceLines(diagnostics)
          .map((line) => React.createElement(Text, { key: line }, line)),
        React.createElement(Text, null, ""),
        React.createElement(Text, { dimColor: true }, "CLI: kairo intelligence status|models|context|route|ask")
      );
    case ORCHESTRATOR_VIEWS.PROFILE:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Profile"),
        formatProfileLines(profileJson)
          .map((line) => React.createElement(Text, { key: line }, line))
      );
    case ORCHESTRATOR_VIEWS.PLAN:
    case ORCHESTRATOR_VIEWS.CONFIRM:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, view === ORCHESTRATOR_VIEWS.CONFIRM ? "Confirm plan" : "Plan"),
        plan && formatPlanLines(plan).map((line) => React.createElement(Text, { key: line }, line)),
        view === ORCHESTRATOR_VIEWS.CONFIRM && React.createElement(Text, { color: COLORS.warning }, "Y confirm · N decline")
      );
    case ORCHESTRATOR_VIEWS.HELP:
      return React.createElement(Box, { flexDirection: "column" },
        React.createElement(Text, { bold: true }, "Help"),
        React.createElement(Text, null, "Kairo coordinates installed agent CLIs and governs project intelligence."),
        React.createElement(Text, null, "Local-first: Ollama when available. Cloud (OpenRouter/free) needs consent."),
        React.createElement(Text, null, "Use: intelligence status|models|context|route|ask"),
        React.createElement(Text, null, "Profiles: ~/.harness/profile.json and .harness/kairo.json (project wins)."),
        React.createElement(Text, null, "Credentials are never stored by Kairo — use environment variables.")
      );
    default: {
      const _exhaustive = view;
      return React.createElement(Text, null, `Unknown view: ${_exhaustive}`);
    }
  }
}

function footerHint(view) {
  if (view === ORCHESTRATOR_VIEWS.HOME) return "↑↓ navigate · Enter select · Esc quit";
  if (view === ORCHESTRATOR_VIEWS.CONFIRM) return "Y confirm · N decline · Esc back";
  return "Esc back to menu";
}
