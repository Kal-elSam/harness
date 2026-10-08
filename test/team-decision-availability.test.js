import test from "node:test";
import assert from "node:assert/strict";
import { explainTeamDecision } from "../src/global/conversation/team-decision.js";
import { resolveAssignmentAvailability } from "../src/global/conversation/assignment-availability.js";

// Ported unchanged from the retired legacy cockpit view test: these exercise the
// UI-free modules directly (the view only re-exported them).

test("INC4: explainTeamDecision for reason:null + decisionType:leader yields a non-empty role-specific description", () => {
  const text = explainTeamDecision({
    role: "Builder",
    reason: null,
    assignmentSource: "recommended",
    decisionEvidence: { decisionType: "leader", requiredFloor: 0.8, riskLevel: "medium", retention: 1 }
  });
  assert.ok(text && text.trim().length > 0, "leader with null reason must never render an empty description");
  assert.match(text, /Ranked first for coding capability/);
  assert.match(text, /80% capability floor/);
  assert.match(text, /medium-risk role/);
  assert.doesNotMatch(text, /no cheaper alternative existed/i);
});

test("INC4: explainTeamDecision degrades when requiredFloor/riskLevel are null", () => {
  const text = explainTeamDecision({
    role: "Architect",
    reason: null,
    decisionEvidence: { decisionType: "leader", requiredFloor: null, riskLevel: null }
  });
  assert.match(text, /Ranked first for general reasoning capability among eligible candidates/);
  assert.doesNotMatch(text, /capability floor/);
});

test("INC4: explainTeamDecision prefers existing reason and keeps override text", () => {
  assert.equal(
    explainTeamDecision({ role: "Builder", reason: "Chosen for lower real price.", decisionEvidence: { decisionType: "pareto" } }),
    "Chosen for lower real price."
  );
  assert.equal(
    explainTeamDecision({ role: "Builder", reason: null, assignmentSource: "override", decisionEvidence: null }),
    "Manual override — not the automatic ranking's own pick."
  );
});

test("INC4: resolveAssignmentAvailability — entitlement beats adapter ineligibility; denied uses real reason", () => {
  const model = { adapterId: "claude", modelId: "claude-fable-5-1", displayName: "Fable 5.1" };
  const denied = resolveAssignmentAvailability(model, {
    eligibility: { claude: { ok: false, reason: "quota exhausted" } },
    claudeEntitlement: { "claude-fable-5-1": { status: "denied", reason: "credits_required" } }
  });
  assert.equal(denied.available, false);
  assert.match(denied.warning, /your Claude plan denies this model \(credits_required\)/);
  assert.doesNotMatch(denied.warning, /quota exhausted/);

  const ineligible = resolveAssignmentAvailability(
    { adapterId: "codex", modelId: "gpt-6-astra" },
    { eligibility: { codex: { ok: false, reason: "rate limited" } }, claudeEntitlement: {} }
  );
  assert.equal(ineligible.available, false);
  assert.equal(ineligible.warning, "Unavailable — rate limited");
});

test("REGRESSION: resolveAssignmentAvailability's real Cursor branch — available/exhausted/unverified per pool, auto always available, adapter-level eligibility never overrides a real pool block", () => {
  const composer = { adapterId: "cursor", modelId: "composer-2.5", displayName: "Composer 2.5" };
  const fableViaCursor = { adapterId: "cursor", modelId: "claude-fable-5-1", displayName: "Fable 5.1" };
  const auto = { adapterId: "cursor", modelId: "auto", displayName: "Auto (current, default)" };

  const available = resolveAssignmentAvailability(composer, {
    eligibility: { cursor: { ok: true } },
    cursorAccess: { cursor_models: { status: "available", reason: null }, other_models: { status: "unverified", reason: null } }
  });
  assert.equal(available.available, true);

  const exhausted = resolveAssignmentAvailability(fableViaCursor, {
    eligibility: { cursor: { ok: true } },
    cursorAccess: { cursor_models: { status: "available", reason: null }, other_models: { status: "exhausted", reason: "monthly limit" } }
  });
  assert.equal(exhausted.available, false);
  // Cursor classifies ANY limit text (rate limit, usage limit, monthly
  // limit) as its internal EXHAUSTED status, so the visible warning says
  // "limit reached" and quotes Cursor's own reason, never "exhausted".
  assert.match(exhausted.warning, /Other Models limit reached \(monthly limit\)/);
  assert.doesNotMatch(exhausted.warning, /exhaust/i);

  const unverified = resolveAssignmentAvailability(fableViaCursor, {
    eligibility: { cursor: { ok: true } },
    cursorAccess: {}
  });
  assert.equal(unverified.available, false);
  assert.match(unverified.warning, /could not be verified automatically/);

  const autoStaysAvailable = resolveAssignmentAvailability(auto, { eligibility: { cursor: { ok: true } }, cursorAccess: {} });
  assert.equal(autoStaysAvailable.available, true, "auto is never probed/scored — it must never be blocked by a pool it was never part of");
});

test("REGRESSION: resolveAssignmentAvailability surfaces the real Cursor probe error (e.g. 'Authentication required') instead of a generic 'could not be verified' message", () => {
  const composer = { adapterId: "cursor", modelId: "composer-2.5", displayName: "Composer 2.5" };
  const unverifiedWithRealReason = resolveAssignmentAvailability(composer, {
    eligibility: { cursor: { ok: true } },
    cursorAccess: { cursor_models: { status: "unverified", reason: "cursor-agent exited 1: Authentication required" } }
  });
  assert.equal(unverifiedWithRealReason.available, false);
  assert.match(unverifiedWithRealReason.warning, /Authentication required/, "the real probe error must surface — Kairo can detect Cursor isn't authenticated but can't fix it automatically, so it must say so honestly");

  // No real reason was ever captured (e.g. no pool entry at all) — the
  // honest generic fallback stays, never a fabricated one.
  const unverifiedNoReason = resolveAssignmentAvailability(composer, {
    eligibility: { cursor: { ok: true } },
    cursorAccess: {}
  });
  assert.match(unverifiedNoReason.warning, /could not be verified automatically/);
});
