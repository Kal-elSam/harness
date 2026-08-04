import test from "node:test";
import assert from "node:assert/strict";
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

test("PA bindings + store boundary + controlled alerts + MCP readonly", async () => {
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
  assert.throws(
    () => authorizeUnsafeOperation({
      operation: UNSAFE_OPERATIONS.ALERT_RESOLVE, confirmed: true, source: "cli",
      consentType: CONSENT_TYPES.CLI_CONFIRM_IMPORT
    }),
    (e) => e.code === "invalid_unsafe_consent"
  );
  assert.equal(authorizeUnsafeOperation({
    operation: UNSAFE_OPERATIONS.ALERT_DISMISS, confirmed: true, source: "cockpit"
  }).permissionAuthority.consent, CONSENT_TYPES.COCKPIT_ALERT_DISMISS);

  const homeDir = await mkdtemp(join(tmpdir(), "kairo-ctrl-alert-"));
  const { alert } = await saveAlert({ kind: "x", title: "gate", source: "t" }, { homeDir });
  await assert.rejects(
    () => resolveAlert(alert.alertId, { homeDir }),
    (e) => e instanceof AlertStoreError && e.code === "permission_authority_required"
  );
  await assert.rejects(
    () => resolveAlert(alert.alertId, {
      homeDir,
      permissionAuthority: {
        mode: "unsafe", source: "cli", consent: CONSENT_TYPES.CLI_CONFIRM_IMPORT,
        operation: UNSAFE_OPERATIONS.ALERT_RESOLVE
      }
    }),
    (e) => e.code === "invalid_unsafe_consent"
  );
  assert.equal((await listAlerts({ homeDir, state: ALERT_STATES.OPEN })).length, 1);

  let mutated = 0;
  const denied = await controlledResolveAlert({
    alertId: alert.alertId, confirmed: false, source: "cli", homeDir,
    resolve: async () => { mutated += 1; throw new Error("no"); }
  });
  assert.equal(denied.ok === false && denied.code === "unsafe_consent_required" && mutated === 0, true);

  const resolved = await controlledResolveAlert({
    alertId: alert.alertId, confirmed: true, source: "cli", homeDir
  });
  assert.equal(resolved.ok && resolved.alert.state === ALERT_STATES.RESOLVED, true);
  assert.equal(resolved.alert.permissionAuthority.operation, UNSAFE_OPERATIONS.ALERT_RESOLVE);

  const { alert: open2 } = await saveAlert({ kind: "y", title: "dismiss-me", source: "t" }, { homeDir });
  const dismissed = await controlledDismissAlert({
    alertId: open2.alertId, confirmed: true, source: "cockpit", homeDir
  });
  assert.equal(dismissed.permissionAuthority.consent, CONSENT_TYPES.COCKPIT_ALERT_DISMISS);

  const r = parseArgs(["alerts", "resolve", "alt-aaaaaaaaaaaaaaaa", "--confirm-resolve"]);
  assert.equal(r.command === "alerts" && r.options.confirmResolve, true);
  assert.throws(() => parseArgs(["alerts", "resolve"]));
  assert.equal(KAIRO_MCP_TOOLS.some((n) => /resolve|dismiss|write/i.test(n)), false);
});
