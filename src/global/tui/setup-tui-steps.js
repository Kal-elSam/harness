import { installGlobalHarness } from "../global-installer.js";
import { summarizeInstallPreflight } from "../diff.js";
import {
  DEFAULT_COMPONENT_IDS,
  validateComponentIds
} from "../component-registry.js";
import { SECTION_END, SECTION_START } from "../managed-section.js";
import {
  GLOBAL_AGENT_IDS,
  validateAdapterIds
} from "../registry.js";
import {
  formatAgentLine,
  formatChangeLine,
  formatComponentLine,
  formatHelp,
  formatStatusBadge,
  formatStepHeader
} from "./format.js";
import { promptYesNo, runMultiSelect } from "./multi-select.js";
import { paint } from "./terminal.js";
import { SETUP_TUI_TOTAL_STEPS, SetupTuiCancelledError } from "./setup-tui-constants.js";

export { SetupTuiCancelledError };

export async function showDetectStep({ io, adapters, detected }) {
  const lines = [
    formatStepHeader({ step: 1, total: SETUP_TUI_TOTAL_STEPS, title: "Detect agents" }),
    "",
    ...adapters.map((adapter) => {
      const status = detected.includes(adapter.id) ? "detected" : "missing";
      return `  ${adapter.label}${formatStatusBadge(status)}`;
    }),
    supportedAgentsLine(),
    "",
    formatHelp("Enter continue · q cancel")
  ];

  io.clear();
  io.hideCursor();
  io.write(`${lines.join("\n")}\n`);

  const answer = await io.readLine();
  if (isCancelAnswer(answer)) {
    throw new SetupTuiCancelledError();
  }
}

export async function selectAgentsStep({ io, adapters, detected }) {
  const defaultSelected = detected.length > 0 ? detected : [...GLOBAL_AGENT_IDS];
  const title = formatStepHeader({ step: 2, total: SETUP_TUI_TOTAL_STEPS, title: "Select agents" });

  return runMultiSelect({
    title,
    io,
    closeOnExit: false,
    initialSelected: defaultSelected,
    items: adapters.map((adapter) => ({
      id: adapter.id,
      selected: defaultSelected.includes(adapter.id),
      render: ({ selected, active }) => formatAgentLine({
        label: adapter.label,
        status: detected.includes(adapter.id) ? "detected" : "missing",
        selected,
        active
      })
    }))
  });
}

export async function selectComponentsStep({ io, components, workspaceRoot }) {
  const title = formatStepHeader({ step: 3, total: SETUP_TUI_TOTAL_STEPS, title: "Select components" });
  const defaultSelected = [...DEFAULT_COMPONENT_IDS];
  const noneItem = {
    id: "__none__",
    selected: false,
    render: ({ active }) => `${active ? paint("› ", "bold") : "  "}${paint("[ ]", "gray")} none (core plumbing only)`
  };

  const selection = await runMultiSelect({
    title,
    io,
    closeOnExit: false,
    initialSelected: defaultSelected,
    allowEmpty: true,
    help: "↑↓ move · Space toggle · Enter confirm · q cancel (select none for core only)",
    items: [
      ...components.map((component) => ({
        id: component.id,
        selected: defaultSelected.includes(component.id),
        render: ({ selected, active }) => formatComponentLine({
          label: component.label,
          status: component.defaultEnabled ? "selected" : "missing",
          selected,
          active,
          defaultEnabled: component.defaultEnabled
        })
      })),
      noneItem
    ]
  });

  if (selection.cancelled) return { cancelled: true };

  if (selection.selected.includes("__none__")) {
    return { cancelled: false, noDefaults: true, selected: [] };
  }

  const selected = validateComponentIds(selection.selected, { workspaceRoot });
  return { cancelled: false, noDefaults: false, selected };
}

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

export async function showPreviewStep({ io, preview }) {
  const { preflight } = preview;
  const lines = [
    formatStepHeader({ step: 4, total: SETUP_TUI_TOTAL_STEPS, title: "Preview managed changes" }),
    "",
    paint(preflight.summary, "bold"),
    "",
    paint("Managed markers:", "bold"),
    `  start: ${SECTION_START}`,
    `  end:   ${SECTION_END}`,
    ""
  ];

  if (preflight.changes.length === 0) {
    lines.push("Planned managed changes: none");
  } else {
    lines.push("Planned managed changes:");
    for (const change of preflight.changes) {
      lines.push(formatChangeLine(change));
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

  lines.push("", formatHelp("Enter continue · q cancel"));

  io.clear();
  io.hideCursor();
  io.write(`${lines.join("\n")}\n`);

  const answer = await io.readLine();
  if (isCancelAnswer(answer)) {
    throw new SetupTuiCancelledError();
  }
}

export async function confirmApplyStep({ io, dryRun }) {
  return promptYesNo({
    title: formatStepHeader({ step: 5, total: SETUP_TUI_TOTAL_STEPS, title: "Confirm apply" }),
    bodyLines: [
      dryRun
        ? paint("Preview only. No files will be written.", "yellow")
        : paint("This will write managed sections and ~/.harness state.", "bold"),
      "",
      "Backups are created before config writes when applicable."
    ],
    help: "Y apply · n cancel · q quit",
    io,
    closeOnExit: false
  });
}

function supportedAgentsLine() {
  return paint(`Supported: ${GLOBAL_AGENT_IDS.join(", ")}`, "dim");
}

function isCancelAnswer(answer) {
  const normalized = answer.trim().toLowerCase();
  return normalized === "q" || normalized === "quit";
}
