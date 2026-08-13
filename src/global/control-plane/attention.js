/**
 * Attention items and ≤2 primary actions. Gentle commands stay verbatim.
 */
import {
  GENTLE_DOCTOR_COMMAND,
  GENTLE_INSTALL_HINT,
  GENTLE_UPGRADE_LABEL,
  NO_ACTIVE_WORKFLOW,
  PROVIDER,
  WORKFLOW_KIND
} from "./constants.js";

function gentlePrimary(workflow) {
  const provider = workflow?.provider;
  if (provider === PROVIDER.UPGRADE_REQUIRED) {
    return {
      item: {
        id: "upgrade-gentle",
        severity: "warning",
        message: "Gentle contract is outdated. Upgrade Gentle — do not approximate workflow."
      },
      action: {
        id: "upgrade-gentle",
        label: GENTLE_UPGRADE_LABEL,
        command: GENTLE_DOCTOR_COMMAND
      }
    };
  }
  if (provider === PROVIDER.UNAVAILABLE) {
    return {
      item: {
        id: "install-gentle",
        severity: "warning",
        message: GENTLE_INSTALL_HINT
      },
      action: {
        id: "install-gentle",
        label: "Install Gentle",
        command: null
      }
    };
  }
  if (provider === PROVIDER.INCOMPATIBLE) {
    return {
      item: {
        id: "gentle-incompatible",
        severity: "error",
        message: "Gentle response is incompatible. Fail closed."
      },
      action: null
    };
  }
  const command = workflow?.nextTransition?.execute?.command;
  if (provider === PROVIDER.CONNECTED && typeof command === "string" && command) {
    const operation = workflow.nextTransition.execute.operation;
    return {
      item: null,
      action: {
        id: "gentle-next",
        label: typeof operation === "string" && operation ? operation : "Continue Gentle",
        command
      }
    };
  }
  return { item: null, action: null };
}

export function buildAttention({ work, workflow, team, connections }) {
  const items = [];
  const primaryActions = [];
  const secondaryActions = [
    { id: "setup", label: "Setup", command: "kairo setup --dry-run" },
    { id: "models", label: "Models", command: "kairo fleet models" },
    { id: "catalog", label: "Catalog", command: "kairo fleet" },
    { id: "doctor", label: "Doctor", command: "kairo doctor" }
  ];

  const gentle = gentlePrimary(workflow);
  if (gentle.item) items.push(gentle.item);
  if (gentle.action) primaryActions.push(gentle.action);

  if (work?.integration?.showRepair === true) {
    items.push({
      id: "repair-integration",
      severity: "error",
      message: work.integration.detail ?? "MCP integration needs repair."
    });
    if (primaryActions.length < 2) {
      primaryActions.push({
        id: "repair",
        label: "Repair",
        command: "kairo mcp install --yes"
      });
    }
  }

  if (work?.integration?.state === "missing" && primaryActions.length < 2) {
    items.push({
      id: "connect-mcp",
      severity: "warning",
      message: "Kairo MCP is not registered."
    });
    primaryActions.push({
      id: "connect",
      label: "Connect Agent",
      command: "kairo mcp install --yes"
    });
  }

  for (const chip of connections ?? []) {
    if (chip?.state === "error" || chip?.state === "conflict") {
      items.push({
        id: `conn-${chip.id}`,
        severity: "warning",
        message: `${chip.label ?? chip.id}: ${chip.detail ?? chip.state}`
      });
    }
  }

  if (!team?.platforms?.length) {
    items.push({
      id: "no-platforms",
      severity: "info",
      message: "No platforms detected in declared fleet topology."
    });
  }

  if (workflow?.kind === WORKFLOW_KIND.NONE && !workflow?.active) {
    items.push({
      id: "no-workflow",
      severity: "info",
      message: NO_ACTIVE_WORKFLOW
    });
  }

  return {
    items,
    primaryActions: primaryActions.slice(0, 2),
    secondaryActions
  };
}
