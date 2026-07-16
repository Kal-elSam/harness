import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  resolveEngramAgentSelection,
  engramSetupSlugForAgent,
  ENGRAM_INTEGRATION_STATUS,
  parseEngramVersion,
  classifyEngramVersion,
  inspectEngramBinary,
  inspectEngramAgentConfig,
  inspectEngramIntegration
} from "../src/global/integrations/engram-evidence.js";
import { planEngramConfigure } from "../src/global/integrations/engram-plan.js";
import { createEngramProvider } from "../src/global/integrations/engram-provider.js";

test("agent mapping, version classes, and dry-run plan", () => {
  assert.equal(engramSetupSlugForAgent("claude"), "claude-code");
  assert.deepEqual(resolveEngramAgentSelection({ detectedIds: ["codex", "pi", "cursor"] }), ["cursor", "codex"]);
  assert.throws(() => resolveEngramAgentSelection({ requestedIds: ["pi"] }), /not managed/);

  assert.equal(parseEngramVersion("Update available: 1.16.1 -> 1.19.0\nengram 1.16.1"), "1.16.1");
  assert.equal(classifyEngramVersion("1.16.1").status, ENGRAM_INTEGRATION_STATUS.UNSUPPORTED);
  assert.equal(classifyEngramVersion("1.19.0").status, ENGRAM_INTEGRATION_STATUS.AVAILABLE);
  assert.equal(classifyEngramVersion("2.0.0").status, ENGRAM_INTEGRATION_STATUS.UNSUPPORTED);

  assert.equal(inspectEngramBinary({ whichCommand: () => null }).status, ENGRAM_INTEGRATION_STATUS.MISSING);
  const old = inspectEngramBinary({
    whichCommand: () => "/usr/local/bin/engram",
    probe: () => ({ ok: true, stdout: "engram 1.16.1", stderr: "", status: 0, error: null, timedOut: false })
  });
  assert.equal(old.status, ENGRAM_INTEGRATION_STATUS.UNSUPPORTED);

  const homeDir = mkdtempSync(join(process.cwd(), ".tmp-engram-evidence-"));
  try {
    mkdirSync(join(homeDir, ".codex"), { recursive: true });
    writeFileSync(join(homeDir, ".codex", "config.toml"), "[mcp_servers.engram]\ncommand = \"engram\"\n");
    assert.equal(inspectEngramAgentConfig("codex", { homeDir }).status, ENGRAM_INTEGRATION_STATUS.CONFIGURED);
    assert.equal(inspectEngramAgentConfig("claude", { homeDir }).status, ENGRAM_INTEGRATION_STATUS.UNCONFIGURED);
    const inspection = inspectEngramIntegration({
      homeDir,
      agentIds: ["codex", "claude"],
      whichCommand: () => "/opt/engram",
      probe: () => ({ ok: true, stdout: "engram 1.19.0", stderr: "", status: 0, error: null, timedOut: false })
    });
    assert.equal(inspection.doctorInvoked, false);
    assert.equal(inspection.status, ENGRAM_INTEGRATION_STATUS.AVAILABLE);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }

  const blocked = planEngramConfigure({
    requestedAgentIds: ["codex"],
    inspect: () => ({
      provider: "engram",
      status: ENGRAM_INTEGRATION_STATUS.UNSUPPORTED,
      binary: {
        path: "/opt/engram",
        version: "1.16.1",
        status: ENGRAM_INTEGRATION_STATUS.UNSUPPORTED,
        supported: false,
        guidance: "Upgrade Engram manually"
      },
      agents: [{ id: "codex", slug: "codex", status: ENGRAM_INTEGRATION_STATUS.UNCONFIGURED, evidence: [] }],
      doctorInvoked: false
    })
  });
  assert.equal(blocked.executes, false);
  assert.equal(blocked.writes, false);
  assert.equal(blocked.actions[0].action, "blocked");

  const ready = planEngramConfigure({
    requestedAgentIds: ["codex", "claude"],
    inspect: () => ({
      provider: "engram",
      status: ENGRAM_INTEGRATION_STATUS.UNCONFIGURED,
      binary: {
        path: "/opt/engram",
        version: "1.19.0",
        status: ENGRAM_INTEGRATION_STATUS.AVAILABLE,
        supported: true,
        guidance: null
      },
      agents: [
        { id: "codex", slug: "codex", status: ENGRAM_INTEGRATION_STATUS.UNCONFIGURED, evidence: [] },
        { id: "claude", slug: "claude-code", status: ENGRAM_INTEGRATION_STATUS.UNCONFIGURED, evidence: [] }
      ],
      doctorInvoked: false
    })
  });
  assert.deepEqual(ready.actions.map((a) => a.command), [
    ["/opt/engram", "setup", "codex"],
    ["/opt/engram", "setup", "claude-code"]
  ]);
  assert.equal(ready.nextStatusIfApplied, ENGRAM_INTEGRATION_STATUS.RESTART_REQUIRED);
  assert.equal(createEngramProvider().id, "engram");
});
