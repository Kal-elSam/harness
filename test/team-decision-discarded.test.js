import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDiscardedAlternatives } from "../src/global/conversation/team-decision.js";

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
