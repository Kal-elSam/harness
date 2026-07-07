import { installGlobalHarness } from "../global-installer.js";
import { summarizeInstallPreflight } from "../diff.js";
import {
  DEFAULT_COMPONENT_IDS,
  validateComponentIds
} from "../component-registry.js";
import { SECTION_END, SECTION_START } from "../managed-section.js";
import { validateAdapterIds } from "../registry.js";

export async function buildSetupPreview({
  homeDir,
  workspaceRoot,
  packageRoot,
  packageName,
  cliVersion,
  agents,
  components,
  noDefaultComponents
}) {
  const validatedAgents = validateAdapterIds(agents);
  const plan = await installGlobalHarness({
    packageRoot,
    packageName,
    cliVersion,
    homeDir,
    workspaceRoot,
    agents: validatedAgents,
    components,
    noDefaultComponents,
    dryRun: true
  });
  const preflight = await summarizeInstallPreflight(homeDir, plan);

  return {
    agents: validatedAgents,
    components: noDefaultComponents ? [] : (components ?? [...DEFAULT_COMPONENT_IDS]),
    plan,
    preflight
  };
}

export function formatDetectNote({ adapters, detected }) {
  const lines = adapters.map((adapter) => {
    const status = detected.includes(adapter.id) ? "detected" : "not installed";
    return `  ${adapter.label} — ${status}`;
  });

  return [
    "Local AI agents on this machine:",
    "",
    ...lines
  ].join("\n");
}

export function formatPreviewNote({ preview }) {
  const { preflight, agents, components } = preview;
  const lines = [
    preflight.summary,
    "",
    "Managed markers:",
    `  start: ${SECTION_START}`,
    `  end:   ${SECTION_END}`,
    "",
    `Agents: ${agents.join(", ")}`,
    `Components: ${components.join(", ") || "none (core plumbing only)"}`,
    ""
  ];

  if (preflight.changes.length === 0) {
    lines.push("Planned managed changes: none");
  } else {
    lines.push("Planned managed changes:");
    for (const change of preflight.changes) {
      lines.push(`  ${change.action} ${change.target} [${change.kind}]`);
    }
  }

  lines.push("");
  if (preflight.preserved.length > 0) {
    lines.push("User-owned content preserved:");
    for (const entry of preflight.preserved) {
      lines.push(`  ${entry.path}`);
    }
  } else {
    lines.push("User-owned content preserved: none detected in affected configs.");
  }

  return lines.join("\n");
}

export function resolveComponentSelection(selectedIds, { workspaceRoot }) {
  if (selectedIds.includes("__none__")) {
    return { noDefaults: true, selected: [] };
  }

  const selected = validateComponentIds(selectedIds, { workspaceRoot });
  return { noDefaults: false, selected };
}
