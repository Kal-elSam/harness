import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleContextBundle } from "../src/global/kernel/context-bundle.js";

test("each bundle item names its owner", () => {
  const bundle = assembleContextBundle({
    pi: { refs: ["session"] },
    engram: { refs: ["obs-1"] },
    codegraph: { refs: ["src/cli.js"] },
    gentleAi: { refs: ["sdd"] },
    kairo: { refs: ["team"] },
    budgetTokens: 800
  });
  assert.deepEqual(bundle.sources.map((source) => source.owner), ["pi", "engram", "codegraph", "gentle-ai", "kairo"]);
  assert.equal(bundle.budgetTokens, 800);
});

test("missing Engram omits memory rather than inventing it", () => {
  const bundle = assembleContextBundle({
    pi: { refs: ["session"] },
    engram: null,
    kairo: { refs: ["team"] }
  });
  assert.equal(bundle.sources.some((source) => source.owner === "engram"), false);
  assert.ok(bundle.sources.some((source) => source.owner === "pi"));
});
