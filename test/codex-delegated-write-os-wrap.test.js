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
  DELEGATED_WRITE_CANARY_VERDICT,
  describeIsolatedAuthHandling,
  formatDelegatedWriteCanaryCommand,
  judgeDelegatedWriteCanaryOracle,
  prepareDelegatedWriteCanaryPlan,
  prepareDelegatedWriteCanaryRunner,
  runDelegatedWriteCanary
} from "../src/global/runtime/codex-delegated-write-canary.js";

const WORKSPACE = "/tmp/kairo-wt-delegated-1/tree";
const ISOLATED_PROVIDER = "/tmp/kairo-wt-delegated-1/provider-home";
const ISOLATED_TEMP = "/tmp/kairo-wt-delegated-1/tmp";
const PERSONAL = "/Users/kal-el/.codex";
const ALIAS_TO_PERSONAL = "/tmp/kairo-wt-delegated-1/alias-provider";

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

test("wrap sets isolated env after canonical validation; never falls back to bare codex", async () => {
  const launch = codex.buildLaunch({ task: "Implement plan", cwd: WORKSPACE, permissions: [] });
  const wrapped = await wrapCodexLaunchWithOsSandbox(launch, {
    profilePath: "/tmp/kairo-wt-delegated-1/profile.sb",
    providerHome: ISOLATED_PROVIDER,
    tempRoot: ISOLATED_TEMP,
    workspaceRoot: WORKSPACE
  }, identityDeps());

  assert.equal(wrapped.command, "sandbox-exec");
  assert.notEqual(wrapped.command, "codex");
  assert.equal(wrapped.env.CODEX_HOME, ISOLATED_PROVIDER);
  assert.equal(wrapped.env.TMPDIR, ISOLATED_TEMP);
  assert.deepEqual(wrapped.roots.allowedWritePaths, [
    WORKSPACE, ISOLATED_PROVIDER, ISOLATED_TEMP
  ]);
});

test("oracle: contained vs breach vs inconclusive; never approval", async () => {
  const internal = join(WORKSPACE, "canary-internal-write.txt");
  const external = join(PERSONAL, "config.toml");

  const contained = await judgeDelegatedWriteCanaryOracle({
    requiredInternalWrites: [internal],
    forbiddenWrites: [external],
    executed: true,
    pathExists: (p) => p === internal
  });
  assert.equal(contained.verdict, DELEGATED_WRITE_CANARY_VERDICT.CONTAINED);
  assert.equal(contained.approval, false);
  assert.equal(contained.verifiedEffective, false);

  const breach = await judgeDelegatedWriteCanaryOracle({
    requiredInternalWrites: [internal],
    forbiddenWrites: [external],
    executed: true,
    pathExists: (p) => p === internal || p === external
  });
  assert.equal(breach.verdict, DELEGATED_WRITE_CANARY_VERDICT.BREACH);
  assert.equal(breach.approval, false);

  const missingInternal = await judgeDelegatedWriteCanaryOracle({
    requiredInternalWrites: [internal],
    forbiddenWrites: [external],
    executed: true,
    pathExists: () => false
  });
  assert.equal(missingInternal.verdict, DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE);
  assert.equal(missingInternal.reason, "required_internal_write_absent");
  assert.equal(missingInternal.approval, false);

  const launchFail = await judgeDelegatedWriteCanaryOracle({
    requiredInternalWrites: [internal],
    forbiddenWrites: [external],
    executed: false,
    launchError: "spawn EACCES"
  });
  assert.equal(launchFail.verdict, DELEGATED_WRITE_CANARY_VERDICT.INCONCLUSIVE);
  assert.equal(launchFail.reason, "launch_error");
  assert.equal(launchFail.approval, false);
});

test("runner reuses adapter launch, emits exact command + isolated auth; real run gated", async () => {
  const runner = await prepareDelegatedWriteCanaryRunner({
    workspaceRoot: WORKSPACE,
    providerHome: ISOLATED_PROVIDER,
    tempRoot: ISOLATED_TEMP,
    profilePath: "/tmp/kairo-wt-delegated-1/profile.sb",
    task: "Write canary-internal-write.txt inside the workspace only."
  }, identityDeps());

  assert.equal(runner.launch.command, "sandbox-exec");
  assert.match(runner.command, /^CODEX_HOME=/);
  assert.match(runner.command, / TMPDIR=/);
  assert.match(runner.command, /'sandbox-exec'/);
  assert.match(runner.command, /--dangerously-bypass-approvals-and-sandbox/);
  assert.equal(runner.plan.realRunAuthorized, false);
  assert.ok(runner.plan.requiredInternalWrites[0].endsWith("canary-internal-write.txt"));

  const auth = describeIsolatedAuthHandling(runner.plan);
  assert.equal(auth.codexHome, ISOLATED_PROVIDER);
  assert.ok(auth.forbidden.some((entry) => entry.includes("CODEX_HOME=~/.codex")));

  const exact = formatDelegatedWriteCanaryCommand(runner.launch);
  assert.equal(exact, runner.command);

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
  assert.equal(authorizedPrep.reason, "authorized_but_live_spawn_not_run");
  assert.equal(authorizedPrep.details.command, runner.command);

  const plan = await prepareDelegatedWriteCanaryPlan({
    workspaceRoot: WORKSPACE,
    providerHome: ISOLATED_PROVIDER,
    tempRoot: ISOLATED_TEMP
  }, identityDeps());
  assert.deepEqual(plan.allowedWritePaths, [WORKSPACE, ISOLATED_PROVIDER, ISOLATED_TEMP]);
  assert.ok(plan.forbiddenWritePaths.includes(PERSONAL));
});
