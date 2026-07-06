import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { harnessHomePaths } from "./paths.js";
import { buildEffectivePolicy, loadConsentAudit } from "./policy.js";
import { buildStatusReport } from "./status.js";

export function getHistoryPath(homeDir) {
  return harnessHomePaths(homeDir).historyPath;
}

export function buildCheckSnapshot(counts) {
  if (!counts) return null;

  return {
    ok: counts.ok ?? 0,
    missing: counts.missing ?? 0,
    stale: counts.stale ?? 0,
    warning: counts.warning ?? 0
  };
}

export function createHistoryEvent({ cliVersion, ...fields }) {
  return {
    timestamp: new Date().toISOString(),
    cliVersion,
    ...fields
  };
}

export async function appendHistoryEvent(homeDir, event) {
  const { root, historyPath } = harnessHomePaths(homeDir);
  await mkdir(root, { recursive: true });
  await appendFile(historyPath, `${JSON.stringify(event)}\n`, "utf8");
}

export async function readHistoryEvents(homeDir, { limit = null, command = null, action = null } = {}) {
  const { historyPath } = harnessHomePaths(homeDir);

  if (!existsSync(historyPath)) {
    return { events: [], warnings: [] };
  }

  const content = await readFile(historyPath, "utf8");
  const lines = content.split("\n").filter((line) => line.trim().length > 0);
  const events = [];
  const warnings = [];

  for (let index = 0; index < lines.length; index += 1) {
    try {
      events.push(JSON.parse(lines[index]));
    } catch (error) {
      warnings.push({ line: index + 1, message: error.message });
    }
  }

  let filtered = events;

  if (command) {
    filtered = filtered.filter((event) => event.command === command);
  }

  if (action) {
    filtered = filtered.filter((event) => event.action === action);
  }

  if (limit != null && limit > 0) {
    return { events: filtered.slice(-limit), warnings };
  }

  return { events: filtered, warnings };
}

export async function readLastHistoryEvent(homeDir, { command = null, action = null } = {}) {
  const { events, warnings } = await readHistoryEvents(homeDir, { command, action });
  return {
    event: events.length > 0 ? events[events.length - 1] : null,
    warnings
  };
}

async function resolveHistoryPolicy(homeDir) {
  const policy = await buildEffectivePolicy(homeDir);

  return {
    profile: policy.profile,
    applyMode: policy.applyMode,
    preflight: policy.preflight,
    source: policy.source
  };
}

async function resolveConsentSource(homeDir, consentOptions) {
  const consent = await loadConsentAudit(homeDir, consentOptions);
  return consent.consentSource;
}

function buildConsentOptions(options, { applying, dryRun }) {
  return {
    yes: options.yes,
    confirm: options.confirm,
    yesExplicit: options.yesExplicit,
    confirmExplicit: options.confirmExplicit,
    preflight: options.preflight,
    preflightExplicit: options.preflightExplicit,
    interactive: options.interactive,
    applying,
    dryRun,
    json: options.json
  };
}

async function recordEvent(homeDir, cliVersion, fields) {
  const policy = fields.policy ?? await resolveHistoryPolicy(homeDir);

  await appendHistoryEvent(homeDir, createHistoryEvent({
    cliVersion,
    policy,
    consentSource: fields.consentSource ?? "none",
    agents: fields.agents ?? null,
    components: fields.components ?? null,
    checksBefore: fields.checksBefore ?? null,
    checksAfter: fields.checksAfter ?? null,
    backupsCreated: fields.backupsCreated ?? null,
    snapshotsUsed: fields.snapshotsUsed ?? null,
    command: fields.command,
    action: fields.action,
    wrote: fields.wrote,
    dryRun: fields.dryRun ?? false
  }));
}

