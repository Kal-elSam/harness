import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
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
  UNSAFE_OPERATIONS,
  authorizeUnsafeOperation
} from "../src/global/runtime/run-permissions.js";
import {
  formatAlertDetailLines,
  formatAlertListLines,
  formatAlertsHeadline
} from "../src/global/ink/cockpit-alerts.js";

const alertPa = (operation, source = "cli") => authorizeUnsafeOperation({
  operation, confirmed: true, source
}).permissionAuthority;

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
  await resolveAlert(alert.alertId, {
    homeDir, permissionAuthority: alertPa(UNSAFE_OPERATIONS.ALERT_RESOLVE)
  });
  assert.equal((await listAlerts({ homeDir, state: ALERT_STATES.OPEN })).length, 0);
  const again = await saveAlert({ kind: "x", title: "Need attention" }, { homeDir });
  assert.equal(again.deduped, false);
  await dismissAlert(again.alert.alertId, {
    homeDir, permissionAuthority: alertPa(UNSAFE_OPERATIONS.ALERT_DISMISS)
  });
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
  await resolveAlert(alert.alertId, {
    homeDir, permissionAuthority: alertPa(UNSAFE_OPERATIONS.ALERT_RESOLVE)
  });
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

test("concurrent resolve + saves never lose the EEXIST-read race", async () => {
  for (let round = 0; round < 40; round += 1) {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-alerts-"));
    const { alert } = await saveAlert({
      kind: "race", title: "Resolve vs save", source: "test"
    }, { homeDir });
    const settled = await Promise.allSettled([
      resolveAlert(alert.alertId, {
        homeDir, permissionAuthority: alertPa(UNSAFE_OPERATIONS.ALERT_RESOLVE)
      }),
      ...Array.from({ length: 20 }, () => saveAlert({
        kind: "race", title: "Resolve vs save", source: "test"
      }, { homeDir }))
    ]);
    for (const result of settled) {
      assert.equal(result.status, "fulfilled", result.reason?.message ?? result.reason);
    }
    const open = await listAlerts({ homeDir, state: ALERT_STATES.OPEN });
    assert.ok(open.length <= 1);
  }
});

test("open claim fingerprint mismatch fails closed instead of deduping wrong alert", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-alerts-"));
  const alertA = createAlert({ kind: "a", title: "Alpha", source: "test" });
  const fingerprintB = createAlertFingerprint({ kind: "b", title: "Beta", source: "test" });
  const openDir = join(harnessHomePaths(homeDir).alertsDir, "open");
  await mkdir(openDir, { recursive: true });
  await writeFile(join(openDir, fingerprintB), `${JSON.stringify(alertA, null, 2)}\n`);

  await assert.rejects(
    () => saveAlert({ kind: "b", title: "Beta", source: "test" }, { homeDir }),
    (e) => e instanceof AlertStoreError && e.code === "corrupt_alert"
  );
  await assert.rejects(
    () => listAlerts({ homeDir }),
    (e) => e instanceof AlertStoreError && e.code === "corrupt_alert"
  );
});

test("history alertId or open-state mismatch fails closed", async () => {
  const homeWrongId = await mkdtemp(join(tmpdir(), "kairo-alerts-"));
  const wrongId = "alt-bbbbbbbbbbbbbbbbbbbbbbbb";
  const planted = createAlert({
    alertId: "alt-aaaaaaaaaaaaaaaaaaaaaaaa",
    kind: "hist",
    title: "Wrong dir",
    source: "test",
    state: ALERT_STATES.RESOLVED
  });
  await mkdir(join(harnessHomePaths(homeWrongId).alertsDir, wrongId), { recursive: true });
  await writeFile(
    join(harnessHomePaths(homeWrongId).alertsDir, wrongId, "alert.json"),
    `${JSON.stringify(planted, null, 2)}\n`
  );
  await assert.rejects(
    () => listAlerts({ homeDir: homeWrongId }),
    (e) => e instanceof AlertStoreError && e.code === "corrupt_alert"
  );

  const homeOpenHist = await mkdtemp(join(tmpdir(), "kairo-alerts-"));
  const openInHistory = createAlert({
    alertId: "alt-cccccccccccccccccccccccc",
    kind: "hist",
    title: "Still open",
    source: "test",
    state: ALERT_STATES.OPEN
  });
  await mkdir(join(harnessHomePaths(homeOpenHist).alertsDir, openInHistory.alertId), {
    recursive: true
  });
  await writeFile(
    join(harnessHomePaths(homeOpenHist).alertsDir, openInHistory.alertId, "alert.json"),
    `${JSON.stringify(openInHistory, null, 2)}\n`
  );
  await assert.rejects(
    () => listAlerts({ homeDir: homeOpenHist }),
    (e) => e instanceof AlertStoreError && e.code === "corrupt_alert"
  );
});

test("saveAlert rejects terminal state without writing open claim", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-alerts-"));
  for (const state of [ALERT_STATES.RESOLVED, ALERT_STATES.DISMISSED]) {
    const terminal = createAlert({
      kind: "term", title: "Already done", source: "test", state
    });
    await assert.rejects(
      () => saveAlert(terminal, { homeDir }),
      (e) => e instanceof AlertStoreError && e.code === "invalid_alert_state"
    );
  }
  const openDir = join(harnessHomePaths(homeDir).alertsDir, "open");
  assert.equal(existsSync(openDir), false);
  assert.equal((await listAlerts({ homeDir })).length, 0);
});
