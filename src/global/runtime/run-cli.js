import { resolveHomeDir } from "../paths.js";
import { resolveProfile } from "../profile.js";
import { printJson } from "../json-output.js";
import { BRAND, commandHeader } from "../brand/index.js";
import { formatCliCommand } from "../brand/cli.js";
import { inspectExecutionAdapters } from "./execution-adapters/index.js";
import {
  listRunRecords,
  readRunEvents,
  readRunState
} from "./run-store.js";
import {
  recoverRuns,
  resolveRunAgent,
  startRun,
  stopRun
} from "./run-manager.js";
import { isActiveRunState, formatTaskLabel } from "./run-types.js";
import { resolveAgentFromProfile } from "./run-profile.js";

export async function runGlobalRun(options, packageManifest, { startRunImpl = startRun } = {}) {
  const homeDir = resolveHomeDir();
  await recoverRuns(homeDir);

  if (!options.task) {
    throw new Error(`Missing task. Use: ${formatCliCommand('run --agent <id> --task "..."')}`);
  }

  const profileResolved = await resolveProfile({
    homeDir,
    workspaceRoot: options.cwd
  });

  const runtime = resolveAgentFromProfile(profileResolved, options.agent);
  const permissions = options.permissions ?? runtime.permissions;
  const captureTranscript = options.captureTranscript || runtime.captureTranscript;

  const { runId, metadata, completion } = await startRunImpl({
    homeDir,
    agentId: runtime.agentId,
    task: options.task,
    cwd: options.cwd,
    model: options.model ?? runtime.model,
    permissions,
    captureTranscript,
    cliVersion: packageManifest.version,
    profile: profileResolved,
    follow: options.follow,
    timeoutMs: options.timeoutMs,
    wait: options.wait !== false
  });

  if (!options.json) {
    console.log(commandHeader(`run started · ${metadata.agentId} · ${runId}`));
    console.log(`Task: ${formatTaskLabel(metadata)}`);
    console.log(`Cwd: ${metadata.cwd}`);
    if (!options.wait) {
      console.log(`Follow: ${formatCliCommand(`runs show ${runId} --follow`)}`);
      return { runId, metadata };
    }
  } else if (!options.wait) {
    printJson({ runId, metadata });
    return { runId, metadata };
  }

  if (!completion) {
    if (options.json) {
      printJson({ runId, metadata });
    }
    return { runId, metadata };
  }

  const final = await completion;

  if (options.json) {
    printJson({ runId, metadata: final });
  } else {
    console.log(`Run ${final.state} (exit ${final.exitCode ?? "n/a"})`);
  }

  return { runId, metadata: final };
}

export async function runGlobalRuns(options, packageManifest) {
  const homeDir = resolveHomeDir();
  await recoverRuns(homeDir);

  switch (options.runsAction ?? "list") {
    case "list":
      return runRunsList(homeDir, options);
    case "show":
      return runRunsShow(homeDir, options);
    case "stop":
      return runRunsStop(homeDir, options);
    default:
      throw new Error(`Unknown runs action "${options.runsAction}". Use list, show, or stop.`);
  }
}

async function runRunsList(homeDir, options) {
  const runs = await listRunRecords(homeDir, {
    limit: options.limit,
    activeOnly: options.activeOnly
  });

  if (options.json) {
    printJson({ runs, providers: inspectExecutionAdapters({ cwd: options.cwd }) });
    return { runs };
  }

  console.log(commandHeader("runs"));
  const active = runs.filter((run) => isActiveRunState(run.state));
  console.log(`Active: ${active.length} · Total shown: ${runs.length}`);
  console.log("");

  for (const run of runs) {
    console.log(
      `  ${run.runId}  ${run.state.padEnd(12)}  ${run.agentId.padEnd(10)}  ${formatTaskLabel(run)}`
    );
  }

  if (runs.length === 0) {
    console.log(`  (no runs yet — launch with ${formatCliCommand('run --agent cursor --task "..."')})`);
  }

  return { runs };
}

async function runRunsShow(homeDir, options) {
  if (!options.runId) {
    throw new Error(`Missing run id. Use: ${formatCliCommand("runs show <runId>")}`);
  }

  const metadata = await readRunState(homeDir, options.runId);
  if (!metadata) {
    throw new Error(`Run "${options.runId}" not found.`);
  }

  const events = await readRunEvents(homeDir, options.runId, { limit: options.limit });

  if (options.json) {
    printJson({ metadata, events });
    return { metadata, events };
  }

  console.log(commandHeader(`run ${metadata.runId}`));
  console.log(`Agent: ${metadata.agentId} (${metadata.provider})`);
  console.log(`State: ${metadata.state}`);
  console.log(`Model: ${metadata.model ?? "default"}`);
  console.log(`Cwd: ${metadata.cwd}`);
  console.log(`Started: ${metadata.startedAt}`);
  if (metadata.completedAt) console.log(`Completed: ${metadata.completedAt}`);
  if (metadata.tokenUsage) console.log(`Tokens: ${JSON.stringify(metadata.tokenUsage)}`);
  if (metadata.diffSummary) console.log(`Diff: ${JSON.stringify(metadata.diffSummary)}`);
  if (metadata.error) console.log(`Error: ${metadata.error}`);
  console.log("");
  console.log("Events:");

  for (const event of events) {
    if (event.parseError) {
      console.log(`  [parse error line ${event.line}]`);
      continue;
    }
    const summary = summarizeEvent(event);
    console.log(`  ${event.timestamp}  ${event.type}  ${summary}`);
    if (options.follow) {
      // follow is for live runs; show replays events only
    }
  }

  return { metadata, events };
}

async function runRunsStop(homeDir, options) {
  if (!options.runId) {
    throw new Error(`Missing run id. Use: ${formatCliCommand("runs stop <runId>")}`);
  }

  const metadata = await stopRun(homeDir, options.runId);

  if (options.json) {
    printJson({ metadata });
    return { metadata };
  }

  console.log(commandHeader(`run ${metadata.runId} cancelled`));
  console.log(`State: ${metadata.state}`);
  return { metadata };
}

function summarizeEvent(event) {
  if (event.type === "agent.tool_call") {
    return event.data?.tool_name ?? event.data?.name ?? "tool";
  }
  if (event.type === "process.stdout" || event.type === "process.stderr") {
    const line = event.data?.line ?? "";
    return line.length > 80 ? `${line.slice(0, 79)}…` : line;
  }
  if (event.type === "run.completed" || event.type === "run.failed") {
    return `exit=${event.data?.exitCode ?? "n/a"}`;
  }
  return "";
}

export async function buildRuntimeDashboardData({ homeDir, workspaceRoot, cliVersion }) {
  await recoverRuns(homeDir);
  const [runs, providers, profileResolved] = await Promise.all([
    listRunRecords(homeDir, { limit: 20 }),
    Promise.resolve(inspectExecutionAdapters({ cwd: workspaceRoot })),
    resolveProfile({ homeDir, workspaceRoot })
  ]);

  return {
    cliVersion,
    runs,
    activeRuns: runs.filter((run) => isActiveRunState(run.state)),
    recentRuns: runs.filter((run) => !isActiveRunState(run.state)).slice(0, 10),
    providers,
    profile: profileResolved
  };
}
