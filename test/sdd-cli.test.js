import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli.js";
import {
  buildSddIntegrationChecks,
  runComponentsConfigure,
  runComponentsVerify
} from "../src/global/component-integration-cli.js";
import { SDD_HEALTH } from "../src/global/integrations/sdd-evidence.js";
import { installGlobalHarness } from "../src/global/global-installer.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("CLI parses sdd-core configure/verify/rollback and persona", () => {
  const configure = parseArgs([
    "components", "configure", "sdd-core",
    "--agents", "codex,claude", "--persona", "teaching", "--dry-run", "--json"
  ]);
  assert.equal(configure.options.componentId, "sdd-core");
  assert.deepEqual(configure.options.adapters, ["codex", "claude"]);
  assert.equal(configure.options.persona, "teaching");
  assert.equal(parseArgs(["components", "verify", "sdd-core", "--json"]).options.componentsAction, "verify");
  assert.equal(parseArgs([
    "components", "rollback", "sdd-core", "--receipt", "sdd-test", "--yes"
  ]).options.receiptId, "sdd-test");
});

test("sdd configure dry-run then apply persists state for configured verify", async () => {
  const homeDir = mkdtempSync(join(process.cwd(), ".tmp-sdd-cli-"));
  const previousHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = homeDir;
  try {
    await installGlobalHarness({
      packageRoot, packageName: "@kal-elsam/kairo-runtime", cliVersion: "0.5.0", homeDir
    });
    const dry = await runComponentsConfigure({
      componentId: "sdd-core", adapters: ["codex"], dryRun: true, json: true, packageRoot, persona: "off"
    });
    assert.equal(dry.applied, false);
    assert.equal(dry.writes, false);
    assert.ok((dry.summary?.noop ?? 0) > 0);

    const taught = await runComponentsConfigure({
      componentId: "sdd-core", adapters: ["codex"], yes: true, json: true, packageRoot, persona: "teaching"
    });
    assert.equal(taught.applied && taught.sessionRefreshRequired, true);
    const verified = await runComponentsVerify({
      componentId: "sdd-core", adapters: ["codex"], json: true, packageRoot
    });
    assert.equal(verified.status === SDD_HEALTH.CONFIGURED && verified.ok, true);
    assert.deepEqual(verified.persona?.personaAgentIds, ["codex"]);
    assert.match(buildSddIntegrationChecks(verified)[0].detail, /disk presence/i);
  } finally {
    if (previousHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = previousHome;
    rmSync(homeDir, { recursive: true, force: true });
  }
});
