import { AGENT_HINTS, BRAND, PREFERRED_CLI, formatCliCommand, getAgentLabel, WIZARD_COPY } from "../brand/index.js";
import { formatAgentMultiselectHint } from "../clack/theme.js";

export const SETUP_STEPS = {
  SPLASH: "splash",
  DETECT: "detect",
  AGENTS: "agents",
  COMPONENTS: "components",
  PREVIEW: "preview",
  CONFIRM: "confirm"
};

export function shouldUseCompactSplashLogo(columns) {
  if (!columns || columns <= 0) return false;
  const fullWidth = Math.max(...BRAND.asciiLogo.map((line) => line.length));
  return columns < fullWidth + 4;
}

export function formatInkSplashLines({ compact = false } = {}) {
  const logo = compact ? BRAND.compactLogo : BRAND.asciiLogo;
  return [
    ...logo,
    "",
    BRAND.name,
    BRAND.tagline,
    "",
    BRAND.splashHint
  ];
}

export const INITIAL_SETUP_STEP = SETUP_STEPS.SPLASH;

export function shouldStartPreviewLoad({ step, preview, previewError }) {
  if (step !== SETUP_STEPS.PREVIEW) return false;
  if (preview || previewError) return false;
  return true;
}

export function transitionFromSplash({ escape = false, enter = false } = {}) {
  if (escape) {
    return { kind: "cancel" };
  }
  if (enter) {
    return { kind: "advance", step: SETUP_STEPS.DETECT };
  }
  return { kind: "noop" };
}

export function toggleSelection(selected, id) {
  if (selected.includes(id)) {
    return selected.filter((entry) => entry !== id);
  }
  return [...selected, id];
}

export function toggleComponentSelection(selected, id) {
  if (id === "__none__") {
    return selected.includes("__none__") ? [] : ["__none__"];
  }

  const withoutNone = selected.filter((entry) => entry !== "__none__");
  return toggleSelection(withoutNone, id);
}

export function buildAgentOptions(adapters, detected) {
  return adapters.map((adapter) => ({
    id: adapter.id,
    label: getAgentLabel(adapter.id),
    hint: formatAgentMultiselectHint(adapter.id, detected)
  }));
}

export function buildComponentOptions(components) {
  return [
    ...components.map((component) => ({
      id: component.id,
      label: component.label,
      hint: component.defaultEnabled ? "recommended" : undefined
    })),
    {
      id: "__none__",
      label: WIZARD_COPY.coreOnlyLabel,
      hint: undefined
    }
  ];
}

export function formatInkHeaderLines() {
  return [
    BRAND.name,
    BRAND.tagline,
    BRAND.splashLine
  ];
}

export function formatInkDetectPanel({ adapters, detected }) {
  const readyCount = detected.length;
  const lines = [
    `Your agents · ${readyCount}/${adapters.length} roots found`,
    ""
  ];

  for (const adapter of adapters) {
    const isReady = detected.includes(adapter.id);
    const status = isReady ? AGENT_HINTS.ready : AGENT_HINTS.notDetected;
    lines.push(`${getAgentLabel(adapter.id)} · ${status}`);
  }

  return lines.join("\n");
}

export function formatInkSelectList({ options, selected, activeIndex }) {
  return options.map((option, index) => {
    const checked = selected.includes(option.id) ? "[x]" : "[ ]";
    const pointer = index === activeIndex ? "›" : " ";
    const hint = option.hint ? ` (${option.hint})` : "";
    return `${pointer} ${checked} ${option.label}${hint}`;
  });
}

export function formatInkPreviewLines({ preview, componentCatalog }) {
  const labelById = new Map(componentCatalog.map((entry) => [entry.id, entry.label]));
  const agentLine = preview.agents.map((id) => getAgentLabel(id)).join(", ") || "none";
  const componentLine = preview.components.length > 0
    ? preview.components.map((id) => labelById.get(id) ?? id).join(", ")
    : WIZARD_COPY.coreOnlyLabel;

  const lines = [
    "Agents",
    `  ${agentLine}`,
    "",
    "Components",
    `  ${componentLine}`,
    "",
    "Managed writes"
  ];

  if (preview.preflight.changes.length === 0) {
    lines.push("  none — already in sync");
  } else {
    for (const change of preview.preflight.changes) {
      const verb = change.action === "create" ? "+" : change.action === "repair" ? "~" : "↻";
      lines.push(`  ${verb} ${change.target}`);
    }
  }

  lines.push("", "Preserved content");
  if (preview.preflight.preserved.length === 0) {
    lines.push("  none");
  } else {
    for (const entry of preview.preflight.preserved) {
      lines.push(`  ${entry.path}`);
    }
  }

  return lines;
}

export function formatInkSuccessLines(result, { dryRun = false, cliName = PREFERRED_CLI } = {}) {
  const agentLine = result.agents.map((id) => getAgentLabel(id)).join(", ");
  const componentLine = result.components.length > 0
    ? result.components.join(", ")
    : WIZARD_COPY.coreOnlyLabel;

  return [
    dryRun ? WIZARD_COPY.resultDryRunTitle : WIZARD_COPY.resultSuccessTitle,
    "",
    `State   ${result.stateRoot}`,
    `Agents  ${agentLine}`,
    `Comps   ${componentLine}`,
    "",
    "Next steps",
    dryRun
      ? `  ${formatCliCommand("setup --confirm", cliName)}`
      : `  ${formatCliCommand("status", cliName)}`,
    dryRun
      ? `  ${formatCliCommand("setup --dry-run", cliName)}`
      : `  ${formatCliCommand("doctor", cliName)}`
  ];
}
