import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessHomePaths } from "../src/global/paths.js";
import { ALERT_STATES, createAlert, createAlertFingerprint } from "../src/global/runtime/alerts/alert-types.js";
import { ALERT_VALIDATION_ERROR_CODES, assertAlertSecretFree } from "../src/global/runtime/alerts/alert-validate.js";
import { dismissAlert, listAlerts, resolveAlert, saveAlert } from "../src/global/runtime/alerts/alert-store.js";
import { formatAlertDetailLines, formatAlertListLines, formatAlertsHeadline } from "../src/global/ink/cockpit-alerts.js";

test("alert contracts reject secrets; store dedupes and resolves", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-alerts-"));
  assert.equal(harnessHomePaths(homeDir).alertsDir, join(homeDir, ".harness", "alerts"));
  const base = createAlert({ kind: "run.failed", title: "Codex failed", source: "runtime" });
  assert.throws(
    () => assertAlertSecretFree({ ...base, stdout: "leak" }),
    (e) => e.code === ALERT_VALIDATION_ERROR_CODES.FORBIDDEN_FIELD
  );

  const first = await saveAlert({
    kind: "monitor.drift", title: "Drift detected", summary: "Changed.", source: "cockpit"
  }, { homeDir });
  assert.equal(first.deduped, false);
  const disk = JSON.parse(await readFile(
    join(homeDir, ".harness", "alerts", first.alert.alertId, "alert.json"), "utf8"
  ));
  assert.equal(disk.fingerprint, createAlertFingerprint({
    kind: "monitor.drift", source: "cockpit", title: "Drift detected"
  }));
  assert.equal(disk.stdout, undefined);

  const again = await saveAlert({
    kind: "monitor.drift", title: "Drift detected", source: "cockpit"
  }, { homeDir });
  assert.equal(again.deduped, true);
  assert.equal(again.alert.alertId, first.alert.alertId);
  assert.equal((await listAlerts({ homeDir, state: ALERT_STATES.OPEN })).length, 1);

  assert.equal((await resolveAlert(first.alert.alertId, { homeDir })).state, ALERT_STATES.RESOLVED);
  const reopened = await saveAlert({
    kind: "monitor.drift", title: "Drift detected", source: "cockpit"
  }, { homeDir });
  assert.equal(reopened.deduped, false);
  assert.equal((await dismissAlert(reopened.alert.alertId, { homeDir })).state, ALERT_STATES.DISMISSED);
});

test("inbox formatting hides ids until detail", () => {
  assert.equal(formatAlertsHeadline(null).headline, "Alert data unavailable");
  assert.equal(formatAlertsHeadline([]).headline, "None pending");
  const alert = createAlert({ kind: "x", title: "Need attention", severity: "high" });
  assert.match(formatAlertListLines([alert])[0], /high · Need attention/);
  assert.doesNotMatch(formatAlertListLines([alert])[0], /alt-/);
  assert.match(formatAlertDetailLines(alert).join("\n"), /Id · alt-/);
});
