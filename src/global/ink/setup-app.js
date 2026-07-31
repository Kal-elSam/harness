import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { stdout as output } from "node:process";
import { BRAND } from "../brand/index.js";
import { DEFAULT_COMPONENT_IDS, describeComponentCatalog } from "../component-registry.js";
import { GLOBAL_AGENT_IDS, detectInstalledAdapters, listAdapters } from "../registry.js";
import { buildSetupPreview, resolveComponentSelection } from "../clack/setup-preview.js";
import {
  SETUP_STEPS,
  buildAgentOptions,
  buildComponentOptions,
  formatInkHeaderLines,
  formatInkSplashLines,
  INITIAL_SETUP_STEP,
  shouldStartPreviewLoad,
  shouldUseCompactSplashLogo,
  setupLineKey,
  toggleComponentSelection,
  toggleSelection,
  transitionFromSplash
} from "./setup-state.js";
import { COCKPIT_COLORS, resolveInkColor } from "./theme.js";
import { useTerminalSize } from "./use-terminal-size.js";
import { resolveTerminalCapabilities } from "./terminal-capabilities.js";
import { SemanticSetupPanel } from "./ux/live-setup.js";

export function SetupHeader({ colorEnabled = true }) {
  const lines = formatInkHeaderLines();
  return React.createElement(Box, { flexDirection: "column", marginBottom: 1 },
    React.createElement(Text, {
      bold: true,
      color: resolveInkColor(colorEnabled, COCKPIT_COLORS.primary)
    }, `╭─ ${lines[0]}`),
    React.createElement(Text, {
      color: resolveInkColor(colorEnabled, COCKPIT_COLORS.secondary)
    }, lines[1]),
    React.createElement(Text, { dimColor: true }, lines[2])
  );
}

export function SetupSplash({ compact, onboarding = false, colorEnabled = true }) {
  const lines = formatInkSplashLines({ compact, onboarding });
  const logoLineCount = compact ? BRAND.compactLogo.length : BRAND.asciiLogo.length;
  const accent = resolveInkColor(colorEnabled, COCKPIT_COLORS.primary);
  const muted = resolveInkColor(colorEnabled, COCKPIT_COLORS.muted);

  return React.createElement(Box, { flexDirection: "column", marginBottom: 1 },
    lines.map((line, index) => {
      const key = setupLineKey(index, line);
      if (index < logoLineCount) {
        return React.createElement(Text, { key, bold: true, color: accent }, line);
      }
      if (line === BRAND.name) {
        return React.createElement(Text, { key, bold: true, color: accent }, line);
      }
      if (line === BRAND.tagline) {
        return React.createElement(Text, { key, color: muted }, line);
      }
      if (line === BRAND.splashHint || line.includes("Esc to exit") || line.includes("Press Enter")) {
        return React.createElement(Text, { key, dimColor: true }, line);
      }
      return React.createElement(Text, { key }, line);
    })
  );
}

