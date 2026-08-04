import { resolveHomeDir } from "../../paths.js";
import { printJson } from "../../json-output.js";
import { commandHeader } from "../../brand/index.js";
import { formatCliCommand } from "../../brand/cli.js";
import { controlledDismissAlert, controlledResolveAlert } from "./controlled-alert-actions.js";

export async function runGlobalAlerts(options) {
  const homeDir = resolveHomeDir();
  const action = options.alertsAction;
  const alertId = options.alertId;
  if ((action !== "resolve" && action !== "dismiss") || !alertId) {
    throw new Error(`Use: ${formatCliCommand("alerts resolve|dismiss <alertId> --confirm-…")}`);
  }
  const isResolve = action === "resolve";
  const confirmed = Boolean(isResolve ? options.confirmResolve : options.confirmDismiss);
  const result = await (isResolve ? controlledResolveAlert : controlledDismissAlert)({
    alertId, confirmed, source: "cli", homeDir
  });
  if (options.json) {
    printJson({
      ok: result.ok, code: result.code, alertId, state: result.alert?.state ?? null,
      permissionAuthority: result.permissionAuthority, diagnostics: result.diagnostics
    });
  } else if (result.ok) {
    console.log(`${commandHeader(`alerts ${action}`)}\n${alertId} → ${result.alert.state}`);
  } else {
    console.error(`alerts ${action} failed (${result.code}).`);
    process.exitCode = 2;
  }
  return result;
}
