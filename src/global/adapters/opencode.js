import { createManagedConfigAdapter } from "../managed-config-adapter.js";
import { planOpenCodePacing, applyOpenCodePacing } from "../hosts/opencode-pacing-config.js";

const instructions = createManagedConfigAdapter({
  id: "opencode",
  label: "OpenCode",
  rootDir: ".config/opencode",
  configFile: ".config/opencode/AGENTS.md"
});

const pluginFile = ".config/opencode/plugins/kairo-pacing.js";

export default {
  ...instructions,
  needsSync: context => planOpenCodePacing(context).changed,
  additionalDriftChecks(context) {
    const check = status => detail => [{ name: "opencode:pacing", status, category: "adapter", adapterId: "opencode", configFile: pluginFile, detail }];
    try {
      const plan = planOpenCodePacing(context);
      if (plan.foreign) return check("warning")("An unmanaged file occupies the Kairo pacing plugin path; Kairo leaves it untouched.");
      return check(plan.changed ? "stale" : "ok")("OpenCode v2 prompt pacing plugin; sync repairs a missing or outdated file.");
    } catch (error) {
      return check("stale")(error.message);
    }
  },
  plan(context) {
    return { ...instructions.plan(context), pacing: planOpenCodePacing(context) };
  },
  async apply(context, plan) {
    const pluginBackup = await applyOpenCodePacing(context, plan.pacing);
    const result = await instructions.apply(context, plan);
    return { ...result, action: result.action === "unchanged" && plan.pacing.changed ? "update" : result.action,
      backupPaths: [result.backupPath, pluginBackup].filter(Boolean) };
  },
  async uninstall(context, state) {
    const plan = planOpenCodePacing(context, true);
    const pluginBackup = await applyOpenCodePacing(context, plan);
    const result = await instructions.uninstall(context, state);
    return { ...result, cleaned: result.cleaned || plan.changed,
      backupPaths: [result.backupPath, pluginBackup].filter(Boolean) };
  },
};