export function SetupApp({
  homeDir,
  workspaceRoot,
  packageRoot,
  packageName,
  cliVersion,
  dryRun = false,
  onboarding = false,
  onComplete
}) {
  const { exit } = useApp();
  const { columns, rows, layoutMode } = useTerminalSize({
    initialColumns: output.columns ?? 80,
    initialRows: output.rows ?? 24
  });
  const caps = resolveTerminalCapabilities({ columns, rows, isTTY: true });
  const colorEnabled = caps.color;
  const adapters = listAdapters();
  const detected = detectInstalledAdapters({ homeDir });
  const componentCatalog = describeComponentCatalog({ workspaceRoot });
  const agentOptions = buildAgentOptions(adapters, detected);
  const componentOptions = buildComponentOptions(componentCatalog);
  const defaultAgents = detected.length > 0 ? detected : [...GLOBAL_AGENT_IDS];

  const [step, setStep] = useState(INITIAL_SETUP_STEP);
  const useCompactSplash = shouldUseCompactSplashLogo(columns);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedAgents, setSelectedAgents] = useState(defaultAgents);
  const [selectedComponents, setSelectedComponents] = useState([...DEFAULT_COMPONENT_IDS]);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!shouldStartPreviewLoad({ step, preview, previewError })) return;

    let cancelled = false;
    setPreviewLoading(true);

    const { noDefaults, selected } = resolveComponentSelection(selectedComponents, { workspaceRoot });

    buildSetupPreview({
      homeDir,
      workspaceRoot,
      packageRoot,
      packageName,
      cliVersion,
      agents: selectedAgents,
      components: selected,
      noDefaultComponents: noDefaults
    }).then((built) => {
      if (cancelled) return;
      setPreview(built);
      setPreviewLoading(false);
    }).catch((error) => {
      if (cancelled) return;
      setPreviewError(error instanceof Error ? error.message : String(error));
      setPreviewLoading(false);
    });

    return () => {
      cancelled = true;
      setPreviewLoading(false);
    };
  }, [step, preview, previewError, homeDir, workspaceRoot, packageRoot, packageName, cliVersion, selectedAgents, selectedComponents]);

  const finish = (outcome) => {
    onComplete(outcome);
    exit();
  };

  useInput((inputKey, key) => {
    if (key.escape) {
      finish({ cancelled: true, usedWizard: true });
      return;
    }

    if (step === SETUP_STEPS.SPLASH) {
      const splashTransition = transitionFromSplash({
        escape: key.escape,
        enter: key.return
      });

      if (splashTransition.kind === "cancel") {
        finish({ cancelled: true, usedWizard: true });
        return;
      }
      if (splashTransition.kind === "advance") {
        setStep(splashTransition.step);
      }
      return;
    }

    if (step === SETUP_STEPS.DETECT && key.return) {
      setStep(SETUP_STEPS.AGENTS);
      setActiveIndex(0);
      return;
    }

    if (step === SETUP_STEPS.AGENTS) {
      if (key.upArrow) {
        setActiveIndex((index) => Math.max(0, index - 1));
        return;
      }
      if (key.downArrow) {
        setActiveIndex((index) => Math.min(agentOptions.length - 1, index + 1));
        return;
      }
      if (inputKey === " ") {
        const id = agentOptions[activeIndex].id;
        setSelectedAgents((current) => toggleSelection(current, id));
        return;
      }
      if (key.return && selectedAgents.length > 0) {
        setStep(SETUP_STEPS.COMPONENTS);
        setActiveIndex(0);
      }
      return;
    }

    if (step === SETUP_STEPS.COMPONENTS) {
      if (key.upArrow) {
        setActiveIndex((index) => Math.max(0, index - 1));
        return;
      }
      if (key.downArrow) {
        setActiveIndex((index) => Math.min(componentOptions.length - 1, index + 1));
        return;
      }
      if (inputKey === " ") {
        const id = componentOptions[activeIndex].id;
        setSelectedComponents((current) => toggleComponentSelection(current, id));
        return;
      }
      if (key.return) {
        setStep(SETUP_STEPS.PREVIEW);
        setPreview(null);
        setPreviewError(null);
      }
      return;
    }

    if (step === SETUP_STEPS.PREVIEW && key.return && preview && !previewLoading) {
      setStep(SETUP_STEPS.CONFIRM);
      return;
    }

    if (step === SETUP_STEPS.CONFIRM) {
      if (inputKey.toLowerCase() === "y") {
        const { noDefaults, selected } = resolveComponentSelection(selectedComponents, { workspaceRoot });
        finish({
          cancelled: false,
          usedWizard: true,
          agents: selectedAgents,
          components: selected,
          noDefaultComponents: noDefaults,
          preview
        });
      }
      if (inputKey.toLowerCase() === "n") {
        finish({ cancelled: true, usedWizard: true });
      }
    }
  });

  return React.createElement(Box, { flexDirection: "column" },
    step === SETUP_STEPS.SPLASH && React.createElement(SetupSplash, {
      compact: useCompactSplash,
      onboarding,
      colorEnabled
    }),
    step === SETUP_STEPS.SPLASH && React.createElement(Text, { dimColor: true },
      `${BRAND.splashHint} · Esc cancel`
    ),
    step !== SETUP_STEPS.SPLASH && React.createElement(SetupHeader, { colorEnabled }),
    step !== SETUP_STEPS.SPLASH && React.createElement(SemanticSetupPanel, {
      step,
      activeIndex,
      agentOptions,
      componentOptions,
      componentCatalog,
      selectedAgents,
      selectedComponents,
      adapters,
      detected,
      preview,
      previewLoading,
      previewError,
      dryRun,
      layoutMode,
      colorEnabled,
      unicode: caps.unicode,
      columns
    })
  );
}
