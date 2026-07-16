import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli.js";
import { buildEngramIntegrationChecks } from "../src/global/component-integration-cli.js";
import { ENGRAM_INTEGRATION_STATUS } from "../src/global/integrations/engram-evidence.js";
import { runComponentEcosystemChecks } from "../src/global/component-ecosystem-checks.js";

test("CLI parses configure/rollback and health checks stay component-scoped", async () => {
  const configure = parseArgs([
    "components", "configure", "engram-memory",
    "--agents", "codex,opencode", "--dry-run", "--json"
  ]);
  assert.equal(configure.command, "components");
  assert.equal(configure.options.componentsAction, "configure");
  assert.equal(configure.options.componentId, "engram-memory");
  assert.deepEqual(configure.options.adapters, ["codex", "opencode"]);
  assert.equal(configure.options.dryRun, true);

  const rollback = parseArgs([
    "components", "rollback", "engram-memory",
    "--receipt", "engram-test", "--yes"
  ]);
  assert.equal(rollback.options.componentsAction, "rollback");
  assert.equal(rollback.options.receiptId, "engram-test");
  assert.equal(rollback.options.yes, true);

  const checks = buildEngramIntegrationChecks({
    binary: {
      path: "/opt/engram",
      version: "1.16.1",
      status: ENGRAM_INTEGRATION_STATUS.UNSUPPORTED,
      guidance: "Upgrade Engram manually"
    },
    agents: [
      { id: "codex", slug: "codex", status: ENGRAM_INTEGRATION_STATUS.UNCONFIGURED }
    ]
  });
  assert.ok(checks.every((check) => check.componentId === "engram-memory"));
  assert.ok(checks.some((check) => check.name === "engram:binary" && check.status === "warning"));
  assert.match(checks.find((check) => check.name === "engram:agent:codex").detail, /not runtime-active/);

  const ecosystem = await runComponentEcosystemChecks({
    installedComponents: [{ id: "engram-memory" }],
    homeDir: "/tmp/does-not-matter-for-missing-binary"
  });
  assert.ok(ecosystem.some((check) => check.name === "engram:binary"));
  assert.ok(ecosystem.every((check) => check.componentId === "engram-memory"));
});
