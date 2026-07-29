import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessHomePaths } from "../src/global/paths.js";
import {
  ALERT_STATES,
  createAlert,
  createAlertFingerprint
} from "../src/global/runtime/alerts/alert-types.js";
import {
  ALERT_VALIDATION_ERROR_CODES,
  assertAlertSecretFree
} from "../src/global/runtime/alerts/alert-validate.js";
import {
  AlertStoreError,
  dismissAlert,
  listAlerts,
  resolveAlert,
  saveAlert
} from "../src/global/runtime/alerts/alert-store.js";
import {
  formatAlertDetailLines,
  formatAlertListLines,
  formatAlertsHeadline
} from "../src/global/ink/cockpit-alerts.js";

test("validation is fail-closed for nested secrets and fingerprint mismatch", () => {
  const base = createAlert({ kind: "run.failed", title: "Codex failed", source: "runtime" });
  assert.throws(
    () => assertAlertSecretFree({ ...base, summary: { stdout: "SECRET" } }),
    (e) => e.code === ALERT_VALIDATION_ERROR_CODES.FORBIDDEN_FIELD
      || e.code === ALERT_VALIDATION_ERROR_CODES.INVALID_ALERT
  );
  assert.throws(
    () => assertAlertSecretFree({ ...base, fingerprint: "0".repeat(64) }),
    (e) => e.code === ALERT_VALIDATION_ERROR_CODES.FINGERPRINT_MISMATCH
  );
});

test("saveAlert dedupes concurrent fingerprint claims to one open alert", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-alerts-"));
  const results = await Promise.all(Array.from({ length: 20 }, () => saveAlert({
    kind: "monitor.drift",
    title: "Drift detected",
    source: "cockpit"
  }, { homeDir })));
  const open = await listAlerts({ homeDir, state: ALERT_STATES.OPEN });
  assert.equal(open.length, 1);
  assert.equal(new Set(results.map((r) => r.alert.alertId)).size, 1);
  assert.equal(results.filter((r) => r.deduped).length, 19);
  assert.equal(open[0].fingerprint, createAlertFingerprint({
    kind: "monitor.drift", source: "cockpit", title: "Drift detected"
  }));
});

test("corrupt alert store fails closed instead of empty inbox", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-alerts-"));
  const first = await saveAlert({ kind: "x", title: "ok", source: "t" }, { homeDir });
  const badDir = join(harnessHomePaths(homeDir).alertsDir, "alt-aaaaaaaaaaaaaaaaaaaaaaaa");
  await mkdir(badDir, { recursive: true });
  await writeFile(join(badDir, "alert.json"), "{\"summary\":{\"stdout\":\"SECRET\"}}\n");
  await assert.rejects(
    () => listAlerts({ homeDir }),
    (e) => e instanceof AlertStoreError && e.code === "corrupt_alert"
  );
  assert.equal(formatAlertListLines(null)[0], "Alert data unavailable");
  assert.equal(formatAlertsHeadline(null).headline, "Alert data unavailable");
  assert.doesNotMatch(formatAlertDetailLines(first.alert).join("\n"), /SECRET/);
});

test("resolve writes history and removes authoritative open claim", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-alerts-"));
  const { alert } = await saveAlert({ kind: "x", title: "Need attention", severity: "high" }, { homeDir });
  assert.match(formatAlertListLines([alert])[0], /high · Need attention/);
  assert.doesNotMatch(formatAlertListLines([alert])[0], /alt-/);
  await resolveAlert(alert.alertId, { homeDir });
  assert.equal((await listAlerts({ homeDir, state: ALERT_STATES.OPEN })).length, 0);
  const again = await saveAlert({ kind: "x", title: "Need attention" }, { homeDir });
  assert.equal(again.deduped, false);
  await dismissAlert(again.alert.alertId, { homeDir });
});

test("open/<fingerprint> alone is authoritative without alert.json", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-alerts-"));
  const claim = createAlert({ kind: "orphan", title: "Crash window", source: "test" });
  const openDir = join(harnessHomePaths(homeDir).alertsDir, "open");
  await mkdir(openDir, { recursive: true });
  await writeFile(join(openDir, claim.fingerprint), `${JSON.stringify(claim, null, 2)}\n`);

  assert.equal((await listAlerts({ homeDir, state: ALERT_STATES.OPEN })).length, 1);
  const result = await saveAlert({
    kind: "orphan", title: "Crash window", source: "test"
  }, { homeDir });
  assert.equal(result.deduped, true);
  assert.equal(result.alert.alertId, claim.alertId);
});

test("dead-owner style planted claim + 20 concurrent saves keep one open", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-alerts-"));
  const { alert } = await saveAlert({ kind: "stale", title: "Done once", source: "test" }, { homeDir });
  await resolveAlert(alert.alertId, { homeDir });
  const openDir = join(harnessHomePaths(homeDir).alertsDir, "open");
  await mkdir(openDir, { recursive: true });
  await writeFile(join(openDir, alert.fingerprint), `${JSON.stringify(alert, null, 2)}\n`);

  const results = await Promise.all(Array.from({ length: 20 }, () => saveAlert({
    kind: "stale", title: "Done once", source: "test"
  }, { homeDir })));
  assert.equal(results.length, 20);
  assert.equal(results.every((r) => r.deduped), true);
  assert.equal(new Set(results.map((r) => r.alert.alertId)).size, 1);
  assert.equal(results[0].alert.alertId, alert.alertId);
  assert.equal((await listAlerts({ homeDir, state: ALERT_STATES.OPEN })).length, 1);
});
