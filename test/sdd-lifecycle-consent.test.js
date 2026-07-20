import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installGlobalHarness, syncGlobalHarness } from "../src/global/global-installer.js";
import { runHarnessSetup } from "../src/global/setup.js";
import { runHarnessSync } from "../src/global/sync.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { readGlobalState } from "../src/global/state.js";
import { SDD_SKILL_IDS, resolveSddSkillPath } from "../src/global/integrations/sdd-destinations.js";
import { listSddReceipts, sddIntegrationsDir } from "../src/global/integrations/sdd-receipts.js";
import { runGlobalDoctorChecks } from "../src/global/global-doctor.js";
import { runComponentsConfigure } from "../src/global/component-integration-cli.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = { packageRoot, packageName: "@kal-elsam/kairo-runtime", cliVersion: "0.5.0" };

function home() {
  const homeDir = mkdtempSync(join(process.cwd(), ".tmp-sdd-life-"));
  mkdirSync(join(homeDir, ".cursor"), { recursive: true });
  mkdirSync(join(homeDir, ".codex"), { recursive: true });
  return homeDir;
}

test("install with sdd-core materializes nine skills persona off; without skips", async () => {
  const withSdd = home();
  const without = home();
  try {
    const applied = await installGlobalHarness({ ...base, homeDir: withSdd });
    assert.equal(applied.integrations.sdd.status, "applied");
    assert.equal(applied.integrations.sdd.persona, "off");
    assert.deepEqual(applied.integrations.sdd.personaAgentIds, []);
    assert.equal(applied.sessionRefreshRequired, true);
    for (const id of SDD_SKILL_IDS) {
      assert.ok(existsSync(resolveSddSkillPath(id, "codex", withSdd)));
    }
    const state = await readGlobalState(harnessHomePaths(withSdd).statePath);
    assert.equal(state.sdd.persona, "off");
    assert.ok(state.sdd.files.length >= SDD_SKILL_IDS.length);
    assert.ok(state.sdd.lastReceiptId);

    const skipped = await installGlobalHarness({
      ...base, homeDir: without, noDefaultComponents: true
    });
    assert.equal(skipped.integrations.sdd.status, "skipped");
    assert.equal(skipped.integrations.sdd.receipt, null);
    assert.equal(existsSync(sddIntegrationsDir(without)), false);
  } finally {
    rmSync(withSdd, { recursive: true, force: true });
    rmSync(without, { recursive: true, force: true });
  }
});