export async function recordSetupHistory(homeDir, {
  cliVersion,
  options,
  outcome,
  checksBefore = null,
  packageRoot,
  workspaceRoot
}) {
  if (options.dryRun) {
    return;
  }

  if (outcome.cancelled) {
    await recordEvent(homeDir, cliVersion, {
      command: "setup",
      action: "cancelled",
      wrote: false,
      dryRun: false,
      checksBefore
    });
    return;
  }

  const consentSource = await resolveConsentSource(
    homeDir,
    buildConsentOptions(options, { applying: true, dryRun: false })
  );
  const postReport = await buildStatusReport(homeDir, { packageRoot, workspaceRoot });

  await recordEvent(homeDir, cliVersion, {
    command: "setup",
    action: "applied",
    wrote: true,
    dryRun: false,
    consentSource,
    agents: outcome.result.agents,
    components: outcome.result.components,
    checksBefore,
    checksAfter: buildCheckSnapshot(postReport.counts),
    backupsCreated: outcome.result.backups
  });
}

export async function recordSyncHistory(homeDir, {
  cliVersion,
  options,
  outcome,
  checksBefore,
  packageRoot,
  workspaceRoot
}) {
  if (options.dryRun || outcome.action === "setup-required" || outcome.action === "noop" || outcome.action === "plan") {
    return;
  }

  if (outcome.action === "cancelled") {
    await recordEvent(homeDir, cliVersion, {
      command: "sync",
      action: "cancelled",
      wrote: false,
      dryRun: false,
      checksBefore
    });
    return;
  }

  const consentSource = await resolveConsentSource(
    homeDir,
    buildConsentOptions(options, { applying: true, dryRun: false })
  );
  const postReport = await buildStatusReport(homeDir, { packageRoot, workspaceRoot });

  await recordEvent(homeDir, cliVersion, {
    command: "sync",
    action: "repaired",
    wrote: outcome.wrote,
    dryRun: false,
    consentSource,
    agents: outcome.result?.agents ?? null,
    components: outcome.result?.components ?? null,
    checksBefore,
    checksAfter: buildCheckSnapshot(postReport.counts),
    backupsCreated: outcome.result?.backups ?? null
  });
}

export async function recordUpgradeHistory(homeDir, {
  cliVersion,
  options,
  outcome,
  checksBefore = null,
  packageRoot,
  workspaceRoot
}) {
  if (outcome.cancelled) {
    await recordEvent(homeDir, cliVersion, {
      command: "upgrade",
      action: "cancelled",
      wrote: false,
      dryRun: false,
      checksBefore
    });
    return;
  }

  if (outcome.dryRun) {
    return;
  }

  const consentSource = await resolveConsentSource(
    homeDir,
    buildConsentOptions(options, { applying: true, dryRun: false })
  );
  const postReport = await buildStatusReport(homeDir, { packageRoot, workspaceRoot });

  await recordEvent(homeDir, cliVersion, {
    command: "upgrade",
    action: "applied",
    wrote: true,
    dryRun: false,
    consentSource,
    agents: outcome.result?.agents ?? null,
    components: outcome.result?.components ?? null,
    checksBefore,
    checksAfter: buildCheckSnapshot(postReport.counts),
    backupsCreated: outcome.result?.backups ?? null
  });
}

export async function recordRollbackHistory(homeDir, {
  cliVersion,
  snapshot,
  result
}) {
  await recordEvent(homeDir, cliVersion, {
    command: "rollback",
    action: result.noop ? "noop" : "applied",
    wrote: !result.noop,
    dryRun: false,
    snapshotsUsed: [snapshot],
    backupsCreated: result.safetyBackup ? [result.safetyBackup] : null
  });
}

export async function recordUninstallHistory(homeDir, {
  cliVersion,
  options,
  result
}) {
  if (options.dryRun) {
    return;
  }

  await recordEvent(homeDir, cliVersion, {
    command: "uninstall",
    action: "applied",
    wrote: true,
    dryRun: false,
    backupsCreated: result.backups
  });
}

export async function recordPolicyHistory(homeDir, {
  cliVersion,
  action
}) {
  await recordEvent(homeDir, cliVersion, {
    command: "policy",
    action,
    wrote: true,
    dryRun: false
  });
}

export function formatHistoryEvent(event) {
  const wrote = event.wrote ? "yes" : "no";
  const agents = Array.isArray(event.agents) ? event.agents.join(",") : "-";
  const components = Array.isArray(event.components) ? event.components.join(",") : "-";
  const consent = event.consentSource ?? "none";

  return `${event.timestamp}  ${event.command.padEnd(8)} ${String(event.action).padEnd(10)} wrote=${wrote} consent=${consent} agents=${agents} components=${components}`;
}
