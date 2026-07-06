import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildAdapterMatrixReport } from "../src/global/adapter-matrix.js";
import { installGlobalHarness, uninstallGlobalHarness } from "../src/global/global-installer.js";
import { hasManagedSection } from "../src/global/managed-section.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { GLOBAL_AGENT_IDS, resolveTargetAdapters } from "../src/global/registry.js";
import { runHarnessSetup } from "../src/global/setup.js";
import { buildStatusReport } from "../src/global/status.js";
import { runHarnessSync } from "../src/global/sync.js";
import { buildAdapterContext } from "../src/global/adapter-context.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");
const cliVersion = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8")
).version;
const baseOptions = {
  packageRoot,
  packageName: "@kal-elsam/harness",
  cliVersion
};

const ALL_AGENT_ROOTS = [
  [".cursor"],
  [".codex"],
  [".config", "opencode"],
  [".claude"]
];

async function createFakeHomeWithAllAgents() {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-all-agents-"));

  for (const parts of ALL_AGENT_ROOTS) {
    await mkdir(join(homeDir, ...parts), { recursive: true });
  }

  return homeDir;
}

function runHarness(args, homeDir) {
  return spawnSync(process.execPath, [harnessBin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir }
  });
}

test("resolveTargetAdapters honors --agents all", async () => {
  const homeDir = await createFakeHomeWithAllAgents();
  const context = buildAdapterContext({ homeDir, packageName: baseOptions.packageName });
  const onlyCursor = resolveTargetAdapters(context, ["cursor"]);
  const allAgents = resolveTargetAdapters(context, ["all"]);

  assert.deepEqual(onlyCursor.map((adapter) => adapter.id), ["cursor"]);
  assert.deepEqual(allAgents.map((adapter) => adapter.id), GLOBAL_AGENT_IDS);
});

test("setup --agents all configures all four adapters even when only two are detected", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-two-detected-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    agents: ["all"],
    yes: true,
    interactive: false
  });

  assert.equal(outcome.cancelled, false);
  assert.deepEqual(outcome.result.agents, GLOBAL_AGENT_IDS);
  assert.ok(existsSync(join(homeDir, ".config", "opencode", "AGENTS.md")));
  assert.ok(existsSync(join(homeDir, ".claude", "CLAUDE.md")));
});

test("setup --yes with four roots configures all adapters", async () => {
  const homeDir = await createFakeHomeWithAllAgents();

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    yes: true,
    interactive: false
  });

  assert.equal(outcome.cancelled, false);
  assert.deepEqual(outcome.result.agents, GLOBAL_AGENT_IDS);

  for (const adapter of GLOBAL_AGENT_IDS) {
    const matrix = await buildAdapterMatrixReport(homeDir);
    const entry = matrix.adapters.find((candidate) => candidate.id === adapter);
    assert.equal(entry.detected, true, `${adapter} should be detected`);
    assert.equal(entry.managed, true, `${adapter} should be managed`);
  }
});

