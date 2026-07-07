import { styleText } from "node:util";
import {
  AGENT_HINTS,
  BRAND,
  getAgentLabel,
  getAgentSymbol,
  TOKENS,
  WIZARD_COPY
} from "../brand/index.js";

export function brandIntroTitle() {
  return WIZARD_COPY.introTitle;
}

export function paint(text, token) {
  const color = TOKENS[token];
  if (!color) return text;
  return styleText(color, text);
}

export function formatSplashNote() {
  return [
    BRAND.splashLine,
    "",
    "Managed sections · drift repair · ~/.harness state"
  ].join("\n");
}

export function formatAgentDetectCard({ adapters, detected }) {
  const readyCount = detected.length;
  const lines = [
    `${readyCount} of ${adapters.length} agent roots found on this machine.`,
    ""
  ];

  for (const adapter of adapters) {
    const isReady = detected.includes(adapter.id);
    const status = isReady ? AGENT_HINTS.ready : AGENT_HINTS.notDetected;
    const marker = isReady ? paint("●", "success") : paint("○", "muted");
    const label = getAgentLabel(adapter.id).padEnd(14, " ");
    lines.push(`  ${getAgentSymbol(adapter.id)} ${label} ${marker} ${status}`);
  }

  return lines.join("\n");
}

export function formatAgentMultiselectHint(adapterId, detected) {
  if (detected.includes(adapterId)) {
    return AGENT_HINTS.ready;
  }
  return AGENT_HINTS.managedLater;
}

export function formatComponentMultiselectHint(component) {
  if (component.defaultEnabled) {
    return "recommended";
  }
  return undefined;
}

function formatAgentList(agentIds) {
  if (agentIds.length === 0) {
    return "  none";
  }
  return agentIds.map((id) => `  ${getAgentLabel(id)}`).join("\n");
}

function formatComponentList(components, componentCatalog) {
  if (components.length === 0) {
    return `  ${WIZARD_COPY.coreOnlyLabel}`;
  }

  const labelById = new Map(componentCatalog.map((entry) => [entry.id, entry.label]));
  return components
    .map((id) => `  ${labelById.get(id) ?? id}`)
    .join("\n");
}

function formatManagedWrite(change) {
  const verb = change.action === "create"
    ? "+"
    : change.action === "repair"
      ? "~"
      : "↻";
  return `  ${verb} ${change.target}`;
}

export function formatPreviewNote({ preview, componentCatalog = [] }) {
  const { preflight, agents, components } = preview;
  const lines = [
    paint("Agents", "accent"),
    formatAgentList(agents),
    "",
    paint("Components", "accent"),
    formatComponentList(components, componentCatalog),
    "",
    paint("Managed writes", "accent")
  ];

  if (preflight.changes.length === 0) {
    lines.push("  none — already in sync");
  } else {
    for (const change of preflight.changes) {
      lines.push(formatManagedWrite(change));
    }
  }

  lines.push("", paint("Preserved content", "accent"));
  if (preflight.preserved.length === 0) {
    lines.push("  none");
  } else {
    for (const entry of preflight.preserved) {
      lines.push(`  ${entry.path}`);
    }
  }

  return lines.join("\n");
}

export function formatResultNote(result, { dryRun = false } = {}) {
  const agentLabels = result.agents.map((id) => getAgentLabel(id)).join(", ");
  const componentLine = result.components.length > 0
    ? result.components.join(", ")
    : WIZARD_COPY.coreOnlyLabel;

  const lines = [
    `State   ${result.stateRoot}`,
    `Agents  ${agentLabels}`,
    `Comps   ${componentLine}`,
    `Writes  ${result.configsCreated.length} new · ${result.configsUpdated.length} updated`,
    `${dryRun ? "Backup" : "Backups"}  ${dryRun ? "planned" : "created"}: ${result.backups.length}`,
    "",
    paint("Next steps", "accent"),
    dryRun
      ? "  harness setup --confirm   Apply this plan"
      : "  harness status            Check ecosystem health",
    dryRun
      ? "  harness setup --dry-run   Re-preview changes"
      : "  harness doctor            Run health checks",
    dryRun ? "" : "  harness sync              Repair drift when needed"
  ].filter((line) => line !== "");

  return lines.join("\n");
}
