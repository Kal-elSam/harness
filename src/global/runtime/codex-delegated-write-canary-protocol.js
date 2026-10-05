/**
 * Executable canary protocol prep — exact profile, disposable paths, capture
 * checklist. Does not spawn, copy credentials, or set verifiedEffective.
 */

import { writeFile } from "node:fs/promises";
import { buildDelegatedWriteSandboxProfile } from "./codex-delegated-sandbox.js";
import { prepareDelegatedWriteCanaryRunner } from "./codex-delegated-write-canary.js";

const ATTEMPT_OBSERVATION_SHAPE = Object.freeze({
  id: "string",
  kind: "internal|external",
  targetPath: "absolute disposable path",
  initialState: Object.freeze({ exists: "boolean", contentHash: "string|null", mtimeMs: "number|null" }),
  finalState: Object.freeze({ exists: "boolean", contentHash: "string|null", mtimeMs: "number|null" }),
  outcome: "written|denied|omitted|error",
  result: "string|null",
  stdout: "string (attempt-scoped)",
  events: "tool/process events linked to this attempt",
  toolError: "optional { code, message } attached to attempt",
  processError: "optional { code, message } attached to attempt"
});

/**
 * Build the full offline protocol a future authorized operator can execute.
 * Writes the SBPL profile to profilePath when writeProfile is true (default).
 */
export async function prepareDelegatedWriteCanaryProtocol({
  workspaceRoot,
  providerHome,
  tempRoot,
  profilePath,
  model,
  forbiddenExtra = [],
  runtime = null,
  writeProfile = true,
  writeFileImpl = writeFile
} = {}, deps = {}) {
  const runner = await prepareDelegatedWriteCanaryRunner({
    workspaceRoot,
    providerHome,
    tempRoot,
    profilePath,
    model,
    forbiddenExtra,
    runtime
  }, deps);

  const profileBody = await buildDelegatedWriteSandboxProfile({
    workspaceRoot: runner.plan.workspaceRoot,
    providerHome: runner.plan.providerHome,
    tempRoot: runner.plan.tempRoot,
    forbiddenExtra,
    runtime: runner.runtime
  }, deps);

  if (writeProfile) {
    await writeFileImpl(profilePath, profileBody, "utf8");
  }

  return Object.freeze({
    kind: "delegated_write_canary_protocol",
    verifiedEffective: false,
    approval: false,
    realRunAuthorized: false,
    model: runner.model,
    note:
      "Oracle consumes captured evidence only. This protocol does not prove real "
      + "containment and must not flip verifiedEffective.",
    profile: Object.freeze({
      path: profilePath,
      body: profileBody
    }),
    paths: Object.freeze({
      workspaceRoot: runner.plan.workspaceRoot,
      providerHome: runner.plan.providerHome,
      tempRoot: runner.plan.tempRoot,
      internalTarget: runner.plan.requiredInternalWrites[0],
      externalTarget: runner.plan.requiredExternalProbes[0],
      disposableOnly: true,
      personalCodexForbidden: true,
      codexExecutable: runner.runtime?.executable ?? null,
      runtimeReadPaths: runner.runtime?.runtimeReadPaths ?? null
    }),
    command: runner.command,
    task: runner.plan.task,
    launch: runner.launch,
    runtime: runner.runtime,
    auth: runner.auth,
    capture: Object.freeze({
      beforeRun: Object.freeze([
        "Record initialState for every attempt target (exists, contentHash or mtimeMs)",
        "Ensure disposable trees exist; profile file written at profile.path",
        "Confirm CODEX_HOME/TMPDIR point at isolated roots (never ~/.codex)"
      ]),
      duringRun: Object.freeze([
        "Capture full process stdout/stderr",
        "Capture NDJSON/tool events with path/command linkage to each attempt",
        "Do not invent denial from agent prose or generic 'sandbox' text"
      ]),
      afterRun: Object.freeze([
        "Record finalState for every attempt target",
        "Attach toolError/processError or linked tool_error events for external denials",
        "Set executed:true only if the wrapped process actually ran",
        "Pass { attempts, executed, stdout, events, launchError } to judgeDelegatedWriteCanaryOracle"
      ]),
      attemptObservationShape: ATTEMPT_OBSERVATION_SHAPE
    }),
    oracle: Object.freeze({
      entry: "judgeDelegatedWriteCanaryOracle",
      verdicts: Object.freeze(["contained", "breach", "inconclusive"]),
      neverApproval: true,
      neverVerifiedEffective: true
    })
  });
}
