import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPaletteActions,
  buildPaletteModel,
  canOpenPalette,
  PALETTE_KINDS,
  resolvePaletteDestination
} from "../src/global/ink/cockpit-palette.js";
import { createCockpitUiState, reduceCockpitUi } from "../src/global/ink/cockpit-controller.js";
import { buildFooterModel, COCKPIT_NAV } from "../src/global/ink/cockpit-models.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";

test("palette model: CTA optional, six destinations, Alerts, Refresh, Help; no writes", () => {
  const base = buildPaletteActions();
  assert.deepEqual(base.slice(0, 6).map((a) => a.label), COCKPIT_NAV.map((n) => n.label));
  assert.equal(base.at(-3).id, "alerts");
  assert.equal(base.at(-3).view, ORCHESTRATOR_VIEWS.ALERTS);
  assert.equal(base.at(-2).kind, PALETTE_KINDS.REFRESH);
  assert.equal(base.at(-1).kind, PALETTE_KINDS.HELP);
  const withCta = buildPaletteActions({
    ctaDestination: "changes",
    ctaTitle: "Review and repair drift"
  });
  assert.equal(withCta[0].id, "recommended");
  assert.equal(withCta[0].view, ORCHESTRATOR_VIEWS.CHANGES);
  assert.equal(withCta.length, base.length + 1);
  assert.equal(resolvePaletteDestination("bogus"), null);
  const withSetup = buildPaletteActions({
    ctaDestination: "setup",
    ctaTitle: "Finish local setup"
  });
  assert.equal(withSetup[0].kind, PALETTE_KINDS.SETUP);
  assert.equal(withSetup[0].view, null);
  assert.deepEqual(
    [...new Set(withCta.map((a) => a.kind))].sort(),
    ["help", "navigate", "refresh"]
  );
  assert.equal(canOpenPalette({ confirming: true }), false);
  assert.equal(canOpenPalette({}), true);
});

test("palette reducer + integration: open, clamp, Esc, resize, navigate/refresh/help", () => {
  const actions = buildPaletteActions();
  let state = createCockpitUiState({ view: ORCHESTRATOR_VIEWS.USAGE, navIndex: 4 });
  state = reduceCockpitUi(state, { type: "toggle-palette" });
  assert.equal(state.paletteOpen, true);
  state = reduceCockpitUi(state, { type: "palette-arrow", direction: "up", listLength: 8 });
  assert.equal(state.paletteIndex, 0);
  state = reduceCockpitUi(state, { type: "palette-arrow", direction: "down", listLength: 2 });
  assert.equal(state.paletteIndex, 1);
  state = reduceCockpitUi(state, { type: "resize", layoutMode: LAYOUT_MODES.WIDE });
  assert.equal(state.paletteOpen, true);
  state = reduceCockpitUi(state, { type: "escape" });
  assert.equal(state.paletteOpen, false);
  assert.equal(state.view, ORCHESTRATOR_VIEWS.USAGE);
  assert.match(buildFooterModel({ paletteOpen: true, unicode: false }).text, /Select.*Run.*Close/);

  state = reduceCockpitUi(state, { type: "toggle-palette" });
  state = reduceCockpitUi(state, { type: "palette-arrow", direction: "down", listLength: actions.length });
  const selected = buildPaletteModel({ actions, index: state.paletteIndex }).selected;
  assert.equal(selected.id, "governance");
  state = reduceCockpitUi(state, { type: "run-palette", kind: selected.kind, view: selected.view });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.CHANGES);
  assert.equal(state.paletteOpen, false);

  state = reduceCockpitUi(state, { type: "toggle-palette" });
  state = reduceCockpitUi(state, { type: "run-palette", kind: PALETTE_KINDS.REFRESH });
  assert.equal(state.view, ORCHESTRATOR_VIEWS.CHANGES);
  state = reduceCockpitUi(state, { type: "toggle-palette" });
  state = reduceCockpitUi(state, {
    type: "run-palette",
    kind: PALETTE_KINDS.HELP,
    view: ORCHESTRATOR_VIEWS.HELP
  });
  assert.equal(state.helpOpen, true);
  assert.equal(state.view, ORCHESTRATOR_VIEWS.HELP);
});
