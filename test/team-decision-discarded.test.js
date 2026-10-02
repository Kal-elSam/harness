import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatDiscardedAlternatives,
  formatEligibilityExclusions,
  formatRoleDiscarded
} from "../src/global/conversation/team-decision.js";
import { buildKairoWorkspaceSnapshot } from "../src/global/host/workspace-snapshot.js";

test("formatDiscardedAlternatives lists concentration-blocked peers with Spanish causes", () => {
  const lines = formatDiscardedAlternatives({
    evaluated: [
      { adapterId: "claude", modelId: "claude-opus-5", blockedBy: null },
      { adapterId: "claude", modelId: "claude-sonnet-5", blockedBy: "model_cap" },
      { adapterId: "cursor", modelId: "composer-2", blockedBy: "provider_cap" },
      { adapterId: "codex", modelId: "gpt-5", blockedBy: "reviewer_independence" },
      { adapterId: "claude", modelId: "claude-sonnet-5", blockedBy: "model_cap" }
    ]
  });
  assert.deepEqual(lines, [
    "Claude · claude-sonnet-5 — límite de concentración del modelo",
    "Cursor · composer-2 — límite técnico del proveedor",
    "Codex · gpt-5 — independencia Builder/Reviewer"
  ]);
});

test("formatDiscardedAlternatives is empty when selection has no blocked peers", () => {
  assert.deepEqual(formatDiscardedAlternatives(null), []);
  assert.deepEqual(formatDiscardedAlternatives({ evaluated: [] }), []);
  assert.deepEqual(
    formatDiscardedAlternatives({ evaluated: [{ adapterId: "claude", modelId: "x", blockedBy: null }] }),
    []
  );
});

test("formatEligibilityExclusions surfaces real cuota / Go limit / Cursor unverified from snapshot evidence", () => {
  const lines = formatEligibilityExclusions({
    eligibility: {
      claude: { ok: false, reason: "Claude primary window limited (0% left)" },
      "opencode-go": { ok: false, reason: "OpenCode Go monthly window is rate-limited" },
      codex: { ok: true, reason: null },
      cursor: { ok: true, reason: null }
    },
    cursorAccess: {
      cursor_models: { status: "unverified", reason: null },
      other_models: { status: "exhausted", reason: "rate limit" }
    }
  });
  assert.deepEqual(lines, [
    "Claude — Claude primary window limited (0% left)",
    "OpenCode Go — OpenCode Go monthly window is rate-limited",
    "Cursor · Cursor models — sin verificar",
    "Cursor · Other models — límite alcanzado (rate limit)"
  ]);
});

test("formatRoleDiscarded merges eligibility exclusions before concentration peers", () => {
  const lines = formatRoleDiscarded(
    { evaluated: [{ adapterId: "claude", modelId: "opus", blockedBy: "model_cap" }] },
    { eligibility: { claude: { ok: false, reason: "Claude primary window limited (0% left)" } }, cursorAccess: {} }
  );
  assert.deepEqual(lines, [
    "Claude — Claude primary window limited (0% left)",
    "Claude · opus — límite de concentración del modelo"
  ]);
});

test("workspace agents carry eligibility Descartados (not only assignment.selection concentration)", () => {
  const snap = buildKairoWorkspaceSnapshot({
    projectRoot: "/repo",
    strategy: {
      status: "suggested",
      projectTeam: [{
        role: "Builder",
        model: { adapterId: "codex", modelId: "gpt-5", displayName: "GPT-5" },
        selection: { evaluated: [] }
      }]
    },
    intelligence: {
      eligibility: {
        claude: { ok: false, reason: "Claude primary window limited (0% left)" },
        cursor: { ok: true, reason: null },
        codex: { ok: true, reason: null }
      },
      cursorAccess: {
        cursor_models: { status: "unverified", reason: null },
        other_models: { status: "unverified", reason: null }
      },
      claudeEntitlement: {}
    }
  });
  const builder = snap.agents.find((a) => a.label === "Builder");
  assert.ok(builder, "Builder agent present");
  assert.ok(builder.discarded.some((line) => line.startsWith("Claude —")), builder.discarded);
  assert.ok(builder.discarded.some((line) => line.includes("Cursor") && line.includes("sin verificar")), builder.discarded);
  const assignment = snap.team.assignments.find((a) => a.role === "Builder");
  assert.deepEqual(assignment.discarded, builder.discarded);
});
