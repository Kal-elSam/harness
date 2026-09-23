import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAssignmentAvailability } from "../src/global/conversation/assignment-availability.js";
import { ENTITLEMENT } from "../src/global/observability/claude-model-entitlement.js";

test("resolveAssignmentAvailability marks a denied Claude entitlement unavailable with a real warning", () => {
  const model = { adapterId: "claude", modelId: "claude-opus-5" };
  const result = resolveAssignmentAvailability(model, {
    claudeEntitlement: { "claude-opus-5": { status: ENTITLEMENT.DENIED, reason: "plan tier too low" } }
  });

  assert.deepEqual(result, {
    available: false,
    warning: "Unavailable — your Claude plan denies this model (plan tier too low)"
  });
});

test("resolveAssignmentAvailability marks an eligible model available with no warning", () => {
  const model = { adapterId: "codex", modelId: "gpt-6-terra" };
  const result = resolveAssignmentAvailability(model, { eligibility: { codex: { ok: true } } });

  assert.deepEqual(result, { available: true, warning: null });
});

test("resolveAssignmentAvailability returns unavailable with no warning when no model is assigned", () => {
  assert.deepEqual(resolveAssignmentAvailability(null), { available: false, warning: null });
});
