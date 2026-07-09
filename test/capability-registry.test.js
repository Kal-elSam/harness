import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAPABILITY_STATES } from "../src/global/capability-states.js";
import {
  buildCapabilityDiagnostics,
  inspectAllCapabilities,
  summarizeCapabilityRegistry
} from "../src/global/capability-registry.js";
import { resolveCapabilityAdapter } from "../src/global/agent-capabilities/index.js";

test("capability registry inspects all supported agents", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-cap-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });

  const capabilities = await inspectAllCapabilities({ homeDir });

  assert.equal(capabilities.length, 4);
  const cursor = capabilities.find((entry) => entry.id === "cursor");
  assert.equal(cursor.detected, true);
  assert.ok([CAPABILITY_STATES.DETECTED, CAPABILITY_STATES.UNKNOWN, CAPABILITY_STATES.AVAILABLE].includes(cursor.state));
});

test("opaque providers report unknown rather than failing", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-cap-opaque-"));
  const adapter = resolveCapabilityAdapter("cursor");

  const inspection = adapter.inspect(
    { homeDir },
    {
      probeImpl: () => ({
        id: "cursor",
        label: "Cursor",
        state: CAPABILITY_STATES.UNKNOWN,
        detected: false,
        cliAvailable: false,
        version: null,
        authenticated: null,
        recommendation: "opaque"
      })
    }
  );

  assert.equal(inspection.state, CAPABILITY_STATES.UNKNOWN);
});

test("agent CLI failures produce actionable diagnostics", () => {
  const capabilities = [
    {
      id: "codex",
      state: CAPABILITY_STATES.ERROR,
      error: "spawn failed",
      recommendation: "check logs"
    }
  ];

  const diagnostics = buildCapabilityDiagnostics(capabilities);
  assert.equal(diagnostics.errors.length, 1);
  assert.match(diagnostics.errors[0].message, /spawn failed|check logs/);
});

test("registry summary counts states", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-cap-summary-"));
  const capabilities = await inspectAllCapabilities({ homeDir });
  const summary = summarizeCapabilityRegistry(capabilities);

  assert.equal(summary.total, 4);
  assert.equal(summary.supported, 4);
});
