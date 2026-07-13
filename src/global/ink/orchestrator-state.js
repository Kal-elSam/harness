import { stdin as input, stdout as output } from "node:process";
import { canUseSetupInk } from "./terminal.js";
import { isActiveRunState, formatTaskLabel } from "../runtime/run-types.js";

export function canUseOrchestratorShell({
  interactive = Boolean(input.isTTY && output.isTTY),
  term = process.env.TERM ?? "",
  columns = output.columns ?? 80,
  forceInk = process.env.HARNESS_INK !== "0"
} = {}) {
  return canUseSetupInk({ interactive, term, columns, forceInk });
}

export const ORCHESTRATOR_VIEWS = {
  HOME: "home",
  ACTIVE_RUNS: "active-runs",
  RECENT_RUNS: "recent-runs",
  RUN_DETAIL: "run-detail",
  PROVIDERS: "providers",
  LAUNCH: "launch",
  DIAGNOSTICS: "diagnostics",
  HELP: "help"
};

export const ORCHESTRATOR_MENU = [
  { id: "active", label: "Running now", view: ORCHESTRATOR_VIEWS.ACTIVE_RUNS },
  { id: "recent", label: "History", view: ORCHESTRATOR_VIEWS.RECENT_RUNS },
  { id: "providers", label: "Agents", view: ORCHESTRATOR_VIEWS.PROVIDERS },
  { id: "launch", label: "New run", view: ORCHESTRATOR_VIEWS.LAUNCH, action: "launch" },
  { id: "diagnostics", label: "System health", view: ORCHESTRATOR_VIEWS.DIAGNOSTICS },
  { id: "help", label: "Help", view: ORCHESTRATOR_VIEWS.HELP }
];

export const LAUNCH_WIZARD_STEPS = {
  AGENT: "agent",
  TASK: "task",
  MODEL: "model",
  PERMISSIONS: "permissions",
  CONFIRM: "confirm"
};

export const LAUNCH_PERMISSION_OPTIONS = [
  { id: "default", label: "Default (agent prompts)", permissions: [] },
  { id: "force", label: "Force / auto-approve", permissions: ["force"] },
  { id: "yolo", label: "YOLO / skip permissions", permissions: ["yolo"] }
];

export function resolveLaunchableAgents(providers = []) {
  return providers
    .filter((provider) => provider.launchable)
    .map((provider) => provider.id);
}

export function createLaunchDraft() {
  return {
    agentId: null,
    task: "",
    model: "",
    permissionIndex: 0
  };
}

export function resolveLaunchPermissions(draft) {
  return LAUNCH_PERMISSION_OPTIONS[draft.permissionIndex]?.permissions ?? [];
}

export function advanceLaunchWizardStep(currentStep) {
  switch (currentStep) {
    case LAUNCH_WIZARD_STEPS.AGENT:
      return LAUNCH_WIZARD_STEPS.TASK;
    case LAUNCH_WIZARD_STEPS.TASK:
      return LAUNCH_WIZARD_STEPS.MODEL;
    case LAUNCH_WIZARD_STEPS.MODEL:
      return LAUNCH_WIZARD_STEPS.PERMISSIONS;
    case LAUNCH_WIZARD_STEPS.PERMISSIONS:
      return LAUNCH_WIZARD_STEPS.CONFIRM;
    default:
      return LAUNCH_WIZARD_STEPS.CONFIRM;
  }
}

export function retreatLaunchWizardStep(currentStep) {
  switch (currentStep) {
    case LAUNCH_WIZARD_STEPS.CONFIRM:
      return LAUNCH_WIZARD_STEPS.PERMISSIONS;
    case LAUNCH_WIZARD_STEPS.PERMISSIONS:
      return LAUNCH_WIZARD_STEPS.MODEL;
    case LAUNCH_WIZARD_STEPS.MODEL:
      return LAUNCH_WIZARD_STEPS.TASK;
    case LAUNCH_WIZARD_STEPS.TASK:
      return LAUNCH_WIZARD_STEPS.AGENT;
    default:
      return LAUNCH_WIZARD_STEPS.AGENT;
  }
}

