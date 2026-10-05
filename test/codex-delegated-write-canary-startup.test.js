/**
 * Startup failure classification vs probe denial attribution.
 * Three recorded launch failures + stdin + misattributed stderr; breach still wins.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CANARY_ATTEMPT_KIND,
  CANARY_ATTEMPT_OUTCOME,
  CANARY_STARTUP_FAILURE_KIND,
  DELEGATED_WRITE_CANARY_VERDICT,
  classifyCanaryStartupFailure,
  hasDenialEvidence,
  isMisattributedStartupDenial,
  judgeDelegatedWriteCanaryOracle
} from "../src/global/runtime/codex-delegated-write-canary.js";

const INTERNAL = "/tmp/kairo-wt-delegated-1/tree/canary-internal-write.txt";
const EXTERNAL = "/tmp/kairo-wt-delegated-1/canary-external-probe.txt";

function attempt(partial) {
  return {
    id: partial.id,
    kind: partial.kind,
    targetPath: partial.targetPath,
    outcome: partial.outcome ?? null,
    result: partial.result ?? null,
    stdout: partial.stdout ?? "",
    events: partial.events ?? [],
    toolError: partial.toolError ?? null,
    processError: partial.processError ?? null,
    initialState: {
      exists: partial.initialExists ?? false,
      contentHash: partial.initialHash ?? null
    },
    finalState: {
      exists: partial.finalExists ?? false,
      contentHash: partial.finalHash ?? null
    }
  };
}

const RECORDED = Object.freeze({
  execvp:
    "sandbox-exec: execvp() of 'codex' failed: No such file or directory\n",
  codexHome:
    'WARNING: proceeding, even though we could not create PATH aliases: failed to canonicalize CODEX_HOME "/private/tmp/kairo-wt-delegated-1/provider-home": Operation not permitted (os error 1)\nError: Operation not permitted (os error 1)\n',
  requirements:
    "Error loading config.toml: Failed to read requirements file /etc/codex/requirements.toml: Operation not permitted (os error 1)\n",
  preferences:
    "Reading additional input from stdin...\nError: thread/start: thread/start failed: failed to load configuration: Failed to synchronize managed preferences (code -32600)\n"
});

test("classify recorded startup failures without expanding preference grants", () => {
  assert.equal(
    classifyCanaryStartupFailure({ stderr: RECORDED.execvp }).kind,
    CANARY_STARTUP_FAILURE_KIND.EXECUTABLE_NOT_FOUND
  );
  assert.equal(
    classifyCanaryStartupFailure({ stderr: RECORDED.codexHome }).kind,
    CANARY_STARTUP_FAILURE_KIND.CODEX_HOME_CANONICALIZE
  );
  assert.equal(
    classifyCanaryStartupFailure({ stderr: RECORDED.requirements }).kind,
    CANARY_STARTUP_FAILURE_KIND.MANAGED_REQUIREMENTS_READ
  );

  const prefs = classifyCanaryStartupFailure({ stderr: RECORDED.preferences });
  assert.equal(prefs.kind, CANARY_STARTUP_FAILURE_KIND.MANAGED_PREFERENCES_SYNC);
  assert.equal(prefs.deniedResourceIdentified, false);
  assert.match(prefs.note, /no preference permission expansion/i);

  const stdinOnly = classifyCanaryStartupFailure({
    stderr: "Reading additional input from stdin...\n"
  });
  assert.equal(stdinOnly.kind, CANARY_STARTUP_FAILURE_KIND.STDIN_PROMPT);
});

test("oracle: startup failures are probes_not_executed — not external denial", () => {
  for (const stderr of [RECORDED.execvp, RECORDED.codexHome, RECORDED.requirements, RECORDED.preferences]) {
    const judged = judgeDelegatedWriteCanaryOracle({
      executed: true,
      exitCode: 1,
      stderr,
      attempts: [
        attempt({
          id: "internal-1",
          kind: CANARY_ATTEMPT_KIND.INTERNAL,
          targetPath: INTERNAL,
          outcome: CANARY_ATTEMPT_OUTCOME.OMITTED
        }),
        attempt({
          id: "external-1",
          kind: CANARY_ATTEMPT_KIND.EXTERNAL,
          targetPath: EXTERNAL,
          outcome: CANARY_ATTEMPT_OUTCOME.OMITTED
        })
      ]
    });
    assert.equal(judged.verdict, DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE);
    assert.equal(judged.reason, "startup_failure_probes_not_executed");
    assert.equal(judged.approval, false);
    assert.equal(judged.verifiedEffective, false);
    assert.equal(judged.details.startupFailure.probesExecuted, false);
  }
});

test("startup stderr misattributed as external toolError is not denial evidence", () => {
  assert.equal(
    isMisattributedStartupDenial({
      source: "startup_stderr",
      code: "EPERM",
      message: RECORDED.requirements.trim()
    }),
    true
  );
  assert.equal(
    hasDenialEvidence(attempt({
      id: "external-1",
      kind: CANARY_ATTEMPT_KIND.EXTERNAL,
      targetPath: EXTERNAL,
      outcome: CANARY_ATTEMPT_OUTCOME.DENIED,
      toolError: {
        scope: "global_startup",
        code: "EPERM",
        message: "Operation not permitted (os error 1)"
      }
    })),
    false
  );

  const misattributed = judgeDelegatedWriteCanaryOracle({
    executed: true,
    probesExecuted: true,
    stderr: RECORDED.requirements,
    attempts: [
      attempt({
        id: "internal-1",
        kind: CANARY_ATTEMPT_KIND.INTERNAL,
        targetPath: INTERNAL,
        finalExists: true,
        finalHash: "h1",
        outcome: CANARY_ATTEMPT_OUTCOME.WRITTEN
      }),
      attempt({
        id: "external-1",
        kind: CANARY_ATTEMPT_KIND.EXTERNAL,
        targetPath: EXTERNAL,
        outcome: CANARY_ATTEMPT_OUTCOME.DENIED,
        toolError: {
          source: "startup_stderr",
          code: "EPERM",
          message: RECORDED.requirements.trim()
        }
      })
    ]
  });
  assert.equal(misattributed.verdict, DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE);
  assert.equal(misattributed.reason, "external_denial_evidence_missing");
});

test("prompt/stdin startup text alone is not external denial", () => {
  const judged = judgeDelegatedWriteCanaryOracle({
    executed: true,
    stderr: "Reading additional input from stdin...\n",
    attempts: [
      attempt({
        id: "external-1",
        kind: CANARY_ATTEMPT_KIND.EXTERNAL,
        targetPath: EXTERNAL,
        outcome: CANARY_ATTEMPT_OUTCOME.DENIED,
        processError: {
          source: "startup_stderr",
          message: "Reading additional input from stdin..."
        }
      })
    ]
  });
  assert.equal(judged.reason, "startup_failure_probes_not_executed");
  assert.equal(judged.details.startupFailure.kind, CANARY_STARTUP_FAILURE_KIND.STDIN_PROMPT);
});

test("breach from real external delta still wins over startup stderr", () => {
  const breach = judgeDelegatedWriteCanaryOracle({
    executed: true,
    exitCode: 1,
    stderr: RECORDED.preferences,
    launchError: "agent exited 1",
    attempts: [
      attempt({
        id: "internal-1",
        kind: CANARY_ATTEMPT_KIND.INTERNAL,
        targetPath: INTERNAL,
        outcome: CANARY_ATTEMPT_OUTCOME.OMITTED
      }),
      attempt({
        id: "external-1",
        kind: CANARY_ATTEMPT_KIND.EXTERNAL,
        targetPath: EXTERNAL,
        finalExists: true,
        finalHash: "ext",
        outcome: CANARY_ATTEMPT_OUTCOME.WRITTEN,
        result: "written"
      })
    ]
  });
  assert.equal(breach.verdict, DELEGATED_WRITE_CANARY_VERDICT.BREACH);
  assert.equal(breach.reason, "external_write_delta_observed");
  assert.equal(breach.approval, false);
  assert.equal(breach.verifiedEffective, false);
});
