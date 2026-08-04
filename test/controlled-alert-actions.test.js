import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli.js";
import {
  CONSENT_TYPES, PermissionAuthorityError, UNSAFE_OPERATIONS, authorizeUnsafeOperation
} from "../src/global/runtime/run-permissions.js";
import { ALERT_STATES } from "../src/global/runtime/alerts/alert-types.js";
import {
  AlertStoreError, listAlerts, resolveAlert, saveAlert
} from "../src/global/runtime/alerts/alert-store.js";
import {
  controlledDismissAlert, controlledResolveAlert
} from "../src/global/runtime/alerts/controlled-alert-actions.js";
import { KAIRO_MCP_TOOLS } from "../src/global/mcp/kairo-mcp.js";

const forgedPa = {
  mode: "unsafe", source: "cli", consent: CONSENT_TYPES.CLI_CONFIRM_ALERT_RESOLVE,
  operation: UNSAFE_OPERATIONS.ALERT_RESOLVE
};

test("PA issuance + store boundary + controlled alerts + MCP/CLI", async () => {
  assert.throws(
    () => authorizeUnsafeOperation({ operation: UNSAFE_OPERATIONS.ALERT_RESOLVE, confirmed: false }),
    (e) => e instanceof PermissionAuthorityError && e.code === "unsafe_consent_required"
  );
  assert.throws(
    () => authorizeUnsafeOperation({ operation: UNSAFE_OPERATIONS.GENTLE_BUNDLE_IMPORT, confirmed: false }),
    (e) => e.code === "import_consent_required"
  );
  assert.throws(
    () => authorizeUnsafeOperation({
      operation: UNSAFE_OPERATIONS.ALERT_RESOLVE, confirmed: true, source: "mcp"
    }),
    (e) => e.code === "invalid_unsafe_consent"
  );
  assert.equal(authorizeUnsafeOperation({
    operation: UNSAFE_OPERATIONS.ALERT_DISMISS, confirmed: true, source: "cockpit"
  }).permissionAuthority.consent, CONSENT_TYPES.COCKPIT_ALERT_DISMISS);

  const homeDir = await mkdtemp(join(tmpdir(), "kairo-ctrl-alert-"));
  const { alert } = await saveAlert({ kind: "x", title: "gate", source: "t" }, { homeDir });
  await assert.rejects(
    () => resolveAlert(alert.alertId, { homeDir, permissionAuthority: forgedPa }),
    (e) => e instanceof AlertStoreError && e.code === "permission_authority_forged"
  );
  assert.equal((await listAlerts({ homeDir, state: ALERT_STATES.OPEN })).length, 1);

  const denied = await controlledResolveAlert({
    alertId: alert.alertId, confirmed: false, source: "cli", homeDir
  });
  assert.equal(denied.ok === false && denied.code === "unsafe_consent_required", true);

  const resolved = await controlledResolveAlert({
    alertId: alert.alertId, confirmed: true, source: "cli", homeDir
  });
  assert.equal(resolved.ok && resolved.alert.state === ALERT_STATES.RESOLVED, true);

  const { alert: open2 } = await saveAlert({ kind: "y", title: "dismiss-me", source: "t" }, { homeDir });
  assert.equal((await controlledDismissAlert({
    alertId: open2.alertId, confirmed: true, source: "cockpit", homeDir
  })).permissionAuthority.consent, CONSENT_TYPES.COCKPIT_ALERT_DISMISS);

  assert.equal(parseArgs(["alerts", "resolve", "alt-aaaaaaaaaaaaaaaa", "--confirm-resolve"]).options.confirmResolve, true);
  assert.equal(KAIRO_MCP_TOOLS.some((n) => /resolve|dismiss|write/i.test(n)), false);

  const proc = spawnSync(process.execPath, [
    "bin/kairo.js", "alerts", "resolve", "alt-aaaaaaaaaaaaaaaa", "--json"
  ], { encoding: "utf8", cwd: process.cwd() });
  assert.notEqual(proc.status, 0);
  assert.equal(JSON.parse(proc.stdout).ok, false);
});