export function formatLaunchWizardLines({
  step,
  draft,
  launchableAgents,
  agentIndex,
  permissionIndex
}) {
  const lines = [`Step: ${step}`];

  if (step === LAUNCH_WIZARD_STEPS.AGENT) {
    lines.push("Select agent:");
    for (const [index, agentId] of launchableAgents.entries()) {
      const marker = index === agentIndex ? "›" : " ";
      lines.push(`${marker} ${agentId}`);
    }
    return lines;
  }

  if (step === LAUNCH_WIZARD_STEPS.TASK) {
    lines.push(`Agent: ${draft.agentId ?? "—"}`);
    lines.push(`Task: ${draft.task || "(type your task)"}`);
    lines.push("Enter to continue · Backspace to edit");
    return lines;
  }

  if (step === LAUNCH_WIZARD_STEPS.MODEL) {
    lines.push(`Agent: ${draft.agentId ?? "—"}`);
    lines.push(`Task length: ${draft.task.length} chars`);
    lines.push(`Model: ${draft.model || "(default — press Enter)"}`);
    lines.push("Type model alias or Enter for default");
    return lines;
  }

  if (step === LAUNCH_WIZARD_STEPS.PERMISSIONS) {
    lines.push("Permissions:");
    for (const [index, option] of LAUNCH_PERMISSION_OPTIONS.entries()) {
      const marker = index === permissionIndex ? "›" : " ";
      lines.push(`${marker} ${option.label}`);
    }
    return lines;
  }

  lines.push(`Agent: ${draft.agentId ?? "—"}`);
  lines.push(`Task length: ${draft.task.length} chars (content not stored)`);
  lines.push(`Model: ${draft.model || "default"}`);
  lines.push(`Permissions: ${LAUNCH_PERMISSION_OPTIONS[permissionIndex]?.label ?? "default"}`);
  lines.push("Enter to launch · Esc to go back");
  return lines;
}

export function resolveMenuItem(menuIndex) {
  return ORCHESTRATOR_MENU[menuIndex] ?? null;
}

export function resolveMenuItemView(menuIndex) {
  return resolveMenuItem(menuIndex)?.view ?? ORCHESTRATOR_VIEWS.HOME;
}

export function shiftMenuIndex(currentIndex, direction, menuLength = ORCHESTRATOR_MENU.length) {
  const delta = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  return Math.min(menuLength - 1, Math.max(0, currentIndex + delta));
}

export function formatRunLines(runs, {
  emptyMessage = "No runs.",
  readable = false
} = {}) {
  if (!runs || runs.length === 0) return [emptyMessage];

  return runs.map((run) => {
    const agent = humanizeToken(run.agentId);
    const state = humanizeRunState(run.state);
    const task = formatTaskLabel(run);
    if (readable) {
      return `${agent} · ${state} · ${task}`;
    }
    const statePad = run.state.padEnd(12);
    const agentPad = run.agentId.padEnd(10);
    return `${run.runId}  ${statePad}  ${agentPad}  ${task}`;
  });
}

export function formatProviderLines(providers) {
  return providers.map((provider) => {
    const status = provider.launchable
      ? "launchable"
      : provider.compatible
        ? "auditable"
        : provider.available
          ? "limited"
          : "missing";
    return `${provider.label.padEnd(14)} ${status.padEnd(12)} ${provider.reason ?? ""}`.trimEnd();
  });
}

export function formatDiagnosticsLines(diagnostics) {
  return formatSystemHealthLines(diagnostics);
}

/**
 * Format active profile source labels from the real `{ global, project }` contract.
 * Paths are omitted; only source kind labels are shown.
 */
export function formatProfileSourcesLabel(sources) {
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) {
    return "none";
  }

  const labels = [];
  if (sources.global) labels.push("global");
  if (sources.project) labels.push("project");
  return labels.length > 0 ? labels.join(", ") : "none";
}

