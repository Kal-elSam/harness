import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Golden captured from the legacy locations (cockpit/theme.js, ink/orchestrator-state.js,
// ink/cockpit-control-center.js) BEFORE the helpers moved to neutral modules.
const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(
  readFileSync(join(here, "fixtures/operations-relocation/golden-before-relocation.json"), "utf8")
);

const DIAGNOSTICS = [
  undefined,
  null,
  {},
  {
    cliVersion: "1.2.3",
    diagnostics: { detected: 2, available: 1, unknown: 1, errors: 0 },
    capabilities: [
      { label: "Codex", state: "available", version: "0.9", authenticated: true },
      { label: "Cursor", state: "unknown", authenticated: false },
      { label: "Pi", state: "missing", version: null, authenticated: null }
    ],
    intelligence: {
      summary: { localAvailable: true, cloudAuthenticated: false },
      routingPreview: { reason: "local first" }
    },
    profile: { sources: { global: "/g", project: "/p" } },
    recommendations: ["run setup", "check auth"]
  },
  {
    capabilities: [{ label: "Claude", state: "available", authenticated: true }],
    profile: { sources: { global: null, project: "/p" } }
  },
  { profile: { sources: [] }, recommendations: [] }
];

const USAGE_INPUTS = [
  {},
  { snapshot: null, dashboard: null },
  {
    dashboard: {
      profile: {
        profile: { tokenBudget: 8000, stableContextBudget: 4000, requestContextBudget: 2000 },
        sources: { global: "/h", project: null }
      },
      recentRuns: [
        { agentId: "codex", tokenUsage: { input: 10, output: 5, total: 15 } },
        { agentId: "pi", tokenUsage: { input: 10 } },
        { agentId: "cursor", tokenUsage: {} }
      ]
    }
  },
  {
    layoutMode: "wide",
    dashboard: {
      recentRuns: Array.from({ length: 10 }, (_, i) => ({ agentId: `a${i}`, tokenUsage: { total: i + 1 } }))
    }
  },
  {
    layoutMode: "compact",
    dashboard: { recentRuns: [{ agentId: "codex", tokenUsage: { input: 1, output: 2 } }] }
  },
  {
    snapshot: {
      budgets: {
        stableUsedTokens: 5,
        stableBudgetTokens: 10,
        requestUsedTokens: 1,
        requestBudgetTokens: 3
      }
    }
  }
];

const RUN_STATES = ["running", "completed", "failed", "queued", "cancelled", "starting", undefined];

const LOCATIONS = {
  neutral: {
    theme: "../src/global/conversation/ansi-theme.js",
    health: "../src/global/operations/system-health.js",
    cancel: "../src/global/operations/run-cancellable.js",
    usage: "../src/global/operations/usage-model.js"
  },
  legacyReexports: {
    health: "../src/global/ink/orchestrator-state.js",
    cancel: "../src/global/ink/orchestrator-state.js",
    usage: "../src/global/ink/cockpit-control-center.js"
  }
};

async function load(paths) {
  const mods = {};
  for (const [key, path] of Object.entries(paths)) mods[key] = await import(path);
  return mods;
}

for (const [label, paths] of Object.entries(LOCATIONS)) {
  test(`relocated helpers reproduce the pre-move golden byte for byte (${label})`, async () => {
    const m = await load(paths);
    if (m.theme) {
      const themed = {};
      for (const key of Object.keys(m.theme.PALETTE)) {
        themed[key] = {
          fg: m.theme.theme.fg(key, "x"),
          bold: m.theme.theme.bold("x"),
          bg: m.theme.theme.bg?.(key, "x") ?? null
        };
      }
      assert.deepEqual(JSON.parse(JSON.stringify(themed)), golden.theme);
      assert.deepEqual(JSON.parse(JSON.stringify(m.theme.PALETTE)), golden.palette);
    }
    assert.deepEqual(DIAGNOSTICS.map((d) => m.health.formatSystemHealthLines(d)), golden.health);
    assert.deepEqual(
      m.health.formatAgentStatusLines([
        { label: "Codex", state: "available", version: "1", authenticated: true },
        { label: "X", state: "s", authenticated: null }
      ]),
      golden.agentStatus
    );
    assert.deepEqual(
      [undefined, null, [], {}, { global: "a" }, { project: "b" }, { global: "a", project: "b" }].map(
        (s) => m.health.formatProfileSourcesLabel(s)
      ),
      golden.profileLabels
    );
    const asJson = (value) => JSON.parse(JSON.stringify(value));
    assert.deepEqual(
      asJson(RUN_STATES.map((s) => [s, !!m.cancel.isRunCancellable({ state: s })])),
      golden.cancellable
    );
    assert.deepEqual(
      asJson([m.cancel.isRunCancellable(null), m.cancel.isRunCancellable(undefined)]),
      golden.cancellableNull
    );
    assert.deepEqual(USAGE_INPUTS.map((i) => m.usage.formatUsageLines(i)), golden.usage);
  });
}