test("status --json reports all four adapters as managed", async () => {
  const homeDir = await createFakeHomeWithAllAgents();
  await installGlobalHarness({ ...baseOptions, homeDir, agents: ["all"] });

  const report = await buildStatusReport(homeDir, { packageRoot });
  assert.equal(report.overall, "ok");
  assert.deepEqual(
    report.agents.filter((agent) => agent.managed).map((agent) => agent.id),
    GLOBAL_AGENT_IDS
  );

  const cli = runHarness(["status", "--json"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  const payload = JSON.parse(cli.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(
    payload.agents.filter((agent) => agent.managed).map((agent) => agent.id),
    GLOBAL_AGENT_IDS
  );
});

test("doctor --json includes managed-section checks for all four config files", async () => {
  const homeDir = await createFakeHomeWithAllAgents();
  await installGlobalHarness({ ...baseOptions, homeDir, agents: ["all"] });

  const cli = runHarness(["doctor", "--json"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  const payload = JSON.parse(cli.stdout);

  const managedSections = payload.checks.filter((check) => check.category === "managed_section");
  assert.deepEqual(
    managedSections.map((check) => check.configFile).sort(),
    [
      ".claude/CLAUDE.md",
      ".codex/AGENTS.md",
      ".config/opencode/AGENTS.md",
      ".cursor/AGENTS.md"
    ].sort()
  );
  assert.ok(managedSections.every((check) => check.status === "ok"));
});

test("adapters --json exposes official adapter matrix fields", async () => {
  const homeDir = await createFakeHomeWithAllAgents();
  await installGlobalHarness({ ...baseOptions, homeDir, agents: ["all"] });

  const cli = runHarness(["adapters", "--json"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  const payload = JSON.parse(cli.stdout);

  assert.equal(payload.supportedCount, 4);
  assert.equal(payload.managedCount, 4);
  assert.equal(payload.detectedCount, 4);
  assert.equal(payload.cliVersion, cliVersion);
  assert.equal(payload.adapters.length, 4);

  const cursor = payload.adapters.find((entry) => entry.id === "cursor");
  assert.equal(cursor.label, "Cursor");
  assert.equal(cursor.rootDir, ".cursor");
  assert.equal(cursor.configFile, ".cursor/AGENTS.md");
  assert.equal(cursor.detected, true);
  assert.equal(cursor.managed, true);
  assert.deepEqual(cursor.managedTargets, [".cursor/AGENTS.md"]);

  const opencode = payload.adapters.find((entry) => entry.id === "opencode");
  assert.equal(opencode.rootDir, ".config/opencode");
  assert.equal(opencode.configFile, ".config/opencode/AGENTS.md");

  const claude = payload.adapters.find((entry) => entry.id === "claude");
  assert.equal(claude.rootDir, ".claude");
  assert.equal(claude.configFile, ".claude/CLAUDE.md");
});

test("sync repairs drift in OpenCode managed section", async () => {
  const homeDir = await createFakeHomeWithAllAgents();
  await installGlobalHarness({ ...baseOptions, homeDir, agents: ["all"] });

  const configPath = join(homeDir, ".config", "opencode", "AGENTS.md");
  const original = await readFile(configPath, "utf8");
  await writeFile(configPath, original.replace("### SDD Core", "### Broken"));

  const drifted = await buildStatusReport(homeDir, { packageRoot });
  assert.equal(drifted.overall, "drift");

  const outcome = await runHarnessSync({ ...baseOptions, homeDir, yes: true });
  assert.equal(outcome.action, "repaired");
  assert.equal(outcome.report.overall, "ok");

  const repaired = await readFile(configPath, "utf8");
  assert.ok(hasManagedSection(repaired));
  assert.match(repaired, /### SDD Core/);
  assert.ok(!repaired.includes("### Broken"));
});

test("uninstall removes managed sections from all four adapters", async () => {
  const homeDir = await createFakeHomeWithAllAgents();
  await installGlobalHarness({ ...baseOptions, homeDir, agents: ["all"] });

  const configPaths = [
    join(homeDir, ".cursor", "AGENTS.md"),
    join(homeDir, ".codex", "AGENTS.md"),
    join(homeDir, ".config", "opencode", "AGENTS.md"),
    join(homeDir, ".claude", "CLAUDE.md")
  ];

  for (const configPath of configPaths) {
    assert.ok(hasManagedSection(await readFile(configPath, "utf8")));
  }

  const result = await uninstallGlobalHarness({ homeDir });
  assert.deepEqual(
    [...result.configsCleaned].sort(),
    [
      ".claude/CLAUDE.md",
      ".codex/AGENTS.md",
      ".config/opencode/AGENTS.md",
      ".cursor/AGENTS.md"
    ].sort()
  );

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) continue;
    assert.equal(hasManagedSection(await readFile(configPath, "utf8")), false);
  }

  const paths = harnessHomePaths(homeDir);
  assert.equal(existsSync(paths.statePath), false);
});

test("adapters human output documents non-installer behavior", async () => {
  const homeDir = await createFakeHomeWithAllAgents();
  const cli = runHarness(["adapters"], homeDir);

  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Harness adapters — supported agent integrations/);
  assert.match(cli.stdout, /does not install Cursor, Codex, OpenCode, or Claude Code/i);
  assert.match(cli.stdout, /\.config\/opencode/);
  assert.match(cli.stdout, /\.claude\/CLAUDE\.md/);
});