export function formatSystemHealthLines(diagnostics) {
  const summary = diagnostics?.diagnostics;
  const intelligence = diagnostics?.intelligence?.summary;
  const profile = diagnostics?.profile;
  const capabilities = diagnostics?.capabilities ?? [];
  const authKnown = capabilities.filter((entry) => entry.authenticated != null);
  const authReady = authKnown.filter((entry) => entry.authenticated).length;

  const lines = [
    "Agents",
    `Detected: ${summary?.detected ?? 0}/${capabilities.length}`,
    `Available: ${summary?.available ?? 0}`,
    `Unknown: ${summary?.unknown ?? 0}`,
    `Errors: ${summary?.errors ?? 0}`,
    ...formatAgentStatusLines(capabilities),
    "",
    "Intelligence",
    intelligence?.localAvailable
      ? "Local backend available"
      : "Local backend unavailable",
    intelligence?.cloudAuthenticated
      ? "Cloud backend authenticated"
      : "Cloud backend not configured",
    `Routing: ${diagnostics?.intelligence?.routingPreview?.reason ?? "n/a"}`,
    "",
    "Authentication",
    authKnown.length === 0
      ? "No agent authentication signals yet"
      : `${authReady}/${authKnown.length} agents report ready auth`,
    "",
    "Configuration",
    `CLI version: ${diagnostics?.cliVersion ?? "unknown"}`,
    `Profile sources: ${formatProfileSourcesLabel(profile?.sources)}`
  ];

  const recommendations = diagnostics?.recommendations ?? [];
  if (recommendations.length > 0) {
    lines.push("", "Recommendations");
    for (const recommendation of recommendations) {
      lines.push(`  • ${recommendation}`);
    }
  }

  return lines;
}

export function formatAgentStatusLines(capabilities) {
  return capabilities.map((entry) => {
    const auth = entry.authenticated == null ? "n/a" : (entry.authenticated ? "yes" : "no");
    const version = entry.version ?? "unknown";
    return `${entry.label.padEnd(14)} ${entry.state.padEnd(14)} v${version} auth=${auth}`;
  });
}

export function formatRunDetailLines(run, events = []) {
  if (!run) return ["Run not found."];

  const lines = [
    `Run: ${run.runId}`,
    `Agent: ${run.agentId} (${run.provider})`,
    `State: ${run.state}`,
    `Model: ${run.model ?? "default"}`,
    `Cwd: ${run.cwd}`,
    `Started: ${run.startedAt}`,
    `Updated: ${run.updatedAt}`
  ];

  if (run.completedAt) lines.push(`Completed: ${run.completedAt}`);
  if (run.tokenUsage) lines.push(`Tokens: ${JSON.stringify(run.tokenUsage)}`);
  if (run.error) lines.push(`Error: ${run.error}`);
  if (run.tools?.length) lines.push(`Tools: ${run.tools.join(", ")}`);

  if (events.length > 0) {
    lines.push("", "Recent events");
    for (const event of events.slice(-8)) {
      if (event.parseError) continue;
      lines.push(`  ${event.type}  ${summarizeEvent(event)}`);
    }
  }

  return lines;
}

export function formatDashboardSnapshot(dashboard) {
  const active = dashboard?.activeRuns?.length ?? 0;
  const recent = dashboard?.recentRuns?.length ?? 0;
  const auditable = (dashboard?.providers ?? []).filter((entry) => entry.compatible).length;
  return [
    `Active runs: ${active}`,
    `Recent runs: ${recent}`,
    `Auditable providers: ${auditable}/${dashboard?.providers?.length ?? 0}`
  ];
}

export function selectRunFromList(runs, index) {
  return runs[index] ?? null;
}

export function filterInspectableRuns(runs) {
  return runs ?? [];
}

export function isRunCancellable(run) {
  return run && isActiveRunState(run.state);
}

function humanizeToken(value) {
  const raw = String(value ?? "agent");
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function humanizeRunState(state) {
  switch (state) {
    case "succeeded":
    case "completed":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "cancelled":
    case "canceled":
      return "Cancelled";
    case "running":
    case "starting":
      return "Running";
    default:
      return humanizeToken(state);
  }
}

function summarizeEvent(event) {
  if (event.type === "agent.tool_call") {
    return event.data?.tool_name ?? event.data?.name ?? "tool";
  }
  if (event.type === "process.stdout" || event.type === "process.stderr") {
    const line = event.data?.line ?? "";
    return line.length > 60 ? `${line.slice(0, 59)}…` : line;
  }
  if (event.type === "run.completed" || event.type === "run.failed") {
    return `exit=${event.data?.exitCode ?? "n/a"}`;
  }
  return "";
}
