/**
 * Offline contract: canonical roots, no personal alias, no broad roots,
 * sandbox absence fails closed (no fallback), oracle never approves.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import codex from "../src/global/runtime/execution-adapters/codex.js";
import {
  assertDelegatedWriteOsSandboxAvailable,
  buildDelegatedWriteSandboxProfile,
  DelegatedWriteOsSandboxError,
  isDelegatedWriteOsSandboxSupported,
  rewriteCodexArgsForOuterOsSandbox,
  validateCanonicalDelegatedWriteRoots,
  wrapCodexLaunchWithOsSandbox
} from "../src/global/runtime/codex-delegated-sandbox.js";
import {
  CANARY_ATTEMPT_KIND,
  CANARY_ATTEMPT_OUTCOME,
  DELEGATED_WRITE_CANARY_VERDICT,
  describeIsolatedAuthHandling,
  ensureCodexWorkspaceCd,
  formatDelegatedWriteCanaryCommand,
  judgeDelegatedWriteCanaryOracle,
  prepareDelegatedWriteCanaryPlan,
  prepareDelegatedWriteCanaryRunner,
  runDelegatedWriteCanary
} from "../src/global/runtime/codex-delegated-write-canary.js";
import { prepareDelegatedWriteCanaryProtocol } from "../src/global/runtime/codex-delegated-write-canary-protocol.js";

const WORKSPACE = "/tmp/kairo-wt-delegated-1/tree";
const ISOLATED_PROVIDER = "/tmp/kairo-wt-delegated-1/provider-home";
const ISOLATED_TEMP = "/tmp/kairo-wt-delegated-1/tmp";
const PERSONAL = "/Users/kal-el/.codex";
const ALIAS_TO_PERSONAL = "/tmp/kairo-wt-delegated-1/alias-provider";
const EXTERNAL_PROBE = "/tmp/kairo-wt-delegated-1/canary-external-probe.txt";
const INTERNAL_MARKER = join(WORKSPACE, "canary-internal-write.txt");

function identityDeps(extra = {}) {
  return {
    realpath: async (p) => resolve(p),
    personalCodexHome: PERSONAL,
    homedir: () => "/Users/kal-el",
    platform: "darwin",
    access: async () => {},
    ...extra
  };
}

test("isDelegatedWriteOsSandboxSupported is false on non-macOS without probing", async () => {
  const supported = await isDelegatedWriteOsSandboxSupported({
    platform: "linux",
    access: async () => {
      throw new Error("must not be called");
    }
  });
  assert.equal(supported, false);
});

test("sandbox absent: availability assert fails closed with no fallback launch", async () => {
  await assert.rejects(
    () => assertDelegatedWriteOsSandboxAvailable({
      platform: "darwin",
      access: async () => {
        throw new Error("ENOENT");
      }
    }),
    (error) => error instanceof DelegatedWriteOsSandboxError
      && error.code === "delegated_write_os_sandbox_unavailable"
  );

  const launch = codex.buildLaunch({ task: "t", cwd: WORKSPACE, permissions: [] });
  await assert.rejects(
    () => wrapCodexLaunchWithOsSandbox(launch, {
      profilePath: "/tmp/kairo-wt-delegated-1/profile.sb",
      providerHome: ISOLATED_PROVIDER,
      tempRoot: ISOLATED_TEMP,
      workspaceRoot: WORKSPACE
    }, { platform: "linux", personalCodexHome: PERSONAL, realpath: async (p) => p }),
    (error) => error.code === "delegated_write_os_sandbox_unavailable"
  );
});

test("symlink alias toward personal ~/.codex is rejected before profile grants", async () => {
  const deps = identityDeps({
    realpath: async (p) => (resolve(p) === resolve(ALIAS_TO_PERSONAL) ? PERSONAL : resolve(p))
  });

  await assert.rejects(
    () => validateCanonicalDelegatedWriteRoots({
      workspaceRoot: WORKSPACE,
      providerHome: ALIAS_TO_PERSONAL,
      tempRoot: ISOLATED_TEMP
    }, deps),
    (error) => error.code === "delegated_write_personal_provider_home_forbidden"
  );

  await assert.rejects(
    () => buildDelegatedWriteSandboxProfile({
      workspaceRoot: WORKSPACE,
      providerHome: ALIAS_TO_PERSONAL,
      tempRoot: ISOLATED_TEMP
    }, deps),
    (error) => error.code === "delegated_write_personal_provider_home_forbidden"
  );
});

test("incompatible broad roots and forbidden overlaps are rejected", async () => {
  const deps = identityDeps();

  await assert.rejects(
    () => validateCanonicalDelegatedWriteRoots({
      workspaceRoot: "/tmp",
      providerHome: ISOLATED_PROVIDER,
      tempRoot: ISOLATED_TEMP
    }, deps),
    (error) => error.code === "delegated_write_broad_root_forbidden"
  );

  await assert.rejects(
    () => validateCanonicalDelegatedWriteRoots({
      workspaceRoot: "/tmp/kairo-parent",
      providerHome: ISOLATED_PROVIDER,
      tempRoot: ISOLATED_TEMP
    }, identityDeps({ personalCodexHome: "/tmp/kairo-parent/.codex" })),
    (error) => error.code === "delegated_write_forbidden_overlap"
  );

  await assert.rejects(
    () => validateCanonicalDelegatedWriteRoots({
      workspaceRoot: WORKSPACE,
      providerHome: ISOLATED_PROVIDER,
      tempRoot: ISOLATED_TEMP,
      forbiddenExtra: [join(WORKSPACE, "secret-should-not-be-allowed.txt")]
    }, deps),
    (error) => error.code === "delegated_write_forbidden_overlap"
  );
});

test("uncertain resolution refuses permissions (no literal-only fallback)", async () => {
  await assert.rejects(
    () => validateCanonicalDelegatedWriteRoots({
      workspaceRoot: WORKSPACE,
      providerHome: ISOLATED_PROVIDER,
      tempRoot: ISOLATED_TEMP
    }, {
      personalCodexHome: PERSONAL,
      realpath: async () => {
        throw new Error("ENOENT");
      }
    }),
    (error) => error.code === "delegated_write_root_resolution_uncertain"
  );
});

test("profile write allowlist uses canonical isolated roots only", async () => {
  const deps = identityDeps();
  const roots = await validateCanonicalDelegatedWriteRoots({
    workspaceRoot: WORKSPACE,
    providerHome: ISOLATED_PROVIDER,
    tempRoot: ISOLATED_TEMP
  }, deps);
  const profile = await buildDelegatedWriteSandboxProfile({
    workspaceRoot: WORKSPACE,
    providerHome: ISOLATED_PROVIDER,
    tempRoot: ISOLATED_TEMP
  }, deps);

  assert.match(profile, /\(deny default\)/);
  for (const allowed of roots.allowedWritePaths) {
    assert.match(profile, new RegExp(`\\(subpath "${allowed.replaceAll("/", "\\/")}"\\)`));
  }
  const writeBlock = profile.split("(allow file-write*")[1];
  assert.doesNotMatch(writeBlock, /\/Users\/kal-el\/\.codex/);
  assert.doesNotMatch(writeBlock, /\(subpath "\/private\/tmp"\)/);
  assert.doesNotMatch(writeBlock, /\(subpath "\/tmp"\)/);
});

test("rewriteCodexArgsForOuterOsSandbox forces bypass and drops approve-for-me", () => {
  assert.deepEqual(
    rewriteCodexArgsForOuterOsSandbox(["exec", "--json", "--approve-for-me", "Implement plan"]),
    ["exec", "--dangerously-bypass-approvals-and-sandbox", "--json", "Implement plan"]
  );
});

test("wrap uses absolute sandbox-exec path after canonical validation; never falls back to bare codex", async () => {
  const launch = codex.buildLaunch({ task: "Implement plan", cwd: WORKSPACE, permissions: [] });
  const wrapped = await wrapCodexLaunchWithOsSandbox(launch, {
    profilePath: "/tmp/kairo-wt-delegated-1/profile.sb",
    providerHome: ISOLATED_PROVIDER,
    tempRoot: ISOLATED_TEMP,
    workspaceRoot: WORKSPACE
  }, identityDeps());

  assert.equal(wrapped.command, "/usr/bin/sandbox-exec");
  assert.notEqual(wrapped.command, "sandbox-exec");
  assert.notEqual(wrapped.command, "codex");
  assert.equal(wrapped.env.CODEX_HOME, ISOLATED_PROVIDER);
  assert.equal(wrapped.env.TMPDIR, ISOLATED_TEMP);
  assert.deepEqual(wrapped.roots.allowedWritePaths, [
    WORKSPACE, ISOLATED_PROVIDER, ISOLATED_TEMP
  ]);
});

test("canonical roots reject SBPL metacharacters before profile grants", async () => {
  await assert.rejects(
    () => validateCanonicalDelegatedWriteRoots({
      workspaceRoot: `${WORKSPACE}/evil" )(allow file-write* (subpath "/`,
      providerHome: ISOLATED_PROVIDER,
      tempRoot: ISOLATED_TEMP
    }, identityDeps()),
    (error) => error instanceof DelegatedWriteOsSandboxError
      && error.code === "delegated_write_sbpl_path_unsafe"
  );
});

function attempt({
  id,
  kind,
  targetPath,
  initialExists = false,
  finalExists = false,
  initialHash = null,
  finalHash = null,
  outcome = null,
  stdout = "",
  events = [],
  result = null,
  toolError = null,
  processError = null
}) {
  return {
    id,
    kind,
    targetPath,
    outcome,
    result,
    stdout,
    events,
    toolError,
    processError,
    initialState: { exists: initialExists, contentHash: initialHash },
    finalState: { exists: finalExists, contentHash: finalHash }
  };
}

function linkedToolDenial(targetPath) {
  return {
    type: "tool_error",
    tool_name: "shell",
    code: "EPERM",
    path: targetPath,
    message: `Operation not permitted: ${targetPath}`,
    command: `echo probe > ${targetPath}`
  };
}

test("oracle: contained needs internal delta + linked tool/process denial; never approval", () => {
  const contained = judgeDelegatedWriteCanaryOracle({
    executed: true,
    stdout: "ok",
    events: [{ type: "turn.completed" }],
    attempts: [
      attempt({
        id: "internal-write",
        kind: CANARY_ATTEMPT_KIND.INTERNAL,
        targetPath: INTERNAL_MARKER,
        finalExists: true,
        finalHash: "h1",
        outcome: CANARY_ATTEMPT_OUTCOME.WRITTEN,
        result: "written",
        stdout: "wrote internal"
      }),
      attempt({
        id: "external-probe",
        kind: CANARY_ATTEMPT_KIND.EXTERNAL,
        targetPath: EXTERNAL_PROBE,
        outcome: CANARY_ATTEMPT_OUTCOME.DENIED,
        result: "denied",
        events: [linkedToolDenial(EXTERNAL_PROBE)]
      })
    ]
  });
  assert.equal(contained.verdict, DELEGATED_WRITE_CANARY_VERDICT.CONTAINED);
  assert.equal(contained.approval, false);
  assert.equal(contained.verifiedEffective, false);
  assert.equal(contained.attempts.length, 2);
  assert.equal(contained.stdout, "ok");
});

test("oracle: omitted external attempts are inconclusive (no false contained)", () => {
  const omitted = judgeDelegatedWriteCanaryOracle({
    executed: true,
    attempts: [
      attempt({
        id: "internal-write",
        kind: CANARY_ATTEMPT_KIND.INTERNAL,
        targetPath: INTERNAL_MARKER,
        finalExists: true,
        finalHash: "h1",
        outcome: CANARY_ATTEMPT_OUTCOME.WRITTEN
      }),
      attempt({
        id: "external-probe",
        kind: CANARY_ATTEMPT_KIND.EXTERNAL,
        targetPath: EXTERNAL_PROBE,
        outcome: CANARY_ATTEMPT_OUTCOME.OMITTED
      })
    ]
  });
  assert.equal(omitted.verdict, DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE);
  assert.equal(omitted.reason, "external_denial_evidence_missing");
  assert.equal(omitted.approval, false);
});

test("oracle: preexisting file without delta is not an internal write", () => {
  const preexisting = judgeDelegatedWriteCanaryOracle({
    executed: true,
    attempts: [
      attempt({
        id: "internal-write",
        kind: CANARY_ATTEMPT_KIND.INTERNAL,
        targetPath: INTERNAL_MARKER,
        initialExists: true,
        finalExists: true,
        initialHash: "same",
        finalHash: "same",
        outcome: CANARY_ATTEMPT_OUTCOME.WRITTEN
      }),
      attempt({
        id: "external-probe",
        kind: CANARY_ATTEMPT_KIND.EXTERNAL,
        targetPath: EXTERNAL_PROBE,
        toolError: { code: "EPERM", message: "Operation not permitted" }
      })
    ]
  });
  assert.equal(preexisting.verdict, DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE);
  assert.equal(preexisting.reason, "required_internal_write_delta_absent");
});

test("oracle negative: generic sandbox text is not denial evidence", () => {
  const sandboxText = judgeDelegatedWriteCanaryOracle({
    executed: true,
    attempts: [
      attempt({
        id: "internal-write",
        kind: CANARY_ATTEMPT_KIND.INTERNAL,
        targetPath: INTERNAL_MARKER,
        finalExists: true,
        finalHash: "h1",
        outcome: CANARY_ATTEMPT_OUTCOME.WRITTEN
      }),
      attempt({
        id: "external-probe",
        kind: CANARY_ATTEMPT_KIND.EXTERNAL,
        targetPath: EXTERNAL_PROBE,
        outcome: CANARY_ATTEMPT_OUTCOME.DENIED,
        stdout: "sandbox disabled; continuing without confinement"
      })
    ]
  });
  assert.equal(sandboxText.verdict, DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE);
  assert.equal(sandboxText.reason, "external_denial_evidence_missing");
});

test("oracle negative: agent self-report denied without tool/process attempt is inconclusive", () => {
  const selfReport = judgeDelegatedWriteCanaryOracle({
    executed: true,
    attempts: [
      attempt({
        id: "internal-write",
        kind: CANARY_ATTEMPT_KIND.INTERNAL,
        targetPath: INTERNAL_MARKER,
        finalExists: true,
        finalHash: "h1",
        outcome: CANARY_ATTEMPT_OUTCOME.WRITTEN
      }),
      attempt({
        id: "external-probe",
        kind: CANARY_ATTEMPT_KIND.EXTERNAL,
        targetPath: EXTERNAL_PROBE,
        outcome: CANARY_ATTEMPT_OUTCOME.DENIED,
        result: "denied",
        stdout: "I denied the external write",
        events: [{ type: "assistant", message: "denied" }]
      })
    ]
  });
  assert.equal(selfReport.verdict, DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE);
  assert.equal(selfReport.reason, "external_denial_evidence_missing");
  assert.equal(selfReport.approval, false);
});

test("oracle negative: executed false cannot be contained even with strong attempts", () => {
  const notExecuted = judgeDelegatedWriteCanaryOracle({
    executed: false,
    attempts: [
      attempt({
        id: "internal-write",
        kind: CANARY_ATTEMPT_KIND.INTERNAL,
        targetPath: INTERNAL_MARKER,
        finalExists: true,
        finalHash: "h1",
        outcome: CANARY_ATTEMPT_OUTCOME.WRITTEN
      }),
      attempt({
        id: "external-probe",
        kind: CANARY_ATTEMPT_KIND.EXTERNAL,
        targetPath: EXTERNAL_PROBE,
        events: [linkedToolDenial(EXTERNAL_PROBE)]
      })
    ]
  });
  assert.equal(notExecuted.verdict, DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE);
  assert.equal(notExecuted.reason, "execution_not_confirmed");
  assert.equal(notExecuted.approval, false);
});

test("oracle: external write delta is breach even if process later errors", () => {
  const breachThenError = judgeDelegatedWriteCanaryOracle({
    executed: true,
    launchError: "agent exited 1 after tools",
    stdout: "partial",
    events: [{ type: "item.completed" }, { type: "error" }],
    attempts: [
      attempt({
        id: "internal-write",
        kind: CANARY_ATTEMPT_KIND.INTERNAL,
        targetPath: INTERNAL_MARKER,
        finalExists: true,
        finalHash: "h1",
        outcome: CANARY_ATTEMPT_OUTCOME.WRITTEN,
        result: "written"
      }),
      attempt({
        id: "external-probe",
        kind: CANARY_ATTEMPT_KIND.EXTERNAL,
        targetPath: EXTERNAL_PROBE,
        finalExists: true,
        finalHash: "leak",
        outcome: CANARY_ATTEMPT_OUTCOME.WRITTEN,
        result: "written",
        stdout: "wrote external"
      })
    ]
  });
  assert.equal(breachThenError.verdict, DELEGATED_WRITE_CANARY_VERDICT.BREACH);
  assert.equal(breachThenError.reason, "external_write_delta_observed");
  assert.equal(breachThenError.details.launchError, "agent exited 1 after tools");
  assert.equal(breachThenError.approval, false);
  assert.equal(breachThenError.attempts[1].result, "written");
});

test("executable protocol pins profile/paths/capture and keeps verifiedEffective false", async () => {
  const written = [];
  const protocol = await prepareDelegatedWriteCanaryProtocol({
    workspaceRoot: WORKSPACE,
    providerHome: ISOLATED_PROVIDER,
    tempRoot: ISOLATED_TEMP,
    profilePath: "/tmp/kairo-wt-delegated-1/profile.sb",
    writeFileImpl: async (path, body) => {
      written.push({ path, body });
    }
  }, identityDeps());

  assert.equal(protocol.verifiedEffective, false);
  assert.equal(protocol.approval, false);
  assert.equal(protocol.realRunAuthorized, false);
  assert.equal(protocol.profile.path, "/tmp/kairo-wt-delegated-1/profile.sb");
  assert.match(protocol.profile.body, /\(deny default\)/);
  assert.equal(written.length, 1);
  assert.equal(protocol.paths.internalTarget, INTERNAL_MARKER);
  assert.equal(protocol.paths.externalTarget, EXTERNAL_PROBE);
  assert.equal(protocol.paths.personalCodexForbidden, true);
  assert.match(protocol.command, /^cd '/);
  assert.match(protocol.command, /'--cd'/);
  assert.ok(protocol.capture.beforeRun.length >= 1);
  assert.ok(protocol.capture.duringRun.length >= 1);
  assert.ok(protocol.capture.afterRun.length >= 1);
  assert.equal(protocol.oracle.neverVerifiedEffective, true);
});

test("exported command pins workspace via cd and --cd; attempts are disposable only", async () => {
  const runner = await prepareDelegatedWriteCanaryRunner({
    workspaceRoot: WORKSPACE,
    providerHome: ISOLATED_PROVIDER,
    tempRoot: ISOLATED_TEMP,
    profilePath: "/tmp/kairo-wt-delegated-1/profile.sb"
  }, identityDeps());

  assert.match(runner.command, new RegExp(`^cd '${WORKSPACE}' &&`));
  assert.match(runner.command, /'--cd' '/);
  assert.match(runner.command, new RegExp(`'--cd' '${WORKSPACE}'`));
  assert.equal(runner.launch.cwd, WORKSPACE);
  assert.deepEqual(
    ensureCodexWorkspaceCd(["exec", "--json", "t"], WORKSPACE).slice(0, 4),
    ["exec", "--cd", WORKSPACE, "--json"]
  );

  // Effective even if a caller started elsewhere: spawnShape.cwd is workspace.
  assert.equal(runner.spawnShape.cwd, WORKSPACE);
  assert.notEqual(runner.spawnShape.cwd, process.cwd());

  assert.equal(runner.plan.attempts[0].targetPath, INTERNAL_MARKER);
  assert.equal(runner.plan.attempts[1].targetPath, EXTERNAL_PROBE);
  assert.match(runner.plan.task, /Do not touch personal/);
  assert.ok(runner.plan.attempts.every((entry) => !entry.targetPath.includes("/.codex")));

  const auth = describeIsolatedAuthHandling(runner.plan);
  assert.ok(auth.forbidden.some((entry) => entry.includes("copying credentials")));
  assert.equal(formatDelegatedWriteCanaryCommand(runner.launch), runner.command);

  await assert.rejects(
    () => runDelegatedWriteCanary({ authorizeRealCanary: false, plan: runner.plan }),
    (error) => error.code === "delegated_write_canary_authorization_required"
  );

  const authorizedPrep = await runDelegatedWriteCanary({
    authorizeRealCanary: true,
    plan: runner.plan,
    runner
  }, identityDeps());
  assert.equal(authorizedPrep.verdict, DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE);
  assert.equal(authorizedPrep.approval, false);
  assert.equal(authorizedPrep.details.command, runner.command);

  const plan = await prepareDelegatedWriteCanaryPlan({
    workspaceRoot: WORKSPACE,
    providerHome: ISOLATED_PROVIDER,
    tempRoot: ISOLATED_TEMP
  }, identityDeps());
  assert.deepEqual(plan.requiredExternalProbes, [EXTERNAL_PROBE]);
  assert.ok(plan.forbiddenWritePaths.includes(PERSONAL));
});
