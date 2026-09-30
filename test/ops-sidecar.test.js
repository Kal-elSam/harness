/**
 * U5a: read-only Operations hub builder — health / fleet / usage / diagnostics.
 * Fail-closed: unavailable local services become honest empty/error lines.
 * Honest label: fleet report ≠ slash /providers.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FLEET_SECTION_TITLE,
  buildOpsSnapshot,
  formatOpsHealthLines
} from "../src/global/host/ops-sidecar.js";

test("formatOpsHealthLines names control-plane health honestly", () => {
  assert.deepEqual(formatOpsHealthLines({ health: "HEALTHY" }), [
    "Control plane · HEALTHY"
  ]);
  assert.deepEqual(formatOpsHealthLines(null), ["Health unavailable."]);
  assert.deepEqual(formatOpsHealthLines({}), ["Health unavailable."]);
});

test("buildOpsSnapshot composes health, fleet, usage, diagnostics with honest fleet label", async () => {
  const snap = await buildOpsSnapshot({
    homeDir: "/tmp/kairo-ops-home",
    workspaceRoot: "/tmp/kairo-ops-ws",
    packageName: "@kal-elsam/kairo-runtime",
    packageRoot: "/tmp/kairo-ops-pkg",
    cliVersion: "0.0.0-test",
    loadScanBundle: async () => ({
      dashboard: { profile: { profile: { tokenBudget: 1000 } }, activeRuns: [], recentRuns: [] },
      diagnostics: {
        diagnostics: { detected: 1, available: 1, unknown: 0, errors: 0 },
        capabilities: [
          { label: "Codex", state: "available", version: "1", authenticated: true }
        ],
        intelligence: {
          summary: { localAvailable: false, cloudAuthenticated: false },
          routingPreview: { reason: "local-only" }
        },
        profile: { sources: { global: true } },
        cliVersion: "0.0.0-test",
        recommendations: []
      },
      snapshot: { health: "HEALTHY", budgets: null }
    }),
    buildFleet: async () => ({
      ok: true,
      fleets: [
        {
          platform: "opencode",
          orchestrator: { id: "gentle-orchestrator", modelShort: "deepseek" },
          minions: [{ id: "sdd-apply" }]
        }
      ],
      note: "Declared config topology.",
      orchestratorAuthority: null,
      activity: null
    }),
    slashUsageLines: () => ["Codex · measured · 50% remaining"]
  });

  assert.equal(snap.ok, true);
  assert.equal(snap.error, null);
  assert.match(snap.health.join("\n"), /Control plane · HEALTHY/);
  assert.equal(snap.fleet[0], FLEET_SECTION_TITLE);
  assert.match(snap.fleet.join("\n"), /Fleet floor|opencode/);
  assert.doesNotMatch(snap.fleet.join("\n"), /^\/providers/);
  assert.match(snap.usage.join("\n"), /MEASURED|Codex/);
  assert.match(snap.diagnostics.join("\n"), /Agents|Codex/);
  assert.match(snap.hints, /Esc/);
});

test("buildOpsSnapshot fail-closed when scan bundle throws", async () => {
  const snap = await buildOpsSnapshot({
    homeDir: "/tmp/x",
    workspaceRoot: "/tmp/x",
    packageName: "@kal-elsam/kairo-runtime",
    packageRoot: "/tmp/x",
    cliVersion: "0.0.0-test",
    loadScanBundle: async () => {
      throw new Error("scan down");
    },
    buildFleet: async () => {
      throw new Error("fleet down");
    },
    slashUsageLines: () => {
      throw new Error("usage down");
    }
  });

  assert.equal(snap.ok, false);
  assert.match(String(snap.error), /scan down|unavailable/i);
  assert.match(snap.health.join("\n"), /unavailable|error/i);
  assert.match(snap.fleet.join("\n"), /unavailable|error/i);
  assert.match(snap.usage.join("\n"), /unavailable|error/i);
  assert.match(snap.diagnostics.join("\n"), /unavailable|error/i);
});

test("buildOpsSnapshot isolates fleet failure from health/diagnostics", async () => {
  const snap = await buildOpsSnapshot({
    homeDir: "/tmp/x",
    workspaceRoot: "/tmp/x",
    packageName: "@kal-elsam/kairo-runtime",
    packageRoot: "/tmp/x",
    cliVersion: "0.0.0-test",
    loadScanBundle: async () => ({
      dashboard: { activeRuns: [], recentRuns: [] },
      diagnostics: {
        diagnostics: { detected: 0, available: 0, unknown: 0, errors: 0 },
        capabilities: [],
        intelligence: {
          summary: { localAvailable: false, cloudAuthenticated: false },
          routingPreview: { reason: "n/a" }
        },
        profile: { sources: {} },
        cliVersion: "0.0.0-test"
      },
      snapshot: { health: "NOT_CONFIGURED" }
    }),
    buildFleet: async () => {
      throw new Error("no fleet json");
    },
    slashUsageLines: async () => ["slash usage line"]
  });

  assert.equal(snap.ok, true);
  assert.match(snap.health.join("\n"), /NOT_CONFIGURED/);
  assert.match(snap.fleet.join("\n"), /unavailable|error|no fleet/i);
  assert.match(snap.usage.join("\n"), /slash usage line|MEASURED|Data unavailable/);
  assert.match(snap.diagnostics.join("\n"), /Agents/);
});
