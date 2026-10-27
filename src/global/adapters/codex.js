import { createManagedConfigAdapter } from "../managed-config-adapter.js";
import { planCodexPacing, applyCodexPacing } from "../hosts/codex-pacing-config.js";

const instructions = createManagedConfigAdapter({
  id: "codex",
  label: "Codex",
  rootDir: ".codex",
  configFile: ".codex/AGENTS.md"
});

export default {
  ...instructions,
  needsSync: context => planCodexPacing(context).changed,
  additionalDriftChecks(context) {
    try {
      return [{ name: 'codex:pacing', status: planCodexPacing(context).changed ? 'stale' : 'ok',
        category: 'adapter', adapterId: 'codex', configFile: '.codex/hooks.json', detail: 'Codex prompt pacing registration; sync repairs missing entries.' }];
    } catch (error) {
      return [{ name: 'codex:pacing', status: 'stale', category: 'adapter', adapterId: 'codex', detail: error.message }];
    }
  },
  plan(context) {
    return { ...instructions.plan(context), pacing: planCodexPacing(context) };
  },
  async apply(context, plan) {
    const hookBackup = await applyCodexPacing(context, plan.pacing);
    const result = await instructions.apply(context, plan);
    return { ...result, action: result.action === 'unchanged' && plan.pacing.changed ? 'update' : result.action,
      backupPaths: [result.backupPath, hookBackup].filter(Boolean) };
  },
  async uninstall(context, state) {
    const plan = planCodexPacing(context, true);
    const hookBackup = await applyCodexPacing(context, plan);
    const result = await instructions.uninstall(context, state);
    return { ...result, cleaned: result.cleaned || plan.changed,
      backupPaths: [result.backupPath, hookBackup].filter(Boolean) };
  },
};
