import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { buildExplainReport } from "../src/global/explain.js";
import { buildStatusReport } from "../src/global/status.js";
import { resolveConsentAudit, writePolicyFile } from "../src/global/policy.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");
const baseOptions = {
  packageRoot,
  packageName: "@kal-elsam/harness",
  cliVersion: "0.20.0"
};

async function createFakeHome() {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-policy-visibility-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });
  return homeDir;
}

function runHarness(args, homeDir) {
  return spawnSync(process.execPath, [harnessBin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir }
  });
}

test("status reports policy defaults without a policy file", async () => {
  const homeDir = await createFakeHome();
  const report = await buildStatusReport(homeDir, { packageRoot });

  assert.equal(report.policy.source, "none");
  assert.equal(report.policy.applyMode, "prompt");
  assert.equal(report.policy.profile, null);

  const cli = runHarness(["status"], homeDir);
  assert.match(cli.stdout, /Policy:/);
  assert.match(cli.stdout, /none \(defaults, no policy file\)/);
});

test("status --json includes stable policy field with defaults", async () => {
  const homeDir = await createFakeHome();
  const cli = runHarness(["status", "--json"], homeDir);
  const payload = JSON.parse(cli.stdout.trim());

  assert.equal(payload.policy.source, "none");
  assert.equal(payload.policy.applyMode, "prompt");
  assert.deepEqual(payload.policy.components, ["orchestrator", "sdd-core"]);
});

test("status and explain report profile=ci when policy file exists", async () => {
  const homeDir = await createFakeHome();
  await writePolicyFile(homeDir, { profile: "ci" });

  const status = await buildStatusReport(homeDir, { packageRoot });
  assert.equal(status.policy.source, "file");
  assert.equal(status.policy.profile, "ci");

  const explain = await buildExplainReport(homeDir);
  assert.equal(explain.policy.profile, "ci");
  assert.match(explain.policy.path, /policy\.json$/);

  const statusCli = runHarness(["status"], homeDir);
  assert.match(statusCli.stdout, /Profile: ci/);

  const explainCli = runHarness(["explain"], homeDir);
  assert.match(explainCli.stdout, /Profile: ci/);
  assert.match(explainCli.stdout, /policy\.json/);
});

test("sync with policy ci shows preflight consent source policy", async () => {
  const homeDir = await createFakeHome();
  await writePolicyFile(homeDir, { profile: "ci" });
  await installGlobalHarness({ ...baseOptions, homeDir, agents: ["cursor"] });

  const assetPath = join(
    harnessHomePaths(homeDir).root,
    "components",
    "sdd-core",
    "workflow.md"
  );
  await unlink(assetPath);

  const cli = runHarness(["sync"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Harness preflight — sync/);
  assert.match(cli.stdout, /Consent source: policy/);
  assert.match(cli.stdout, /Policy profile: ci/);
});

test("sync --yes with policy ci shows consent source cli", async () => {
  const homeDir = await createFakeHome();
  await writePolicyFile(homeDir, { profile: "ci" });
  await installGlobalHarness({ ...baseOptions, homeDir, agents: ["cursor"] });

  const assetPath = join(
    harnessHomePaths(homeDir).root,
    "components",
    "sdd-core",
    "workflow.md"
  );
  await unlink(assetPath);

  const cli = runHarness(["sync", "--yes"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Consent source: cli/);
  assert.match(cli.stdout, /Policy profile: ci/);
});

test("setup --confirm shows consent source cli", async () => {
  const homeDir = await createFakeHome();
  const cli = runHarness(["setup", "--confirm", "--agents", "cursor"], homeDir);

  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Harness preflight — setup/);
  assert.match(cli.stdout, /Consent source: cli/);
});

test("resolveConsentAudit maps explicit and policy consent", () => {
  assert.equal(
    resolveConsentAudit({
      applying: true,
      yesExplicit: true,
      rawPolicy: { profile: "ci" }
    }).consentSource,
    "cli"
  );

  assert.equal(
    resolveConsentAudit({
      applying: true,
      confirm: true,
      rawPolicy: { profile: "ci" }
    }).consentSource,
    "policy"
  );
});

test("sync --json stdout stays machine-readable only", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir, agents: ["cursor"] });

  const cli = runHarness(["sync", "--json"], homeDir);
  assert.doesNotThrow(() => JSON.parse(cli.stdout));
  assert.equal(cli.stdout.trim().startsWith("{"), true);
});
