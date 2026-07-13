import React, { useEffect, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { stdout as output } from "node:process";
import { BRAND, WIZARD_COPY } from "../brand/index.js";
import { DEFAULT_COMPONENT_IDS, describeComponentCatalog } from "../component-registry.js";
import { GLOBAL_AGENT_IDS, detectInstalledAdapters, listAdapters } from "../registry.js";
import { buildSetupPreview, resolveComponentSelection } from "../clack/setup-preview.js";
import {
  SETUP_STEPS,
  buildAgentOptions,
  buildComponentOptions,
  formatInkDetectPanel,
  formatInkHeaderLines,
  formatInkPreviewLines,
  formatInkSelectList,
  formatInkSplashLines,
  INITIAL_SETUP_STEP,
  shouldStartPreviewLoad,
  shouldUseCompactSplashLogo,
  toggleComponentSelection,
  toggleSelection,
  transitionFromSplash
} from "./setup-state.js";

const INK_COLORS = {
  accent: "cyan",
  success: "green",
  warning: "yellow",
  danger: "red",
  muted: "gray"
};

function Header() {
  const lines = formatInkHeaderLines();
  return React.createElement(Box, { flexDirection: "column", marginBottom: 1 },
    React.createElement(Text, { bold: true, color: INK_COLORS.accent }, lines[0]),
    React.createElement(Text, { color: INK_COLORS.muted }, lines[1]),
    React.createElement(Text, { dimColor: true }, lines[2])
  );
}

function Panel({ title, children }) {
  return React.createElement(Box, {
    flexDirection: "column",
    borderStyle: "round",
    borderColor: INK_COLORS.accent,
    paddingX: 1,
    marginBottom: 1
  },
  React.createElement(Text, { bold: true, color: INK_COLORS.accent }, title),
  children
  );
}

function Footer({ children }) {
  return React.createElement(Text, { dimColor: true }, children);
}

function Splash({ compact, onboarding = false }) {
  const lines = formatInkSplashLines({ compact, onboarding });
  const logoLineCount = compact ? BRAND.compactLogo.length : BRAND.asciiLogo.length;

  return React.createElement(Box, { flexDirection: "column", marginBottom: 1 },
    lines.map((line, index) => {
      if (index < logoLineCount) {
        return React.createElement(Text, { key: `logo-${index}`, bold: true, color: INK_COLORS.accent }, line);
      }
      if (line === BRAND.name) {
        return React.createElement(Text, { key: `line-${index}`, bold: true, color: INK_COLORS.accent }, line);
      }
      if (line === BRAND.tagline) {
        return React.createElement(Text, { key: `line-${index}`, color: INK_COLORS.muted }, line);
      }
      if (line === BRAND.splashHint || line.includes("Esc to exit") || line.includes("Press Enter")) {
        return React.createElement(Text, { key: `line-${index}`, dimColor: true }, line);
      }
      if (line === "") {
        return React.createElement(Text, { key: `line-${index}` }, "");
      }
      return React.createElement(Text, { key: `line-${index}` }, line);
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
  const adapters = listAdapters();
  const detected = detectInstalledAdapters({ homeDir });
  const componentCatalog = describeComponentCatalog({ workspaceRoot });
  const agentOptions = buildAgentOptions(adapters, detected);
  const componentOptions = buildComponentOptions(componentCatalog);
  const defaultAgents = detected.length > 0 ? detected : [...GLOBAL_AGENT_IDS];

  const [step, setStep] = useState(INITIAL_SETUP_STEP);
  const useCompactSplash = shouldUseCompactSplashLogo(output.columns);
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

  const detectPanel = formatInkDetectPanel({ adapters, detected });

  return React.createElement(Box, { flexDirection: "column" },
    step === SETUP_STEPS.SPLASH && React.createElement(Splash, {
      compact: useCompactSplash,
      onboarding
    }),
    step !== SETUP_STEPS.SPLASH && React.createElement(Header),
    step === SETUP_STEPS.DETECT && React.createElement(Panel, { title: WIZARD_COPY.detectTitle },
      detectPanel.split("\n")
        .map((line) => React.createElement(Text, { key: line }, line))
    ),
    step === SETUP_STEPS.AGENTS && React.createElement(Panel, { title: WIZARD_COPY.agentsPrompt },
      formatInkSelectList({ options: agentOptions, selected: selectedAgents, activeIndex })
        .map((line) => React.createElement(Text, { key: line }, line))
    ),
    step === SETUP_STEPS.COMPONENTS && React.createElement(Panel, { title: WIZARD_COPY.componentsPrompt },
      formatInkSelectList({ options: componentOptions, selected: selectedComponents, activeIndex })
        .map((line) => React.createElement(Text, { key: line }, line))
    ),
    step === SETUP_STEPS.PREVIEW && React.createElement(Panel, { title: WIZARD_COPY.previewTitle },
      previewLoading && React.createElement(Text, { color: INK_COLORS.warning }, "Building preview…"),
      previewError && React.createElement(Text, { color: INK_COLORS.danger }, previewError),
      preview && formatInkPreviewLines({ preview, componentCatalog })
        .map((line) => React.createElement(Text, { key: line }, line))
    ),
    step === SETUP_STEPS.CONFIRM && React.createElement(Panel, { title: "Confirm" },
      React.createElement(Text, null, dryRun ? WIZARD_COPY.confirmDryRun : WIZARD_COPY.confirmApply)
    ),
    React.createElement(Footer, null,
      step === SETUP_STEPS.SPLASH && `${BRAND.splashHint} · Esc cancel`,
      step === SETUP_STEPS.DETECT && "Enter continue · Esc cancel",
      step === SETUP_STEPS.AGENTS && "↑↓ move · Space toggle · Enter continue · Esc cancel",
      step === SETUP_STEPS.COMPONENTS && "↑↓ move · Space toggle · Enter continue · Esc cancel",
      step === SETUP_STEPS.PREVIEW && preview && !previewLoading && "Enter continue · Esc cancel",
      step === SETUP_STEPS.CONFIRM && "Y apply · N cancel · Esc cancel"
    )
  );
}
