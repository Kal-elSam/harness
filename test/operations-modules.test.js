import assert from "node:assert/strict";
import { test } from "node:test";
import * as scan from "../src/global/operations/scan-bundle.js";
import * as settings from "../src/global/operations/settings-model.js";
import * as recovery from "../src/global/operations/recovery-model.js";
import * as pathLabel from "../src/global/operations/path-label.js";
import * as legacyScan from "../src/global/ink/cockpit-scan.js";
import * as legacySettings from "../src/global/ink/cockpit-settings.js";
import * as legacyRecovery from "../src/global/ink/cockpit-recovery.js";
import * as legacyPathLabel from "../src/global/ink/cockpit-path-label.js";

test("operations modules keep their exact public surface and the temporary ink/ shims re-export the same bindings", () => {
  const pairs = [[scan, legacyScan], [settings, legacySettings], [recovery, legacyRecovery], [pathLabel, legacyPathLabel]];
  for (const [neutral, legacy] of pairs) {
    assert.deepEqual(Object.keys(legacy).sort(), Object.keys(neutral).sort());
    for (const key of Object.keys(neutral)) assert.equal(legacy[key], neutral[key], key);
  }
  for (const name of ["loadCockpitScanBundle", "createSerializedReloader", "CONTROL_PLANE_AUTO_SCAN"]) assert.ok(name in scan, name);
  for (const name of ["reduceSettingsAction", "getCuratedIntegration", "listCuratedIntegrations", "formatSettingsLines", "createSettingsActionState"]) assert.ok(name in settings, name);
  for (const name of ["listRecoverySnapshots", "reduceRecoveryAction", "RECOVERY_PHASE"]) assert.ok(name in recovery, name);
  assert.equal(typeof pathLabel.formatConfirmPath, "function");
});
