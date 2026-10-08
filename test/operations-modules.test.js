import assert from "node:assert/strict";
import { test } from "node:test";
import * as scan from "../src/global/operations/scan-bundle.js";
import * as settings from "../src/global/operations/settings-model.js";
import * as recovery from "../src/global/operations/recovery-model.js";
import * as pathLabel from "../src/global/operations/path-label.js";

test("operations modules keep their public surface", () => {
  for (const name of ["loadCockpitScanBundle", "createSerializedReloader", "CONTROL_PLANE_AUTO_SCAN"]) assert.ok(name in scan, name);
  for (const name of ["reduceSettingsAction", "getCuratedIntegration", "listCuratedIntegrations", "formatSettingsLines", "createSettingsActionState"]) assert.ok(name in settings, name);
  for (const name of ["listRecoverySnapshots", "reduceRecoveryAction", "RECOVERY_PHASE"]) assert.ok(name in recovery, name);
  assert.equal(typeof pathLabel.formatConfirmPath, "function");
});
