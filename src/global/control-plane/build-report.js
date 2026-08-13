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
import { buildAttention } from "./attention.js";
import { loadGentleWorkflow } from "./gentle-adapters.js";
import { normalizeTeam } from "./team.js";

function sectionOk() {
  return { ok: true, error: null };
}

function sectionErr(error) {
  return { ok: false, error: String(error ?? "section_failed") };
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
