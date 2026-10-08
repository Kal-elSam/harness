import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatEngineModelLabel,
  kairoSetModelCommand,
  pickNextKairoModel
} from "../src/global/host/pi-rpc-kairo-models.js";

test("pickNextKairoModel cycles projectTeam routes only", () => {
  const models = [
    { id: "a::1", name: "One" },
    { id: "b::2", name: "Two" }
  ];
  assert.equal(pickNextKairoModel(models, "a::1")?.id, "b::2");
  assert.equal(pickNextKairoModel(models, "b::2")?.id, "a::1");
  assert.equal(pickNextKairoModel(models, "missing")?.id, "a::1");
});

test("kairoSetModelCommand uses kairo provider only", () => {
  assert.deepEqual(kairoSetModelCommand({ id: "codex::x" }), {
    type: "set_model",
    provider: "kairo",
    modelId: "codex::x"
  });
});

test("formatEngineModelLabel prefers name plus id", () => {
  assert.match(
    formatEngineModelLabel({ id: "codex::m1", name: "Architect route" }),
    /Architect route/
  );
  assert.equal(formatEngineModelLabel(null), "no model");
});
