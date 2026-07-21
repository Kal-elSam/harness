import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAdapterContext } from "../src/global/adapter-context.js";
import piAdapter, {
  PI_CODING_AGENT_DIR_ENV,
  PI_DEFAULT_CONFIG_FILE,
  PI_DEFAULT_ROOT_DIR,
  assertDefaultPiConfigDir,
  isCustomPiCodingAgentDir
} from "../src/global/adapters/pi.js";
import { resolveCapabilityAdapter } from "../src/global/agent-capabilities/index.js";
import { hasManagedSection } from "../src/global/managed-section.js";
import { installGlobalHarness, uninstallGlobalHarness } from "../src/global/global-installer.js";
import { readFileSync } from "node:fs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliVersion = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version;
const packageName = "@kal-elsam/kairo-runtime";

test("pi adapter targets ~/.pi/agent/AGENTS.md", () => {
  assert.equal(piAdapter.id, "pi");
  assert.equal(piAdapter.label, "Pi");
  assert.equal(piAdapter.assets.rootDir, PI_DEFAULT_ROOT_DIR);
  assert.equal(piAdapter.assets.configFile, PI_DEFAULT_CONFIG_FILE);
  assert.deepEqual(piAdapter.assets.managedTargets, [PI_DEFAULT_CONFIG_FILE]);
});

test("pi detect uses config directory independently of executable", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-pi-detect-"));
  const context = buildAdapterContext({ homeDir, packageName });

  assert.equal(piAdapter.detect(context), false);
  await mkdir(join(homeDir, ".pi", "agent"), { recursive: true });
  assert.equal(piAdapter.detect(context), true);
});

test("pi capability keeps auth opaque and separates cli availability", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-pi-cap-"));
  await mkdir(join(homeDir, ".pi", "agent"), { recursive: true });
  const context = buildAdapterContext({ homeDir, packageName });
  const capability = resolveCapabilityAdapter("pi");
  const inspection = capability.inspect(context);

  assert.equal(inspection.detected, true);
  assert.equal(inspection.authenticated, null);
  assert.match(inspection.recommendation ?? "", /provider-managed|Authentication/i);
});

test("pi plan/apply preserve user content and write managed markers", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-pi-apply-"));
  await mkdir(join(homeDir, ".pi", "agent"), { recursive: true });
  const configPath = join(homeDir, PI_DEFAULT_CONFIG_FILE);
  await writeFile(configPath, "# User rules\nkeep me\n", "utf8");

  const context = buildAdapterContext({
    homeDir,
    packageName,
    packageRoot,
    timestamp: "2026-07-21T00-00-00"
  });
  const plan = piAdapter.plan(context);
  assert.equal(plan.action, "update");
  assert.equal(plan.backupNeeded, true);

  const applied = await piAdapter.apply(context, plan);
  assert.equal(applied.action, "update");
  assert.ok(applied.backupPath);

  const content = await readFile(configPath, "utf8");
  assert.match(content, /# User rules/);
  assert.match(content, /keep me/);
  assert.equal(hasManagedSection(content), true);
});

test("custom PI_CODING_AGENT_DIR fails before config writes", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-pi-custom-"));
  const customDir = join(homeDir, "elsewhere");
  await mkdir(join(homeDir, ".pi", "agent"), { recursive: true });
  await mkdir(customDir, { recursive: true });

  assert.equal(isCustomPiCodingAgentDir({ [PI_CODING_AGENT_DIR_ENV]: customDir }, homeDir), true);
  assert.equal(
    isCustomPiCodingAgentDir({ [PI_CODING_AGENT_DIR_ENV]: join(homeDir, PI_DEFAULT_ROOT_DIR) }, homeDir),
    false
  );

  const context = {
    ...buildAdapterContext({ homeDir, packageName, packageRoot }),
    env: { [PI_CODING_AGENT_DIR_ENV]: customDir }
  };
  assert.throws(() => assertDefaultPiConfigDir(context), /PI_CODING_AGENT_DIR|0\.6\.0/);
  assert.throws(() => piAdapter.plan(context), /PI_CODING_AGENT_DIR|0\.6\.0/);
  await assert.rejects(() => piAdapter.apply(context, { action: "create" }), /PI_CODING_AGENT_DIR|0\.6\.0/);
  await assert.rejects(() => piAdapter.uninstall(context, { id: "pi" }), /PI_CODING_AGENT_DIR|0\.6\.0/);
  assert.equal(existsSync(join(customDir, "AGENTS.md")), false);
});

test("pi install sync and uninstall through global lifecycle", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-pi-life-"));
  await mkdir(join(homeDir, ".pi", "agent"), { recursive: true });

  await installGlobalHarness({
    packageRoot,
    packageName,
    cliVersion,
    homeDir,
    agents: ["pi"]
  });

  const configPath = join(homeDir, PI_DEFAULT_CONFIG_FILE);
  assert.equal(hasManagedSection(await readFile(configPath, "utf8")), true);

  const result = await uninstallGlobalHarness({ homeDir });
  assert.ok(result.configsCleaned.includes(PI_DEFAULT_CONFIG_FILE));
  if (existsSync(configPath)) {
    assert.equal(hasManagedSection(await readFile(configPath, "utf8")), false);
  }
});
