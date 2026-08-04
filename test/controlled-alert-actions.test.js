import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli.js";
import {
  CONSENT_TYPES,
  PermissionAuthorityError,
  UNSAFE_OPERATIONS,
  authorizeUnsafeOperation
} from "../src/global/runtime/run-permissions.js";
import { ALERT_STATES } from "../src/global/runtime/alerts/alert-types.js";
import { listAlerts, saveAlert } from "../src/global/runtime/alerts/alert-store.js";
import {
  controlledDismissAlert,
  controlledResolveAlert
} from "../src/global/runtime/alerts/controlled-alert-actions.js";
import { KAIRO_MCP_TOOLS } from "../src/global/mcp/kairo-mcp.js";

test("unsafe ops: alert consent codes; import keeps import_consent_required", () => {
  assert.throws(
    () => authorizeUnsafeOperation({ operation: UNSAFE_OPERATIONS.ALERT_RESOLVE, confirmed: false }),
    (e) => e instanceof PermissionAuthorityError && e.code === "unsafe_consent_required"
  );
  assert.throws(
    () => authorizeUnsafeOperation({
      operation: UNSAFE_OPERATIONS.GENTLE_BUNDLE_IMPORT, confirmed: false
    }),
    (e) => e.code === "import_consent_required"
  );
  const ok = authorizeUnsafeOperation({
    operation: UNSAFE_OPERATIONS.ALERT_DISMISS, confirmed: true, source: "cockpit"
  });
  assert.equal(ok.permissionAuthority.consent, CONSENT_TYPES.COCKPIT_ALERT_DISMISS);
});

test("controlled alert resolve/dismiss: consent gate + PA audit", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-ctrl-alert-"));
  const { alert } = await saveAlert({ kind: "x", title: "gate", source: "t" }, { homeDir });
  let mutated = 0;
  const denied = await controlledResolveAlert({
    alertId: alert.alertId, confirmed: false, source: "cli", homeDir,
    resolve: async () => { mutated += 1; throw new Error("no"); }
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "unsafe_consent_required");
  assert.equal(mutated, 0);
  assert.equal((await listAlerts({ homeDir, state: ALERT_STATES.OPEN })).length, 1);

  const resolved = await controlledResolveAlert({
    alertId: alert.alertId, confirmed: true, source: "cli", homeDir
  });
  assert.equal(resolved.ok && resolved.alert.state === ALERT_STATES.RESOLVED, true);
  assert.equal(resolved.permissionAuthority.consent, CONSENT_TYPES.CLI_CONFIRM_ALERT_RESOLVE);
  assert.equal(resolved.alert.permissionAuthority.operation, UNSAFE_OPERATIONS.ALERT_RESOLVE);
  assert.equal((await listAlerts({ homeDir, state: ALERT_STATES.OPEN })).length, 0);

  const { alert: open2 } = await saveAlert({ kind: "y", title: "dismiss-me", source: "t" }, { homeDir });
  const dismissed = await controlledDismissAlert({
    alertId: open2.alertId, confirmed: true, source: "cockpit", homeDir
  });
  assert.equal(dismissed.alert.state, ALERT_STATES.DISMISSED);
  assert.equal(dismissed.permissionAuthority.consent, CONSENT_TYPES.COCKPIT_ALERT_DISMISS);
});

test("CLI alerts parse confirm flags; MCP stays read-only", () => {
  const r = parseArgs(["alerts", "resolve", "alt-aaaaaaaaaaaaaaaa", "--confirm-resolve"]);
  assert.equal(r.command, "alerts");
  assert.equal(r.options.alertsAction, "resolve");
  assert.equal(r.options.confirmResolve, true);
  const d = parseArgs(["alerts", "dismiss", "alt-bbbbbbbbbbbbbbbb", "--confirm-dismiss"]);
  assert.equal(d.options.alertsAction, "dismiss");
  assert.equal(d.options.confirmDismiss, true);
  assert.throws(() => parseArgs(["alerts", "resolve"]));
  assert.equal(KAIRO_MCP_TOOLS.includes("kairo_alerts"), true);
  assert.equal(KAIRO_MCP_TOOLS.some((n) => /resolve|dismiss|write/i.test(n)), false);
});
