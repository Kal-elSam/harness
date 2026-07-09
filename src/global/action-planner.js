import { CAPABILITY_STATES } from "./capability-states.js";
import { inspectAllCapabilities } from "./capability-registry.js";
import { resolveProfile, resolveProfileAgents } from "./profile.js";
import { formatCliCommand } from "./brand/cli.js";

export const PLAN_ACTIONS = {
  DIAGNOSE: "diagnose",
  SETUP: "setup",
  SYNC: "sync",
  INSTALL: "install",
  STATUS: "status"
};

export async function buildReadOnlyDiagnostics({
  homeDir,
  workspaceRoot,
  packageName,
  packageRoot,
  cliVersion
}) {
  const [{ profile, sources }, capabilities] = await Promise.all([
    resolveProfile({ homeDir, workspaceRoot }),
    inspectAllCapabilities({ homeDir, workspaceRoot, packageName })
  ]);

  const detectedIds = capabilities.filter((entry) => entry.detected).map((entry) => entry.id);
  const profileAgents = resolveProfileAgents(profile, detectedIds);
  const diagnostics = summarizeDiagnostics(capabilities);

  return {
    readOnly: true,
    cliVersion,
    profile: { ...profile, sources },
    capabilities,
    profileAgents,
    diagnostics,
    recommendations: buildDiagnosticRecommendations({ capabilities, profile, diagnostics })
  };
}

export async function buildActionPlan({
  action,
  homeDir,
  workspaceRoot,
  packageName,
  options = {}
}) {
  const diagnostics = await buildReadOnlyDiagnostics({
    homeDir,
    workspaceRoot,
    packageName,
    packageRoot: options.packageRoot ?? null,
    cliVersion: options.cliVersion ?? null
  });

  const steps = [];
  const warnings = [];

  switch (action) {
    case PLAN_ACTIONS.DIAGNOSE:
    case PLAN_ACTIONS.STATUS:
      return {
        action,
        readOnly: true,
        requiresConfirmation: false,
        steps: ["Show ecosystem diagnostics (read-only)."],
        diagnostics,
        warnings
      };
    case PLAN_ACTIONS.SETUP:
    case PLAN_ACTIONS.INSTALL:
      steps.push(`Target agents: ${diagnostics.profileAgents.join(", ")}`);
      steps.push("Preview managed section changes under ~/.harness and agent config files.");
      steps.push("Create backups before writing managed content.");
      if (options.dryRun) {
        steps.push("Dry run: no files will be written.");
      }
      return {
        action,
        readOnly: Boolean(options.dryRun),
        requiresConfirmation: !options.dryRun,
        steps,
        diagnostics,
        warnings: collectCapabilityWarnings(diagnostics.capabilities)
      };
    case PLAN_ACTIONS.SYNC:
      steps.push("Compare managed content against bundled assets.");
      steps.push("Repair drift in agent config files when differences are found.");
      if (options.dryRun) {
        steps.push("Dry run: show planned repairs only.");
      }
      return {
        action,
        readOnly: Boolean(options.dryRun),
        requiresConfirmation: !options.dryRun,
        steps,
        diagnostics,
        warnings: collectCapabilityWarnings(diagnostics.capabilities)
      };
    default: {
      const _exhaustive = action;
      throw new Error(`Unknown plan action "${_exhaustive}".`);
    }
  }
}

export function shouldExecutePlan(plan, { confirmed = false } = {}) {
  if (plan.readOnly) return true;
  return confirmed;
}

export function formatActionPlan(plan) {
  const lines = [];
  lines.push(`Action: ${plan.action}`);
  lines.push(`Mode: ${plan.readOnly ? "read-only" : "write"}`);
  lines.push(`Confirmation required: ${plan.requiresConfirmation ? "yes" : "no"}`);
  lines.push("");
  lines.push("Steps:");
  for (const step of plan.steps) {
    lines.push(`  - ${step}`);
  }

  if (plan.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const warning of plan.warnings) {
      lines.push(`  - ${warning}`);
    }
  }

  if (plan.diagnostics.recommendations.length > 0) {
    lines.push("");
    lines.push("Recommendations:");
    for (const recommendation of plan.diagnostics.recommendations) {
      lines.push(`  - ${recommendation}`);
    }
  }

  return lines.join("\n");
}

function summarizeDiagnostics(capabilities) {
  return {
    detected: capabilities.filter((entry) => entry.detected).length,
    available: capabilities.filter((entry) => entry.state === CAPABILITY_STATES.AVAILABLE).length,
    unknown: capabilities.filter((entry) => entry.state === CAPABILITY_STATES.UNKNOWN).length,
    errors: capabilities.filter((entry) => entry.state === CAPABILITY_STATES.ERROR).length
  };
}

function buildDiagnosticRecommendations({ capabilities, profile, diagnostics }) {
  const recommendations = [];

  if (diagnostics.detected === 0) {
    recommendations.push(`No agents detected. Run ${formatCliCommand("detect")} or install a supported agent CLI.`);
  }

  if (profile.coordinator) {
    const coordinator = capabilities.find((entry) => entry.id === profile.coordinator);
    if (!coordinator?.detected && coordinator?.state === CAPABILITY_STATES.UNKNOWN) {
      recommendations.push(`Profile coordinator "${profile.coordinator}" is not detected on this machine.`);
    }
  }

  for (const capability of capabilities) {
    if (capability.recommendation) {
      recommendations.push(`${capability.label}: ${capability.recommendation}`);
    }
  }

  return [...new Set(recommendations)];
}

function collectCapabilityWarnings(capabilities) {
  return capabilities
    .filter((entry) => entry.state === CAPABILITY_STATES.ERROR || entry.state === CAPABILITY_STATES.UNKNOWN)
    .map((entry) => `${entry.label} is ${entry.state}${entry.error ? ` (${entry.error})` : ""}.`);
}