test("dry-run install/setup plans SDD with zero mutations or receipts", async () => {
  const homeDir = home();
  try {
    const plan = await installGlobalHarness({ ...base, homeDir, dryRun: true });
    assert.equal(plan.integrations.sdd.status, "planned");
    assert.equal(plan.integrations.sdd.receipt, null);
    assert.equal(existsSync(harnessHomePaths(homeDir).statePath), false);
    assert.equal(existsSync(sddIntegrationsDir(homeDir)), false);
    assert.equal(existsSync(resolveSddSkillPath("sdd-init", "codex", homeDir)), false);

    const setup = await runHarnessSetup({
      ...base, homeDir, dryRun: true, yes: false, interactive: false, json: true
    });
    assert.equal(setup.cancelled, false);
    assert.equal(setup.result.integrations.sdd.status, "planned");
    assert.equal(existsSync(harnessHomePaths(homeDir).statePath), false);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("identical sync noops and preserves sdd persona; teaching not expanded", async () => {
  const homeDir = home();
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = homeDir;
  try {
    await installGlobalHarness({ ...base, homeDir });
    await runComponentsConfigure({
      componentId: "sdd-core", adapters: ["codex"], yes: true, json: true, packageRoot, persona: "teaching"
    });
    const before = await readGlobalState(harnessHomePaths(homeDir).statePath);
    assert.deepEqual(before.sdd.personaAgentIds, ["codex"]);
    const beforeRaw = readFileSync(harnessHomePaths(homeDir).statePath, "utf8");

    const healthy = await runHarnessSync({ ...base, homeDir, yes: true });
    assert.equal(healthy.action, "noop");
    assert.equal(readFileSync(harnessHomePaths(homeDir).statePath, "utf8"), beforeRaw);

    const sync = await syncGlobalHarness({
      ...base, homeDir, agents: ["cursor", "codex"], components: ["orchestrator", "sdd-core"]
    });
    assert.ok((sync.integrations.sdd.summary?.noop ?? 0) > 0);
    assert.equal(sync.integrations.sdd.summary?.create ?? 0, 0);
    assert.deepEqual(sync.integrations.sdd.personaAgentIds, ["codex"]);
    const after = await readGlobalState(harnessHomePaths(homeDir).statePath);
    assert.deepEqual(after.sdd.personaAgentIds, ["codex"]);
    assert.equal(after.sdd.persona, "teaching");
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("lifecycle preserves conflicts under --yes; cancel blocks before materialize", async () => {
  const homeDir = home();
  const cancelHome = home();
  try {
    const userPath = resolveSddSkillPath("sdd-spec", "codex", homeDir);
    mkdirSync(dirname(userPath), { recursive: true });
    writeFileSync(userPath, "user owned\n");

    const result = await installGlobalHarness({ ...base, homeDir });
    assert.ok(result.integrations.sdd.conflicts.length >= 1);
    assert.equal(readFileSync(userPath, "utf8"), "user owned\n");

    const cancelled = await runHarnessSetup({
      ...base,
      homeDir: cancelHome,
      yes: true,
      agents: ["cursor"],
      interactive: true,
      simple: true,
      inkCapable: false,
      createPrompt: () => {
        const prompt = async () => "no";
        prompt.close = async () => {};
        return prompt;
      }
    });
    assert.equal(cancelled.cancelled, true);
    assert.equal(existsSync(harnessHomePaths(cancelHome).statePath), false);
    assert.equal(existsSync(sddIntegrationsDir(cancelHome)), false);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(cancelHome, { recursive: true, force: true });
  }
});

test("doctor reports disk state without claiming runtime; refresh only on effective change", async () => {
  const homeDir = home();
  try {
    const first = await installGlobalHarness({ ...base, homeDir });
    assert.equal(first.sessionRefreshRequired, true);
    const doctor = await runGlobalDoctorChecks(homeDir, { packageRoot });
    const skill = doctor.checks.find((check) => check.name === "sdd-core:skills");
    assert.equal(skill.status, "ok");
    assert.match(skill.detail, /disk presence ≠ runtime active/i);
    assert.equal(doctor.checks.find((check) => check.name === "sdd-core:persona").status, "ok");

    const second = await syncGlobalHarness({
      ...base, homeDir, agents: ["cursor", "codex"], components: ["orchestrator", "sdd-core"]
    });
    assert.equal(second.integrations.sdd.sessionRefreshRequired, false);
    assert.equal(
      second.sessionRefreshRequired,
      (second.configsCreated.length + second.configsUpdated.length + second.configsRepaired.length) > 0
    );
    assert.ok((await listSddReceipts({ homeDir })).length >= 1);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("sync repairs missing SDD skills via integration warning", async () => {
  const homeDir = home();
  try {
    await installGlobalHarness({ ...base, homeDir });
    const skillPath = resolveSddSkillPath("sdd-init", "codex", homeDir);
    rmSync(skillPath, { force: true });
    const doctor = await runGlobalDoctorChecks(homeDir, { packageRoot });
    assert.equal(doctor.checks.find((check) => check.name === "sdd-core:skills").status, "warning");

    const outcome = await runHarnessSync({ ...base, homeDir, yes: true });
    assert.equal(outcome.action, "repaired");
    assert.equal(outcome.wrote, true);
    assert.ok(existsSync(skillPath));
    assert.equal(outcome.result.integrations.sdd.status, "applied");
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
