import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPaletteActions,
  buildPaletteModel,
  canOpenPalette,
  PALETTE_KINDS,
  resolvePaletteDestination
} from "../src/global/ink/cockpit-palette.js";
import { buildFooterModel, COCKPIT_NAV, COCKPIT_SECONDARY } from "../src/global/ink/cockpit-models.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";

test("palette model: CTA optional, nav+secondary destinations, Alerts, Refresh, Help; no writes", () => {
  const base = buildPaletteActions();
  const expected = [...COCKPIT_NAV, ...COCKPIT_SECONDARY].map((n) => n.label);
  assert.deepEqual(base.slice(0, expected.length).map((a) => a.label), expected);
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
  assert.equal(resolvePaletteDestination("settings"), ORCHESTRATOR_VIEWS.PROFILE);
  assert.equal(resolvePaletteDestination("history"), ORCHESTRATOR_VIEWS.ACTIVITY);
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

test("palette model: selection resolves destinations and footer hints (reducer retired by U7)", () => {
  const actions = buildPaletteActions();
  assert.match(buildFooterModel({ paletteOpen: true, unicode: false }).text, /Select.*Run.*Close/);
  // Skip Home, Settings, History -> Governance is index 3
  const selected = buildPaletteModel({ actions, index: 3 }).selected;
  assert.equal(selected.id, "governance");
  assert.equal(selected.kind, PALETTE_KINDS.NAVIGATE);
  assert.equal(selected.view, ORCHESTRATOR_VIEWS.CHANGES);
  // Out-of-range indexes clamp to a valid action instead of throwing.
  assert.ok(buildPaletteModel({ actions, index: 999 }).selected);
  assert.ok(buildPaletteModel({ actions, index: -5 }).selected);
});
