import test from "node:test";
import assert from "node:assert/strict";
import { resolveLayoutMode, resolveListLimit, LAYOUT_MODES } from "../src/global/ink/layout.js";
import { windowList } from "../src/global/ink/list-window.js";

test("resolveLayoutMode wide compact minimal and below gate", () => {
  assert.equal(resolveLayoutMode({ columns: 120, rows: 40 }), LAYOUT_MODES.WIDE);
  assert.equal(resolveLayoutMode({ columns: 100, rows: 28 }), LAYOUT_MODES.WIDE);
  assert.equal(resolveLayoutMode({ columns: 80, rows: 24 }), LAYOUT_MODES.COMPACT);
  assert.equal(resolveLayoutMode({ columns: 72, rows: 20 }), LAYOUT_MODES.COMPACT);
  assert.equal(resolveLayoutMode({ columns: 70, rows: 24 }), LAYOUT_MODES.MINIMAL);
  assert.equal(resolveLayoutMode({ columns: 80, rows: 18 }), LAYOUT_MODES.MINIMAL);
  assert.equal(resolveLayoutMode({ columns: 60, rows: 20 }), LAYOUT_MODES.MINIMAL);
  assert.equal(resolveLayoutMode({ columns: 59, rows: 40 }), null);
  assert.equal(resolveLayoutMode({ columns: 0, rows: 40 }), null);
});

test("resolveListLimit scales by layout", () => {
  assert.ok(resolveListLimit(LAYOUT_MODES.WIDE, { contentRows: 20 }) >= resolveListLimit(LAYOUT_MODES.MINIMAL, { contentRows: 20 }));
  assert.equal(resolveListLimit(null), 4);
});

test("windowList truncates with more indicator", () => {
  const items = ["a", "b", "c", "d", "e"];
  const windowed = windowList(items, 3);
  assert.deepEqual(windowed.items, ["a", "b", "c"]);
  assert.equal(windowed.hasMore, true);
  assert.equal(windowed.hiddenCount, 2);
  assert.match(windowed.moreLine, /… more \(2\)/);

  const full = windowList(items, 10);
  assert.equal(full.hasMore, false);
  assert.equal(full.moreLine, null);
});
