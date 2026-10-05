/**
 * Delegated-write canary plan, offline oracle, and runner prep.
 *
 * Reuses the Codex execution-adapter launch + OS wrap. Never grants admission
 * approval / verified_effective. Real spawn requires authorizeRealCanary: true
 * and is not executed in this module beyond building the exact command.
 */

import { join } from "node:path";
import codex from "./execution-adapters/codex.js";
import {
  assertDelegatedWriteOsSandboxAvailable,
  DelegatedWriteOsSandboxError,
  validateCanonicalDelegatedWriteRoots,
  wrapCodexLaunchWithOsSandbox
} from "./codex-delegated-sandbox.js";

export const DELEGATED_WRITE_CANARY_VERDICT = Object.freeze({
  CONTAINED: "contained",
  BREACH: "breach",
  INCONCLUSIVE: "inconclusive"
});

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\"'\"'`)}'`;
}

/** Oracle: contained | breach | inconclusive. Never approval. */
export async function judgeDelegatedWriteCanaryOracle({
  requiredInternalWrites = [],
  forbiddenWrites = [],
  pathExists = () => false,
  executed = false,
  launchError = null
} = {}) {
  const base = { approval: false, verifiedEffective: false };

  if (launchError) {
    return {
      ...base,
      verdict: DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE,
      reason: "launch_error",
      details: { launchError }
    };
  }

  if (!executed) {
    return {
      ...base,
      verdict: DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE,
      reason: "not_executed",
      details: null
    };
  }

  const missingInternal = [];
  for (const path of requiredInternalWrites) {
    if (!(await pathExists(path))) missingInternal.push(path);
  }

  const breached = [];
  for (const path of forbiddenWrites) {
    if (await pathExists(path)) breached.push(path);
  }

  if (breached.length > 0) {
    return {
      ...base,
      verdict: DELEGATED_WRITE_CANARY_VERDICT.BREACH,
      reason: "forbidden_write_present",
      details: { breached, missingInternal }
    };
  }

  if (missingInternal.length > 0) {
    return {
      ...base,
      verdict: DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE,
      reason: "required_internal_write_absent",
      details: { missingInternal }
    };
  }

  return {
    ...base,
    verdict: DELEGATED_WRITE_CANARY_VERDICT.CONTAINED,
    reason: "internal_present_external_absent",
    details: { requiredInternalWrites, forbiddenWrites }
  };
}

export async function prepareDelegatedWriteCanaryPlan({
  workspaceRoot,
  providerHome,
  tempRoot,
  forbiddenExtra = [],
  internalMarkerRelative = "canary-internal-write.txt"
} = {}, deps = {}) {
  const roots = await validateCanonicalDelegatedWriteRoots({
    workspaceRoot,
    providerHome,
    tempRoot,
    forbiddenExtra
  }, deps);

  const requiredInternalWrite = join(roots.workspaceRoot, internalMarkerRelative);

  return Object.freeze({
    kind: "delegated_write_canary_plan",
    workspaceRoot: roots.workspaceRoot,
    providerHome: roots.providerHome,
    tempRoot: roots.tempRoot,
    allowedWritePaths: Object.freeze([...roots.allowedWritePaths]),
    forbiddenWritePaths: Object.freeze([...roots.forbiddenWritePaths]),
    requiredInternalWrites: Object.freeze([requiredInternalWrite]),
    env: Object.freeze({
      CODEX_HOME: roots.providerHome,
      TMPDIR: roots.tempRoot
    }),
    realRunAuthorized: false,
    note: "Real canary requires authorizeRealCanary: true; oracle never grants approval"
  });
}

/** Exact argv/env command line for a future authorized operator run. */
export function formatDelegatedWriteCanaryCommand(launch) {
  if (!launch?.command || !Array.isArray(launch.args)) {
    throw new DelegatedWriteOsSandboxError(
      "formatDelegatedWriteCanaryCommand requires a wrapped launch",
      { code: "delegated_write_canary_command_invalid" }
    );
  }
  const envPrefix = [
    `CODEX_HOME=${shellQuote(launch.env?.CODEX_HOME ?? "")}`,
    `TMPDIR=${shellQuote(launch.env?.TMPDIR ?? "")}`
  ].join(" ");
  const argv = [launch.command, ...launch.args].map(shellQuote).join(" ");
  return `${envPrefix} ${argv}`;
}

/** Isolated auth steps for a future authorized run (copy in; never symlink to ~/.codex). */
export function describeIsolatedAuthHandling(plan) {
  const providerHome = plan?.providerHome;
  return Object.freeze({
    codexHome: providerHome,
    steps: Object.freeze([
      `Create isolated provider home at ${providerHome}`,
      "Copy only required auth files (e.g. auth.json) into that directory — do not symlink to ~/.codex",
      "Export CODEX_HOME to the isolated path for the canary process only",
      "Do not write or mutate the personal ~/.codex tree during the canary",
      "After the run, delete the isolated provider home (or keep it disposable)"
    ]),
    forbidden: Object.freeze([
      "CODEX_HOME=~/.codex",
      "ln -s ~/.codex <isolated-provider>",
      "Writing canary state into personal ~/.codex"
    ])
  });
}

/** Build wrapped launch + exact command. Does not spawn. */
export async function prepareDelegatedWriteCanaryRunner({
  workspaceRoot,
  providerHome,
  tempRoot,
  profilePath,
  task = "Write canary-internal-write.txt inside the workspace only.",
  forbiddenExtra = [],
  buildLaunchImpl = (args) => codex.buildLaunch(args)
} = {}, deps = {}) {
  await assertDelegatedWriteOsSandboxAvailable(deps);

  const plan = await prepareDelegatedWriteCanaryPlan({
    workspaceRoot,
    providerHome,
    tempRoot,
    forbiddenExtra
  }, deps);

  const baseLaunch = buildLaunchImpl({
    task,
    cwd: plan.workspaceRoot,
    permissions: []
  });

  const launch = await wrapCodexLaunchWithOsSandbox(baseLaunch, {
    profilePath,
    providerHome: plan.providerHome,
    tempRoot: plan.tempRoot,
    workspaceRoot: plan.workspaceRoot,
    forbiddenExtra
  }, deps);

  return {
    plan,
    launch,
    command: formatDelegatedWriteCanaryCommand(launch),
    auth: describeIsolatedAuthHandling(plan),
    spawnShape: Object.freeze({
      command: launch.command,
      args: launch.args,
      cwd: launch.cwd,
      envKeys: Object.freeze(["CODEX_HOME", "TMPDIR"])
    })
  };
}

/** Real canary gate. Live spawn not performed here. */
export async function runDelegatedWriteCanary({
  authorizeRealCanary = false,
  plan = null,
  runner = null,
  oracleObservation = null
} = {}, deps = {}) {
  if (authorizeRealCanary !== true) {
    throw new DelegatedWriteOsSandboxError(
      "Real delegated-write canary requires explicit authorizeRealCanary: true.",
      { code: "delegated_write_canary_authorization_required", details: { planKind: plan?.kind ?? null } }
    );
  }

  await assertDelegatedWriteOsSandboxAvailable(deps);

  if (oracleObservation) {
    return judgeDelegatedWriteCanaryOracle(oracleObservation);
  }

  return {
    approval: false,
    verifiedEffective: false,
    verdict: DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE,
    reason: "authorized_but_live_spawn_not_run",
    details: {
      planKind: plan?.kind ?? null,
      command: runner?.command ?? null,
      auth: runner?.auth ?? null,
      note: "Operator must run the exact command under isolated auth; this API does not auto-spawn."
    }
  };
}
