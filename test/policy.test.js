import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  applyPolicyToOptions,
  buildPolicyJson,
  getPolicyPath,
  loadPolicyFile,
  resetPolicyFile,
  resolvePolicy,
  savePolicyField,
  writePolicyFile
} from "../src/global/policy.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { runHarnessSetup } from "../src/global/setup.js";
import { runHarnessSync } from "../src/global/sync.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");
const baseOptions = {
  packageRoot,
  packageName: "@kal-elsam/harness",
  cliVersion: "0.18.0"
};

async function createFakeHome() {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-policy-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });
  return homeDir;
}

function runHarness(args, homeDir, { input = null } = {}) {
  return spawnSync(process.execPath, [harnessBin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir },
    input
  });
}

function baseCliOptions(overrides = {}) {
  return {
    cwd: packageRoot,
    preflight: true,
    preflightExplicit: false,
    yes: false,
    yesExplicit: false,
    confirm: false,
    confirmExplicit: false,
    adapters: null,
    adaptersExplicit: false,
    components: null,
    componentsExplicit: false,
    noDefaultComponents: false,
    allAdapters: false,
    ...overrides
  };
}

test("resolvePolicy expands profiles and defaults", () => {
  assert.deepEqual(resolvePolicy({ profile: "safe" }), {
    profile: "safe",
    applyMode: "prompt",
    preflight: true,
    agents: "detected",
    components: ["orchestrator", "sdd-core"]
  });

  assert.deepEqual(resolvePolicy({ profile: "ci" }).applyMode, "confirm");
  assert.deepEqual(resolvePolicy({ profile: "fast" }).applyMode, "confirm");
});

test("applyPolicyToOptions is a no-op without a policy file", () => {
  const options = baseCliOptions();
  assert.deepEqual(applyPolicyToOptions(options, null), options);
});

test("applyPolicyToOptions maps ci profile to confirm without touching explicit CLI flags", () => {
  const merged = applyPolicyToOptions(baseCliOptions(), { profile: "ci" });
  assert.equal(merged.confirm, true);
  assert.equal(merged.preflight, true);

  const overridden = applyPolicyToOptions(
    baseCliOptions({ confirmExplicit: true, confirm: false }),
    { profile: "ci" }
  );
  assert.equal(overridden.confirm, false);
});

test("CLI flags override policy agents and preflight", () => {
  const merged = applyPolicyToOptions(
    baseCliOptions({
      adapters: ["cursor"],
      adaptersExplicit: true,
      preflightExplicit: true,
      preflight: false
    }),
    { profile: "ci", agents: "all", preflight: true }
  );

  assert.deepEqual(merged.adapters, ["cursor"]);
  assert.equal(merged.preflight, false);
  assert.equal(merged.confirm, true);
});

test("buildPolicyJson has a stable shape", async () => {
  const homeDir = await createFakeHome();
  const shape = buildPolicyJson(homeDir, null);

  assert.deepEqual(Object.keys(shape).sort(), [
    "agents",
    "applyMode",
    "components",
    "path",
    "preflight",
    "profile",
    "source"
  ]);
  assert.equal(shape.source, "defaults");
  assert.equal(shape.applyMode, "prompt");
  assert.equal(shape.path, getPolicyPath(homeDir));
});

test("policy --json reports defaults without a file", async () => {
  const homeDir = await createFakeHome();
  const cli = runHarness(["policy", "--json"], homeDir);

  assert.equal(cli.status, 0);
  const payload = JSON.parse(cli.stdout.trim());
  assert.equal(payload.source, "defaults");
  assert.equal(payload.applyMode, "prompt");
});

test("policy set and reset persist under ~/.harness/policy.json", async () => {
  const homeDir = await createFakeHome();

  const setCli = runHarness(["policy", "set", "profile", "ci"], homeDir);
  assert.equal(setCli.status, 0);
  assert.match(setCli.stdout, /Policy updated: profile=ci/);

  const policyPath = getPolicyPath(homeDir);
  assert.equal(existsSync(policyPath), true);
  assert.deepEqual(JSON.parse(await readFile(policyPath, "utf8")), { profile: "ci" });

  const { statePath } = harnessHomePaths(homeDir);
  await writeFile(statePath, JSON.stringify({ cliVersion: "0.18.0" }), "utf8");
  assert.equal(existsSync(statePath), true);

  const resetCli = runHarness(["policy", "reset"], homeDir);
  assert.equal(resetCli.status, 0);
  assert.match(resetCli.stdout, /Policy reset/);
  assert.equal(existsSync(policyPath), false);
  assert.equal(existsSync(statePath), true);
});

test("without policy non-interactive sync still requires explicit consent", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({
    ...baseOptions,
    homeDir,
    agents: ["cursor"],
    dryRun: false
  });

  const assetPath = join(
    harnessHomePaths(homeDir).root,
    "components",
    "sdd-core",
    "workflow.md"
  );
  await unlink(assetPath);

  const cli = runHarness(["sync"], homeDir);
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /Non-interactive sync requires --yes, --confirm, or --no-preflight/);
});

test("policy safe prompts in interactive apply mode", async () => {
  const homeDir = await createFakeHome();
  await writePolicyFile(homeDir, { profile: "safe" });

  let prompted = false;
  const policyOptions = applyPolicyToOptions(
    baseCliOptions({ adapters: ["cursor"], adaptersExplicit: true }),
    { profile: "safe" }
  );

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    agents: policyOptions.adapters,
    confirm: policyOptions.confirm,
    preflight: policyOptions.preflight,
    interactive: true,
    createPrompt: () => {
      prompted = true;
      const prompt = async () => "no";
      prompt.close = async () => {};
      return prompt;
    }
  });

  assert.equal(prompted, true);
  assert.equal(outcome.cancelled, true);
});

test("policy ci allows non-interactive sync with preflight", async () => {
  const homeDir = await createFakeHome();
  await writePolicyFile(homeDir, { profile: "ci" });
  await installGlobalHarness({
    ...baseOptions,
    homeDir,
    agents: ["cursor"],
    dryRun: false
  });

  const assetPath = join(
    harnessHomePaths(homeDir).root,
    "components",
    "sdd-core",
    "workflow.md"
  );
  await unlink(assetPath);

  const policyOptions = applyPolicyToOptions(baseCliOptions(), { profile: "ci" });
  const outcome = await runHarnessSync({
    ...baseOptions,
    homeDir,
    confirm: policyOptions.confirm,
    preflight: policyOptions.preflight,
    interactive: false
  });

  assert.equal(outcome.action, "repaired");
});

test("policy fast applies like confirm without interactive prompt", async () => {
  const homeDir = await createFakeHome();
  await writePolicyFile(homeDir, { profile: "fast" });

  const cli = runHarness(["setup", "--agents", "cursor"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Harness preflight — setup/);
  assert.doesNotMatch(cli.stderr, /Non-interactive setup requires/);
});

test("policy set rejects unknown keys", async () => {
  const homeDir = await createFakeHome();
  const cli = runHarness(["policy", "set", "unknown", "value"], homeDir);
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /Unknown policy key/);
});

test("savePolicyField writes valid policy values", async () => {
  const homeDir = await createFakeHome();
  const resolved = await savePolicyField(homeDir, "agents", "cursor,codex");

  assert.deepEqual(resolved.agents, ["cursor", "codex"]);
  assert.deepEqual(await loadPolicyFile(homeDir), { agents: ["cursor", "codex"] });
});

test("resetPolicyFile returns false when file is missing", async () => {
  const homeDir = await createFakeHome();
  assert.equal(await resetPolicyFile(homeDir), false);
});
