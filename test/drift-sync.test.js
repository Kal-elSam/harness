import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installGlobalHarness, syncGlobalHarness, updateGlobalHarness } from "../src/global/global-installer.js";
import { runGlobalDoctorChecks } from "../src/global/global-doctor.js";
import { userOwnedContent } from "../src/global/managed-section.js";
import { readGlobalState } from "../src/global/state.js";
import { harnessHomePaths } from "../src/global/paths.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseOptions = { packageRoot, packageName: "@kal-elsam/harness", cliVersion: "0.6.0" };

async function createFakeHome({ withUserContent = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-drift-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withUserContent) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# User rules\n\nkeep this\n");
  }

  return homeDir;
}

test("doctor detects missing component asset", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });
  await rm(join(harnessHomePaths(homeDir).root, "components", "sdd-core", "workflow.md"));

  const { checks, ok, hasDrift } = await runGlobalDoctorChecks(homeDir, { packageRoot });

  assert.equal(ok, false);
  assert.equal(hasDrift, true);
  assert.equal(
    checks.find((check) => check.name === "~/.harness/components/sdd-core/workflow.md").status,
    "missing"
  );
});

test("doctor detects stale component asset hash", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const assetPath = join(harnessHomePaths(homeDir).root, "components", "sdd-core", "workflow.md");
  await writeFile(assetPath, "# tampered\n");

  const { checks, ok } = await runGlobalDoctorChecks(homeDir, { packageRoot });
  const assetCheck = checks.find((check) => check.name === "~/.harness/components/sdd-core/workflow.md");

  assert.equal(ok, false);
  assert.equal(assetCheck.status, "stale");
});

test("doctor detects stale component section in one target while another stays healthy", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const cursorConfig = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  await writeFile(join(homeDir, ".cursor", "AGENTS.md"), cursorConfig.replace("### SDD Core", "### Missing"));

  const { checks, ok } = await runGlobalDoctorChecks(homeDir, { packageRoot });

  assert.equal(ok, false);
  assert.equal(
    checks.find((check) => check.name === "component-section:sdd-core:.cursor/AGENTS.md").status,
    "stale"
  );
  assert.equal(
    checks.find((check) => check.name === "component-section:sdd-core:.codex/AGENTS.md").status,
    "ok"
  );
});

test("update repairs stale sections across all managed targets", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  for (const configFile of [".cursor/AGENTS.md", ".codex/AGENTS.md"]) {
    const content = await readFile(join(homeDir, configFile), "utf8");
    await writeFile(join(homeDir, configFile), content.replace("### Orchestrator", "### Broken"));
  }

  const repair = await updateGlobalHarness({ ...baseOptions, homeDir, cliVersion: "0.6.1" });

  assert.equal(repair.driftDetected, true);
  assert.equal(repair.configsRepaired.length, 2);

  const after = await runGlobalDoctorChecks(homeDir, { packageRoot });
  assert.equal(after.ok, true);
});

test("update recreates missing component assets and refreshes state hashes", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const assetPath = join(harnessHomePaths(homeDir).root, "components", "sdd-core", "workflow.md");
  await rm(assetPath);

  const repair = await syncGlobalHarness({ ...baseOptions, homeDir, cliVersion: "0.6.2", agents: ["cursor", "codex"], components: ["orchestrator", "sdd-core"] });

  assert.ok(repair.assetsRepaired.includes("components/sdd-core/workflow.md"));
  assert.ok(existsSync(assetPath));

  const state = await readGlobalState(harnessHomePaths(homeDir).statePath);
  assert.equal(state.cliVersion, "0.6.2");
  assert.match(state.coreFiles["components/sdd-core/workflow.md"], /^[0-9a-f]{64}$/);
});

test("update dry-run shows planned repairs without writing", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });
  await rm(join(harnessHomePaths(homeDir).root, "components", "sdd-core", "workflow.md"));

  const repair = await syncGlobalHarness({
    ...baseOptions,
    homeDir,
    agents: ["cursor", "codex"],
    components: ["orchestrator", "sdd-core"],
    dryRun: true
  });

  assert.ok(repair.repairs.length > 0);
  assert.equal(existsSync(join(harnessHomePaths(homeDir).root, "components", "sdd-core", "workflow.md")), false);
});

test("user content before and after managed block remains unchanged on repair", async () => {
  const homeDir = await createFakeHome({ withUserContent: true });
  await installGlobalHarness({ ...baseOptions, homeDir, agents: ["cursor"] });

  const beforePath = join(homeDir, ".cursor", "AGENTS.md");
  const beforeOwned = userOwnedContent(await readFile(beforePath, "utf8"));

  const content = await readFile(beforePath, "utf8");
  await writeFile(beforePath, content.replace("### SDD Core", "### Broken"));

  await updateGlobalHarness({ ...baseOptions, homeDir, agents: ["cursor"], components: ["orchestrator", "sdd-core"] });

  const afterOwned = userOwnedContent(await readFile(beforePath, "utf8"));
  assert.equal(afterOwned, beforeOwned);
  assert.match(afterOwned, /# User rules/);
  assert.match(afterOwned, /keep this/);
});
