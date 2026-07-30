import test from "node:test";
import assert from "node:assert/strict";
import {
  SETTINGS_PHASE,
  buildSettingsFooterParts,
  createSettingsActionState,
  formatSettingsDetailLines,
  formatSettingsLines,
  getCuratedIntegration,
  listCuratedIntegrations,
  reduceSettingsAction
} from "../src/global/ink/cockpit-settings.js";
import { buildFooterModel, windowLinesForLayout } from "../src/global/ink/cockpit-models.js";
import { isContentInteractiveView } from "../src/global/ink/cockpit-focus.js";
import { ORCHESTRATOR_VIEWS } from "../src/global/ink/orchestrator-state.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";

test("catalog pins pi-usage-widget@0.2.1; install never implied", () => {
  const catalog = listCuratedIntegrations();
  assert.equal(catalog.length, 1);
  const entry = getCuratedIntegration("pi-usage-widget");
  assert.equal(entry?.version, "0.2.1");
  assert.equal(entry?.license, "MIT");
  assert.match(entry?.notes ?? "", /Explicit install only/i);
  assert.ok(entry?.permissions.includes("full-local-access-on-install"));
});

test("browse → preview → confirm → receipt; wroteFiles stays false", () => {
  let state = createSettingsActionState();
  assert.equal(state.phase, SETTINGS_PHASE.BROWSE);

  state = reduceSettingsAction(state, { type: "preview", id: "missing" });
  assert.equal(state.phase, SETTINGS_PHASE.BROWSE);
  assert.match(state.message ?? "", /not found/i);

  state = reduceSettingsAction(state, { type: "preview", id: "pi-usage-widget" });
  assert.equal(state.phase, SETTINGS_PHASE.PREVIEW);
  assert.equal(state.selectedId, "pi-usage-widget");
  assert.equal(state.receipt, null);

  assert.equal(
    reduceSettingsAction(state, { type: "confirm" }).phase,
    SETTINGS_PHASE.PREVIEW
  );

  state = reduceSettingsAction(state, { type: "confirm-prompt" });
  assert.equal(state.phase, SETTINGS_PHASE.CONFIRMING);

  const cancel = reduceSettingsAction(state, { type: "cancel" });
  assert.equal(cancel.phase, SETTINGS_PHASE.BROWSE);
  assert.equal(cancel.selectedId, null);
  assert.match(cancel.message ?? "", /no files written/i);

  state = reduceSettingsAction(state, { type: "confirm" });
  assert.equal(state.phase, SETTINGS_PHASE.COMPLETED);
  assert.equal(state.receipt?.wroteFiles, false);
  assert.equal(state.receipt?.id, "pi-usage-widget");
  assert.equal(state.receipt?.version, "0.2.1");
  assert.ok(state.receipt?.confirmedAt);

  const detail = formatSettingsDetailLines(
    getCuratedIntegration("pi-usage-widget"),
    state
  );
  const detailText = detail.join("\n");
  assert.match(detailText, /wroteFiles · false/);
  assert.match(detailText, /no auto-install/i);
  assert.doesNotMatch(detailText, /wroteFiles · true/);
  assert.equal(detail[0], "RESULT");
  assert.match(detail[3] ?? "", /wroteFiles · false/);
});

test("completed receipt stays above compact TTY fold", () => {
  const completed = reduceSettingsAction(
    reduceSettingsAction(
      reduceSettingsAction(createSettingsActionState(), {
        type: "preview",
        id: "pi-usage-widget"
      }),
      { type: "confirm-prompt" }
    ),
    { type: "confirm" }
  );
  const lines = formatSettingsDetailLines(
    getCuratedIntegration("pi-usage-widget"),
    completed
  );
  const windowed = windowLinesForLayout(lines, LAYOUT_MODES.COMPACT);
  const visible = windowed.items.join("\n");
  assert.match(visible, /wroteFiles · false/);
  assert.match(visible, /^RESULT/m);
  assert.ok(lines.length <= 8, `completed view should fit fold (${lines.length})`);
  assert.equal(windowed.moreLine, null);
});

test("footer phase-scoped; PROFILE content-interactive; browse marks selection", () => {
  assert.deepEqual(buildSettingsFooterParts(SETTINGS_PHASE.CONFIRMING), [
    "Y Confirm",
    "N/Esc Cancel"
  ]);
  const footer = buildFooterModel({
    view: ORCHESTRATOR_VIEWS.PROFILE,
    settingsPhase: SETTINGS_PHASE.CONFIRMING,
    unicode: false
  });
  assert.match(footer.text, /Y Confirm/);
  assert.doesNotMatch(footer.text, /Enter Preview/);

  assert.equal(isContentInteractiveView(ORCHESTRATOR_VIEWS.PROFILE), true);

  const browse = formatSettingsLines({ listIndex: 0 }).join("\n");
  assert.match(browse, /› available · Pi usage widget · 0\.2\.1/);
  assert.match(browse, /Selected · pi-usage-widget/);
  assert.match(browse, /never automatic/i);
});
