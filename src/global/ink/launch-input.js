import {
  LAUNCH_PERMISSION_OPTIONS,
  LAUNCH_WIZARD_STEPS,
  retreatLaunchWizardStep
} from "./orchestrator-state.js";

/**
 * Launch-wizard key handler.
 * Returns true when consumed, "retreated" when Esc stepped back, false otherwise.
 */
export function handleLaunchInput(ctx) {
  const {
    key,
    inputKey,
    launchStep,
    launchDraft,
    launchableAgents,
    launchAgentIndex,
    launchPermissionIndex,
    setLaunchAgentIndex,
    setLaunchDraft,
    setLaunchStep,
    setLaunchPermissionIndex,
    setError,
    handleLaunch,
    reload,
    allowEscapeRetreat = false
  } = ctx;

  if (allowEscapeRetreat && key.escape) {
    if (launchStep === LAUNCH_WIZARD_STEPS.AGENT) {
      return false;
    }
    setLaunchStep(retreatLaunchWizardStep(launchStep));
    return "retreated";
  }

  if (launchStep === LAUNCH_WIZARD_STEPS.AGENT) {
    if (key.upArrow) {
      setLaunchAgentIndex((index) => Math.max(0, index - 1));
      return true;
    }
    if (key.downArrow) {
      setLaunchAgentIndex((index) => Math.min(launchableAgents.length - 1, index + 1));
      return true;
    }
    if (key.return) {
      const agentId = launchableAgents[launchAgentIndex];
      setLaunchDraft((draft) => ({ ...draft, agentId }));
      setLaunchStep(LAUNCH_WIZARD_STEPS.TASK);
      return true;
    }
    return true;
  }

  if (launchStep === LAUNCH_WIZARD_STEPS.TASK || launchStep === LAUNCH_WIZARD_STEPS.MODEL) {
    const field = launchStep === LAUNCH_WIZARD_STEPS.TASK ? "task" : "model";
    if (key.return) {
      if (field === "task" && !launchDraft.task.trim()) {
        setError("Task cannot be empty.");
        return true;
      }
      setLaunchStep(field === "task" ? LAUNCH_WIZARD_STEPS.MODEL : LAUNCH_WIZARD_STEPS.PERMISSIONS);
      return true;
    }
    if (key.backspace || key.delete) {
      setLaunchDraft((draft) => ({ ...draft, [field]: draft[field].slice(0, -1) }));
      return true;
    }
    if (inputKey && inputKey.length === 1 && !key.ctrl && !key.meta) {
      setLaunchDraft((draft) => ({ ...draft, [field]: `${draft[field]}${inputKey}` }));
      return true;
    }
    return true;
  }

  if (launchStep === LAUNCH_WIZARD_STEPS.PERMISSIONS) {
    if (key.upArrow) {
      setLaunchPermissionIndex((index) => Math.max(0, index - 1));
      return true;
    }
    if (key.downArrow) {
      setLaunchPermissionIndex((index) => Math.min(LAUNCH_PERMISSION_OPTIONS.length - 1, index + 1));
      return true;
    }
    if (key.return) {
      setLaunchStep(LAUNCH_WIZARD_STEPS.CONFIRM);
      return true;
    }
    return true;
  }

  if (launchStep === LAUNCH_WIZARD_STEPS.CONFIRM) {
    if (key.return) {
      handleLaunch({ ...launchDraft, permissionIndex: launchPermissionIndex });
      return true;
    }
    if (key.escape) {
      setLaunchStep(retreatLaunchWizardStep(launchStep));
      return allowEscapeRetreat ? "retreated" : true;
    }
  }

  if (inputKey.toLowerCase() === "r") {
    reload().catch(() => {});
    return true;
  }
  return false;
}
