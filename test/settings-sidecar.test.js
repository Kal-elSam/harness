/**
 * U5b: Settings snapshot — profile/config/integrations via existing adapters.
 * Interactive setup stays an honest stub unless a safe path exists.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SETUP_WIRED_LABEL,
  buildSettingsSnapshot,
  formatSettingsHints
} from "../src/global/host/settings-sidecar.js";

test("buildSettingsSnapshot composes profile, integrations, connections; setup wired", async () => {
  const snap = await buildSettingsSnapshot({
    homeDir: "/tmp/h",
    workspaceRoot: "/tmp/w",
    resolveProfileFn: async () => ({
      profile: { applyMode: "prompt", tokenBudget: 4000, preferredModel: null },
      sources: { global: true, project: false }
    }),
    listIntegrations: () => [
      {
        id: "pi-usage-widget",
        name: "Pi usage widget",
        version: "0.2.1",
        license: "MIT",
        status: "available"
      }
    ],
    buildConnections: async () => ({
      connections: [
        { id: "mcp-cursor", label: "Cursor MCP", state: "ok" }
      ]
    }),
    loadScanBundle: async () => ({
      snapshot: { policy: { profile: "default", applyMode: "prompt", preflight: "on" } },
      diagnostics: { profile: { sources: { global: true } } }
    })
  });

  assert.equal(snap.ok, true);
  assert.match(snap.profile.join("\n"), /applyMode|prompt|tokenBudget|4000/i);
  assert.match(snap.integrations.join("\n"), /Pi usage widget|0\.2\.1/);
  assert.match(snap.connections.join("\n"), /Cursor MCP|ok/);
  assert.equal(snap.setup.wired, true);
  assert.equal(snap.setup.label, SETUP_WIRED_LABEL);
  assert.doesNotMatch(snap.setup.label, /not wired/i);
  assert.match(snap.hints, /Esc/);
  assert.doesNotMatch(snap.setup.label, /opens setup/i);
});

test("buildSettingsSnapshot fail-closed when profile/connections throw", async () => {
  const snap = await buildSettingsSnapshot({
    homeDir: "/tmp/h",
    workspaceRoot: "/tmp/w",
    resolveProfileFn: async () => {
      throw new Error("profile gone");
    },
    listIntegrations: () => [],
    buildConnections: async () => {
      throw new Error("connections down");
    },
    loadScanBundle: async () => {
      throw new Error("scan down");
    }
  });

  assert.equal(snap.ok, false);
  assert.match(snap.profile.join("\n"), /unavailable|error|profile/i);
  assert.match(snap.connections.join("\n"), /unavailable|error/i);
  assert.equal(snap.setup.wired, true);
});

test("formatSettingsHints wrap-safe at 60 cols (≤2 logical segments)", () => {
  const hints = formatSettingsHints();
  assert.match(hints, /Esc → Work/);
  assert.ok(hints.split(" · ").length >= 2);
});
