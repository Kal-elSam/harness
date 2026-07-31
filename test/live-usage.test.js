import test from "node:test";
import assert from "node:assert/strict";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { ActionList } from "../src/global/ink/ux/semantic.js";
import {
  adaptUsageModel, formatRunUsageLabel, usageRunLimit
} from "../src/global/ink/cockpit-usage.js";
import { SemanticUsagePanel } from "../src/global/ink/ux/live-usage.js";
import { formatUsageLines } from "../src/global/ink/cockpit-control-center.js";

function manyRuns(n, usage = { input: 1 }) {
  return Array.from({ length: n }, (_, i) => ({
    agentId: `agent-${i}`, tokenUsage: { ...usage, input: i }
  }));
}

function focusCount(listNode) {
  const kids = Array.isArray(listNode.props.children)
    ? listNode.props.children : [listNode.props.children];
  return kids.filter((c) => /^> /.test(String(c?.props?.children))).length;
}

test("unavailable and empty tokenUsage stay honest", () => {
  const empty = adaptUsageModel({});
  assert.equal(empty.hasEvidence, false);
  assert.equal(empty.callout.title, "Data unavailable");
  assert.equal(empty.measured, "Data unavailable");
  assert.match(empty.configured, /No profile token budgets/);
  assert.equal(empty.runs.length, 0);

  const blankUsage = adaptUsageModel({
    dashboard: { recentRuns: [{ agentId: "cursor", tokenUsage: {} }] }
  });
  assert.equal(blankUsage.hasEvidence, false);
  assert.equal(blankUsage.runs.length, 0);
  assert.match(formatUsageLines({
    dashboard: { recentRuns: [{ agentId: "cursor", tokenUsage: {} }] }
  }).join("\n"), /No auditable run tokenUsage/);
});

test("partial tokenUsage shows only present finite fields; zero kept", () => {
  assert.equal(formatRunUsageLabel({ agentId: "a", tokenUsage: { input: 10 } }), "a · in 10");
  assert.equal(
    formatRunUsageLabel({ agentId: "a", tokenUsage: { input: 10, output: 5 } }),
    "a · in 10 · out 5"
  );
  assert.equal(formatRunUsageLabel({ agentId: "a", tokenUsage: { total: 15 } }), "a · total 15");
  assert.equal(formatRunUsageLabel({ agentId: "a", tokenUsage: { input: 0 } }), "a · in 0");
  assert.equal(formatRunUsageLabel({ agentId: "a", tokenUsage: {} }), null);
  assert.equal(adaptUsageModel({
    snapshot: { budgets: { stableUsedTokens: 9 } }
  }).measured, "Data unavailable");

  const inputOnly = adaptUsageModel({
    dashboard: { recentRuns: [{ agentId: "codex", tokenUsage: { input: 10 } }] }
  });
  assert.equal(inputOnly.runs[0].label, "codex · in 10");
  assert.doesNotMatch(inputOnly.runs[0].label, /total|out /);
  assert.equal(inputOnly.hasEvidence, true);
  assert.equal(inputOnly.callout.title, "Usage evidence available");
});

test("Callout is status only; Measured owns the value", () => {
  const model = adaptUsageModel({
    snapshot: {
      budgets: {
        stableUsedTokens: 100, stableBudgetTokens: 1000,
        requestUsedTokens: 20, requestBudgetTokens: 500
      }
    }
  });
  assert.match(model.measured, /stable 100\/1000 · request 20\/500/);
  assert.equal(model.callout.title, "Usage evidence available");
  assert.notEqual(model.callout.title, model.measured);
  assert.doesNotMatch(model.callout.title, /stable |request /);
});

test("real profile shape and measured budgets; never invent totals", () => {
  const model = adaptUsageModel({
    snapshot: {
      budgets: {
        stableUsedTokens: 100, stableBudgetTokens: 1000,
        requestUsedTokens: 20, requestBudgetTokens: 500
      }
    },
    dashboard: {
      profile: {
        profile: { tokenBudget: 8000, stableContextBudget: 4000 },
        sources: { global: "/home/.harness/profile.json", project: null }
      },
      recentRuns: [{ agentId: "codex", tokenUsage: { input: 10, output: 5, total: 15 } }]
    }
  });
  assert.match(model.measured, /stable 100\/1000 · request 20\/500/);
  assert.match(model.configured, /token 8000 · stable 4000/);
  assert.match(model.runs[0].label, /codex · in 10 · out 5 · total 15/);
  assert.doesNotMatch([model.measured, model.configured, model.footnote].join("\n"), /saved|cost|\$/i);
  assert.deepEqual(formatUsageLines({
    snapshot: { budgets: {
      stableUsedTokens: 100, stableBudgetTokens: 1000,
      requestUsedTokens: 20, requestBudgetTokens: 500
    } },
    dashboard: {
      profile: { profile: { tokenBudget: 8000, stableContextBudget: 4000 } },
      recentRuns: [{ agentId: "codex", tokenUsage: { input: 10, output: 5, total: 15 } }]
    }
  }).slice(0, 2), ["MEASURED", "stable 100/1000 · request 20/500"]);
});

test("run caps compact 3 / wide 8 with remainder; no focus marks or IDs", () => {
  assert.equal(usageRunLimit(LAYOUT_MODES.COMPACT), 3);
  assert.equal(usageRunLimit(LAYOUT_MODES.WIDE), 8);
  const runs = manyRuns(10);
  const compact = adaptUsageModel({
    dashboard: { recentRuns: runs }, layoutMode: LAYOUT_MODES.COMPACT
  });
  assert.equal(compact.runs.length, 3);
  assert.equal(compact.runTotal, 10);
  assert.equal(compact.moreLine, "… 7 more");
  assert.doesNotMatch(compact.runs.map((r) => r.label).join("\n"), /run_|alt-/);

  const wide = adaptUsageModel({
    dashboard: { recentRuns: runs }, layoutMode: LAYOUT_MODES.WIDE
  });
  assert.equal(wide.runs.length, 8);
  assert.equal(wide.moreLine, "… 2 more");

  const list = ActionList({
    items: compact.runs, selectedIndex: -1, focused: true, unicode: false
  });
  assert.equal(focusCount(list), 0);

  const panel = SemanticUsagePanel({
    dashboard: { recentRuns: runs.slice(0, 2) },
    colorEnabled: false, unicode: false
  });
  const kids = Array.isArray(panel.props.children) ? panel.props.children : [panel.props.children];
  const listEl = kids.find((c) => c?.type?.name === "ActionList");
  assert.equal(listEl.props.focused, false);
  assert.equal(listEl.props.selectedIndex, -1);
});
