import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { runComponentsConfigure } from "../src/global/component-integration-cli.js";
import { SDD_FILE_OUTCOMES } from "../src/global/integrations/sdd-evidence.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { normalizeGlobalState, STATE_VERSION, UNSUPPORTED_STATE_VERSION } from "../src/global/state-migration.js";
import { readGlobalState, writeGlobalState } from "../src/global/state.js";

const tmp = (n) => mkdtempSync(join(process.cwd(), n));

function v3Fixture(extra = {}) {
  return {
    stateVersion: 3,
    packageName: "@kal-elsam/kairo-runtime",
    cliVersion: "0.5.0",
    scope: "agent-global",
    installedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    adapters: [{
      id: "codex", label: "Codex", rootDir: ".codex",
      configFile: ".codex/AGENTS.md", managedTargets: [".codex/AGENTS.md"], present: true
    }],
    components: [{ id: "sdd-core", version: "2.0.0", managedTargets: [] }],
    coreFiles: {},
    backups: [],
    compatNote: "preserve-me",
    ...extra
  };
}

test("normalizeGlobalState upgrades compatible v3 to explicit stateVersion 4", () => {
  const v3 = v3Fixture();
  const once = normalizeGlobalState(v3);
  assert.equal(once.stateVersion, STATE_VERSION);
  assert.equal(once.compatNote, "preserve-me");
  assert.equal(once.installedAt, v3.installedAt);
  assert.equal(once.updatedAt, v3.updatedAt);
  assert.deepEqual(once.adapters, v3.adapters);
  assert.deepEqual(once.components, v3.components);
  assert.deepEqual(once.sdd, {
    persona: "off", agentIds: [], files: [], lastReceiptId: null, updatedAt: null
  });

  const twice = normalizeGlobalState(once);
  assert.deepEqual(twice, once);
});

test("v3 on disk migrates through configure persist to durable v4", async () => {
  const homeDir = tmp(".tmp-sdd-state-v4-");
  const prevHome = process.env.HARNESS_HOME;
  const prevExit = process.exitCode;
  process.env.HARNESS_HOME = homeDir;
  try {
    const paths = harnessHomePaths(homeDir);
    mkdirSync(dirname(paths.statePath), { recursive: true });
    writeFileSync(paths.statePath, `${JSON.stringify(v3Fixture(), null, 2)}\n`);

    const loaded = await readGlobalState(paths.statePath);
    assert.equal(loaded.stateVersion, 4);
    assert.equal(loaded.compatNote, "preserve-me");

    const receipt = {
      id: "sdd-v4-migrate", persona: "teaching", agentIds: ["codex", "claude"],
      ok: true, partial: false,
      files: [{
        destinationPath: "/h/.agents/skills/sdd-init/SKILL.md",
        skillId: "sdd-init", agentIds: ["codex"], action: "create",
        applied: true, afterHash: "hash-a", outcome: SDD_FILE_OUTCOMES.APPLIED
      }]
    };
    await runComponentsConfigure({
      componentId: "sdd-core", yes: true, json: true,
      provider: { apply: async () => ({ receipt, dryRun: false, cancelled: false }) }
    });

    const raw = JSON.parse(readFileSync(paths.statePath, "utf8"));
    assert.equal(raw.stateVersion, 4);
    assert.equal(raw.compatNote, "preserve-me");
    assert.deepEqual(raw.sdd.agentIds, ["codex"]);
    assert.equal(raw.sdd.persona, "teaching");
    assert.equal(raw.sdd.lastReceiptId, "sdd-v4-migrate");
    assert.equal(raw.sdd.files[0].hash, "hash-a");

    const reread = await readGlobalState(paths.statePath);
    assert.deepEqual(normalizeGlobalState(reread), reread);
  } finally {
    process.exitCode = prevExit;
    if (prevHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = prevHome;
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("future stateVersion fails closed without rewriting the file", async () => {
  const homeDir = tmp(".tmp-sdd-state-future-");
  try {
    const paths = harnessHomePaths(homeDir);
    mkdirSync(dirname(paths.statePath), { recursive: true });
    const future = v3Fixture({ stateVersion: STATE_VERSION + 1, futureMarker: "do-not-touch" });
    const payload = `${JSON.stringify(future, null, 2)}\n`;
    writeFileSync(paths.statePath, payload);

    assert.throws(
      () => normalizeGlobalState(future),
      (error) => error.code === UNSUPPORTED_STATE_VERSION && /Unsupported stateVersion/.test(error.message)
    );
    await assert.rejects(
      () => readGlobalState(paths.statePath),
      (error) => error.code === UNSUPPORTED_STATE_VERSION
    );
    await assert.rejects(
      () => writeGlobalState(paths.statePath, future),
      (error) => error.code === UNSUPPORTED_STATE_VERSION
    );
    assert.equal(readFileSync(paths.statePath, "utf8"), payload);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
