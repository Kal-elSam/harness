/**
 * Contract: OS wrap for delegated Codex writes — isolated provider/temp roots,
 * OS availability gate before launch, canary plan with explicit allow/deny paths.
 * Real canary requires authorizeRealCanary: true (not run here).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import codex from "../src/global/runtime/execution-adapters/codex.js";
import {
  assertDelegatedWriteOsSandboxAvailable,
  assertIsolatedProviderHome,
  buildDelegatedWriteSandboxProfile,
  DelegatedWriteOsSandboxError,
  isDelegatedWriteOsSandboxSupported,
  prepareDelegatedWriteCanaryPlan,
  rewriteCodexArgsForOuterOsSandbox,
  runDelegatedWriteCanary,
  wrapCodexLaunchWithOsSandbox
} from "../src/global/runtime/codex-delegated-sandbox.js";

const WORKSPACE = "/tmp/kairo-wt-delegated-1/tree";
const ISOLATED_PROVIDER = "/tmp/kairo-wt-delegated-1/provider-home";
const ISOLATED_TEMP = "/tmp/kairo-wt-delegated-1/tmp";
const PERSONAL = "/Users/kal-el/.codex";

test("isDelegatedWriteOsSandboxSupported is false on non-macOS without probing", async () => {
  const supported = await isDelegatedWriteOsSandboxSupported({
    platform: "linux",
    access: async () => {
      throw new Error("must not be called");
    }
  });
  assert.equal(supported, false);
});

test("assertDelegatedWriteOsSandboxAvailable fails closed when sandbox-exec is missing", async () => {
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
});

test("assertIsolatedProviderHome rejects personal ~/.codex writes", () => {
  assert.throws(
    () => assertIsolatedProviderHome(PERSONAL, { personalCodexHome: PERSONAL }),
    (error) => error instanceof DelegatedWriteOsSandboxError
      && error.code === "delegated_write_personal_provider_home_forbidden"
  );
  assert.throws(
    () => assertIsolatedProviderHome(join(PERSONAL, "sessions"), {
      personalCodexHome: PERSONAL
    }),
    (error) => error.code === "delegated_write_personal_provider_home_forbidden"
  );
  assert.equal(
    assertIsolatedProviderHome(ISOLATED_PROVIDER, { personalCodexHome: PERSONAL }),
    ISOLATED_PROVIDER
  );
});

test("delegated write SBPL allows only workspace + isolated provider + isolated temp", async () => {
  const profile = await buildDelegatedWriteSandboxProfile(
    {
      workspaceRoot: WORKSPACE,
      providerHome: ISOLATED_PROVIDER,
      tempRoot: ISOLATED_TEMP
    },
    { realpath: async (p) => p, personalCodexHome: PERSONAL }
  );
  assert.match(profile, /\(deny default\)/);
  assert.match(profile, new RegExp(`\\(subpath "${WORKSPACE}"\\)`));
  assert.match(profile, new RegExp(`\\(subpath "${ISOLATED_PROVIDER}"\\)`));
  assert.match(profile, new RegExp(`\\(subpath "${ISOLATED_TEMP}"\\)`));
  assert.doesNotMatch(profile, /snapshotRoot/);
  const writeBlock = profile.split("(allow file-write*")[1];
  assert.doesNotMatch(writeBlock, /\/Users\/kal-el\/\.codex/);
  assert.doesNotMatch(writeBlock, /\(subpath "\/private\/tmp"\)/);
  assert.doesNotMatch(writeBlock, /\(subpath "\/private\/var\/folders"\)/);
  assert.doesNotMatch(writeBlock, /\(subpath "\/etc"\)/);
});

test("buildDelegatedWriteSandboxProfile refuses personal provider home", async () => {
  await assert.rejects(
    () => buildDelegatedWriteSandboxProfile(
      {
        workspaceRoot: WORKSPACE,
        providerHome: PERSONAL,
        tempRoot: ISOLATED_TEMP
      },
      { realpath: async (p) => p, personalCodexHome: PERSONAL }
    ),
    (error) => error.code === "delegated_write_personal_provider_home_forbidden"
  );
});

test("rewriteCodexArgsForOuterOsSandbox drops provider sandbox flags and forces bypass", () => {
  assert.deepEqual(
    rewriteCodexArgsForOuterOsSandbox([
      "exec", "--json", "--approve-for-me", "Implement plan"
    ]),
    ["exec", "--dangerously-bypass-approvals-and-sandbox", "--json", "Implement plan"]
  );
});

test("wrapCodexLaunchWithOsSandbox requires OS availability and sets isolated env", async () => {
  const launch = codex.buildLaunch({
    task: "Implement plan",
    cwd: WORKSPACE,
    permissions: []
  });
  await assert.rejects(
    () => wrapCodexLaunchWithOsSandbox(launch, {
      profilePath: "/tmp/kairo-wt-delegated-1/profile.sb",
      providerHome: ISOLATED_PROVIDER,
      tempRoot: ISOLATED_TEMP
    }, { platform: "linux" }),
    (error) => error.code === "delegated_write_os_sandbox_unavailable"
  );

  const wrapped = await wrapCodexLaunchWithOsSandbox(launch, {
    profilePath: "/tmp/kairo-wt-delegated-1/profile.sb",
    providerHome: ISOLATED_PROVIDER,
    tempRoot: ISOLATED_TEMP
  }, {
    platform: "darwin",
    access: async () => {},
    personalCodexHome: PERSONAL
  });
  assert.equal(wrapped.command, "sandbox-exec");
  assert.equal(wrapped.env.CODEX_HOME, ISOLATED_PROVIDER);
  assert.equal(wrapped.env.TMPDIR, ISOLATED_TEMP);
  assert.ok(wrapped.args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.equal(wrapped.args.includes("--approve-for-me"), false);
});

test("canary plan lists explicit allowed and forbidden paths; real run needs authorization", async () => {
  const plan = prepareDelegatedWriteCanaryPlan({
    workspaceRoot: WORKSPACE,
    providerHome: ISOLATED_PROVIDER,
    tempRoot: ISOLATED_TEMP,
    forbiddenExtra: ["/Users/someone/other-repo/secret.txt"]
  }, { personalCodexHome: PERSONAL });

  assert.deepEqual(plan.allowedWritePaths, [WORKSPACE, ISOLATED_PROVIDER, ISOLATED_TEMP]);
  assert.ok(plan.forbiddenWritePaths.includes(PERSONAL));
  assert.ok(plan.forbiddenWritePaths.includes(join(PERSONAL, "config.toml")));
  assert.ok(plan.forbiddenWritePaths.includes("/Users/someone/other-repo/secret.txt"));
  assert.equal(plan.realRunAuthorized, false);
  assert.equal(plan.env.CODEX_HOME, ISOLATED_PROVIDER);
  assert.equal(plan.env.TMPDIR, ISOLATED_TEMP);

  await assert.rejects(
    () => runDelegatedWriteCanary({ authorizeRealCanary: false, plan }),
    (error) => error.code === "delegated_write_canary_authorization_required"
  );
  await assert.rejects(
    () => runDelegatedWriteCanary({
      authorizeRealCanary: true,
      plan
    }, {
      platform: "darwin",
      access: async () => {}
    }),
    (error) => error.code === "delegated_write_canary_not_implemented"
  );
});
