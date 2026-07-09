import { stdin as input, stdout as output } from "node:process";
import { canUseSetupInk } from "./terminal.js";

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
  AGENTS: "agents",
  PROFILE: "profile",
  PLAN: "plan",
  CONFIRM: "confirm",
  HELP: "help"
};

export const ORCHESTRATOR_MENU = [
  { id: "status", label: "Diagnostics", view: ORCHESTRATOR_VIEWS.HOME },
  { id: "agents", label: "Agents", view: ORCHESTRATOR_VIEWS.AGENTS },
  { id: "profile", label: "Profile", view: ORCHESTRATOR_VIEWS.PROFILE },
  { id: "plan-setup", label: "Plan setup", view: ORCHESTRATOR_VIEWS.PLAN, action: "setup" },
  { id: "help", label: "Help", view: ORCHESTRATOR_VIEWS.HELP }
];

export function formatAgentStatusLines(capabilities) {
  return capabilities.map((entry) => {
    const auth = entry.authenticated == null ? "n/a" : (entry.authenticated ? "yes" : "no");
    const version = entry.version ?? "unknown";
    return `${entry.label.padEnd(14)} ${entry.state.padEnd(14)} v${version} auth=${auth}`;
  });
}

export function formatProfileLines(profileJson) {
  const lines = [
    `Coordinator: ${profileJson.coordinator ?? "none"}`,
    `Default agents: ${formatAgentsLabel(profileJson.defaultAgents)}`,
    `Apply mode: ${profileJson.applyMode}`
  ];

  if (profileJson.sources.global) {
    lines.push(`Global: ${profileJson.sources.global}`);
  }

  if (profileJson.sources.project) {
    lines.push(`Project: ${profileJson.sources.project}`);
  }

  lines.push(`Precedence: ${profileJson.sources.precedence}`);
  return lines;
}

export function formatPlanLines(plan) {
  const lines = [`Action: ${plan.action}`, ""];
  for (const step of plan.steps) {
    lines.push(`  • ${step}`);
  }

  if (plan.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of plan.warnings) {
      lines.push(`  ! ${warning}`);
    }
  }

  return lines;
}

function formatAgentsLabel(agents) {
  if (agents === "detected") return "detected";
  if (agents === "all") return "all";
  if (Array.isArray(agents)) return agents.join(", ");
  return String(agents);
}
