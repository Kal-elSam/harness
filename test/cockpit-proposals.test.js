import test from "node:test";
import assert from "node:assert/strict";
import {
  formatProposalBudgetLine,
  formatProposalEvidenceSource,
  formatProposalLines,
  proposalLimitForLayout
} from "../src/global/ink/cockpit-proposals.js";
import { buildControlCenterModel } from "../src/global/ink/cockpit-control-center.js";
import { formatChangesActionLines } from "../src/global/ink/cockpit-changes.js";
import { CONTROL_PLANE_HEALTH } from "../src/global/control-plane-snapshot.js";

const SAMPLE = [
  {
    id: "setup-local",
    severity: "high",
    title: "Finish local setup",
    detail: "Configure ecosystem",
    destination: "setup",
    evidence: [
      { type: "status", source: "status.overall", ref: "missing" },
      { type: "health", source: "control-plane.health", ref: "NOT_CONFIGURED" }
    ]
  },
  {
    id: "external-graphify-graph-json",
    severity: "low",
    title: "Review external integration: graphify:graph.json",
    detail: "stale",
    destination: "modules",
    evidence: [{ type: "check", source: "status.checks.graphify:graph.json", ref: "warning" }]
  }
];

test("proposal lines expose severity destination and evidence sources only", () => {
  const lines = formatProposalLines(SAMPLE, {
    budgets: {
      stableUsedTokens: 12,
      stableBudgetTokens: 40,
      requestUsedTokens: 5,
      requestBudgetTokens: 20
    }
  });

  assert.match(lines[0], /Proposals · 2\/2/);
  assert.match(lines.join("\n"), /Budget · stable 12\/40 · request 5\/20/);
  assert.match(lines.join("\n"), /\[HIGH\] Finish local setup → setup/);
  assert.match(lines.join("\n"), /evidence: status\.overall · control-plane\.health/);
  assert.equal(lines.join("\n").includes("Configure ecosystem"), false);
  assert.equal(lines.join("\n").includes("missing"), false);
});

test("layout limits and destination filter keep essential info across modes", () => {
  assert.equal(proposalLimitForLayout("wide"), 6);
  assert.equal(proposalLimitForLayout("compact"), 4);
  assert.equal(proposalLimitForLayout("minimal"), 3);

  const setupOnly = formatProposalLines(SAMPLE, {
    destinationFilter: "setup",
    limit: proposalLimitForLayout("minimal")
  });
  assert.match(setupOnly.join("\n"), /Finish local setup → setup/);
  assert.equal(setupOnly.join("\n").includes("graphify"), false);

  assert.equal(formatProposalEvidenceSource([]), null);
  assert.equal(formatProposalBudgetLine(null), null);
});

test("control center model includes proposal lines without dumping sensitive refs", () => {
  const model = buildControlCenterModel({
    projectName: "demo",
    layoutMode: "minimal",
    snapshot: {
      health: CONTROL_PLANE_HEALTH.NOT_CONFIGURED,
      coverage: { governedAgents: 0, detectedAgents: 0, components: 0, activeModules: [] },
      backups: { count: 0 },
      policy: { profile: "safe", applyMode: "confirm" },
      status: { counts: { warning: 0 }, checks: [] },
      diff: { hasChanges: false },
      cta: { kind: "setup", title: "Finish local setup", detail: "Run setup", destination: "setup" },
      proposals: SAMPLE,
      budgets: {
        stableUsedTokens: 1,
        stableBudgetTokens: 10,
        requestUsedTokens: 0,
        requestBudgetTokens: 10
      }
    }
  });

  assert.match(model.title, /OVERVIEW/);
  assert.match(model.nextAction.actionTitle, /Finish local setup/);
  assert.match(model.tokens.headline, /stable 1\/10/);
  assert.equal(model.proposalLines.length, 0);
  assert.match(model.runsSecondaryHint, /Enter|actions/i);
});

test("governance lines prioritize status coverage and CTA over proposal dumps", () => {
  const lines = formatChangesActionLines({
    layoutMode: "compact",
    snapshot: {
      health: "ACTION_REQUIRED",
      coverage: { governedAgents: 0, detectedAgents: 2, components: 1 },
      cta: { title: "Finish local setup", detail: "Run setup", destination: "changes" },
      proposals: SAMPLE,
      diff: { installed: true, hasChanges: false, summary: "No pending governance changes." }
    },
    changesAction: { phase: "idle", message: null, error: null, preview: null, receipt: null }
  });

  assert.match(lines.join("\n"), /STATUS/);
  assert.match(lines.join("\n"), /Finish local setup/);
  assert.doesNotMatch(lines.join("\n"), /Proposals ·/);
  assert.doesNotMatch(lines.join("\n"), /evidence:/);
  assert.equal(lines.join("\n").includes("graphify"), false);
});
