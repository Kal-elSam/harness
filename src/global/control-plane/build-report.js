/**
 * Build kairo.control-plane/v1 from next + connections/fleet + Gentle adapters.
 */
import { buildNextReport } from "../next/next-report.js";
import { buildConnectionsReport } from "../connections.js";
import { resolveHomeDir } from "../paths.js";
import {
  CONTROL_PLANE_SCHEMA,
  NO_ACTIVE_WORKFLOW,
  WORKFLOW_KIND
} from "./constants.js";
import { loadGentleWorkflow } from "./gentle-adapters.js";
import { normalizeTeam } from "./team.js";

function sectionOk() {
  return { ok: true, error: null };
}

function sectionErr(error) {
  return { ok: false, error: String(error ?? "section_failed") };
}

function buildAttention({ work, workflow, team, connections }) {
  const items = [];
  const primaryActions = [];
  const secondaryActions = [
    { id: "setup", label: "Setup", command: "kairo setup --dry-run" },
    { id: "models", label: "Models", command: "kairo fleet models" },
    { id: "catalog", label: "Catalog", command: "kairo fleet" },
    { id: "doctor", label: "Doctor", command: "kairo doctor" }
  ];

  if (work?.integration?.showRepair === true) {
    items.push({
      id: "repair-integration",
      severity: "error",
      message: work.integration.detail ?? "MCP integration needs repair."
    });
    primaryActions.push({
      id: "repair",
      label: "Repair",
      command: "kairo mcp install --yes"
    });
  }

  if (work?.integration?.state === "missing") {
    items.push({
      id: "connect-mcp",
      severity: "warning",
      message: "Kairo MCP is not registered."
    });
    if (primaryActions.length < 2) {
      primaryActions.push({
        id: "connect",
        label: "Connect Agent",
        command: "kairo mcp install --yes"
      });
    }
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
    // Informational only — not a primary action.
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

export async function buildControlPlaneReport({
  homeDir = resolveHomeDir(),
  cwd = process.cwd(),
  client = "cursor",
  provider = "cursor",
  packageRoot = null,
  packageName = null,
  cliVersion = null,
  buildNext = buildNextReport,
  buildConnections = buildConnectionsReport,
  loadWorkflow = loadGentleWorkflow
} = {}) {
  const diagnostics = [];
  const sections = {
    work: sectionOk(),
    workflow: sectionOk(),
    team: sectionOk(),
    attention: sectionOk()
  };

  let work;
  try {
    work = await buildNext({ homeDir, cwd, provider, client });
  } catch (error) {
    work = {
      schema: "kairo.next/v1",
      ok: false,
      goal: null,
      progress: [],
      now: null,
      blockers: [],
      next: null,
      conversationId: null,
      updatedAt: null,
      integration: {
        state: "broken",
        provider,
        client,
        mcpConnected: false,
        enrolled: false,
        showRepair: true,
        detail: error instanceof Error ? error.message : String(error)
      },
      diagnostics: ["work_build_failed"]
    };
    sections.work = sectionErr("work_build_failed");
    diagnostics.push("work_build_failed");
  }

  let connectionsReport;
  try {
    connectionsReport = await buildConnections({
      homeDir,
      workspaceRoot: cwd,
      client,
      packageRoot,
      packageName,
      cliVersion
    });
  } catch (error) {
    connectionsReport = {
      ok: false,
      connections: [],
      fleets: [],
      activity: null,
      fleetNote: null,
      orchestratorAuthority: null
    };
    sections.team = sectionErr("team_build_failed");
    diagnostics.push("team_build_failed");
  }

  const team = normalizeTeam(connectionsReport);
  if (sections.team.ok && team.platforms.length === 0 && connectionsReport?.ok === false) {
    sections.team = sectionErr(connectionsReport.error ?? "team_empty");
  }

  const gentle = await loadWorkflow({ cwd });
  let workflow = gentle.workflow;
  if (workflow && gentle.provider && workflow.provider == null) {
    workflow = { ...workflow, provider: gentle.provider };
  }
  if (!gentle.ok) {
    sections.workflow = sectionErr(gentle.error ?? "gentle_unavailable");
    diagnostics.push(gentle.error ?? "gentle_unavailable");
    if (!workflow?.active && !workflow?.review) {
      workflow = {
        kind: WORKFLOW_KIND.NONE,
        active: false,
        label: NO_ACTIVE_WORKFLOW,
        phase: null,
        nextTransition: null,
        changeName: null,
        review: null,
        provider: gentle.provider ?? workflow?.provider ?? null
      };
    }
  }

  const attention = buildAttention({
    work,
    workflow,
    team,
    connections: team.connections
  });

  const ok = sections.work.ok || sections.team.ok;

  return {
    schema: CONTROL_PLANE_SCHEMA,
    ok,
    generatedAt: new Date().toISOString(),
    client,
    work,
    workflow,
    team,
    attention,
    sections,
    diagnostics
  };
}

export { normalizeTeam };
