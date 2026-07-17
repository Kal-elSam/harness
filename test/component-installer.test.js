import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installGlobalHarness, uninstallGlobalHarness, updateGlobalHarness } from "../src/global/global-installer.js";
import { runGlobalDoctorChecks } from "../src/global/global-doctor.js";
import { hasManagedSection } from "../src/global/managed-section.js";
import { readGlobalState } from "../src/global/state.js";
import { harnessHomePaths } from "../src/global/paths.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseOptions = { packageRoot, packageName: "@kal-elsam/kairo-runtime", cliVersion: "0.5.0" };

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# My cursor rules\n\nuser content\n");
  }

  return homeDir;
}

test("default install includes sdd-core assets and state", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);

  const result = await installGlobalHarness({ ...baseOptions, homeDir });

  assert.deepEqual(result.components, ["orchestrator", "sdd-core"]);
  assert.ok(result.coreFiles.includes("components/orchestrator/orchestrator.md"));
  assert.ok(result.coreFiles.includes("components/sdd-core/workflow.md"));
  assert.ok(existsSync(join(paths.root, "components", "sdd-core", "spec-sizing.md")));
  assert.ok(existsSync(join(paths.root, "components", "sdd-core", "skills", "sdd-init", "SKILL.md")));
  assert.ok(existsSync(join(paths.root, "components", "sdd-core", "skills", "sdd-init", "references", "contract.md")));
  assert.ok(existsSync(join(paths.root, "components", "sdd-core", "skills", "sdd-archive", "SKILL.md")));
  assert.ok(existsSync(join(paths.root, "components", "sdd-core", "personas", "teaching.md")));

  const state = await readGlobalState(paths.statePath);
  assert.equal(state.stateVersion, 4);
  assert.deepEqual(state.sdd, { persona: "off", personaAgentIds: [], agentIds: [], files: [], lastReceiptId: null, updatedAt: null });
  assert.deepEqual(state.components.map((entry) => entry.id), ["orchestrator", "sdd-core"]);
  assert.equal(state.components[1].version, "2.0.0");
  assert.ok(state.components[1].managedTargets.includes(".cursor/AGENTS.md"));
});

test("--no-default-components installs only core plumbing", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);

  const result = await installGlobalHarness({ ...baseOptions, homeDir, noDefaultComponents: true });

  assert.deepEqual(result.components, []);
  assert.equal(result.coreFiles.length, 0);
  assert.equal(existsSync(join(paths.root, "components")), false);

  const cursorConfig = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  assert.ok(hasManagedSection(cursorConfig));
  assert.match(cursorConfig, /No optional components installed/);
});

test("update refreshes component-managed sections", async () => {
  const homeDir = await createFakeHome();

  await installGlobalHarness({ ...baseOptions, homeDir });
  const result = await updateGlobalHarness({ ...baseOptions, homeDir, cliVersion: "0.6.0" });

  assert.deepEqual(result.components, ["orchestrator", "sdd-core"]);

  const content = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  assert.match(content, /### SDD Core/);
  assert.match(content, /### Orchestrator/);
});

test("doctor reports component assets and stale sections", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const healthy = await runGlobalDoctorChecks(homeDir, { packageRoot });
  assert.equal(healthy.checks.find((check) => check.name === "component-section:sdd-core:.cursor/AGENTS.md").status, "ok");

  const content = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  const stripped = content.replace("### SDD Core", "### Missing");
  await writeFile(join(homeDir, ".cursor", "AGENTS.md"), stripped);

  const stale = await runGlobalDoctorChecks(homeDir, { packageRoot });
  assert.equal(stale.checks.find((check) => check.name === "component-section:sdd-core:.cursor/AGENTS.md").status, "stale");
});

test("uninstall removes component-managed sections and assets", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  await installGlobalHarness({ ...baseOptions, homeDir });
  const result = await uninstallGlobalHarness({ homeDir });

  assert.deepEqual(result.components, ["orchestrator", "sdd-core"]);
  assert.equal(existsSync(join(paths.root, "components")), false);

  const content = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  assert.ok(!hasManagedSection(content));
  assert.ok(content.includes("user content"));
});
