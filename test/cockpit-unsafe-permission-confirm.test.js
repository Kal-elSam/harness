import test from "node:test";
import assert from "node:assert/strict";
import {
  LAUNCH_WIZARD_STEPS,
  advanceLaunchWizardStep,
  formatLaunchWizardLines,
  resolveLaunchPermissions,
  retreatLaunchWizardStep
} from "../src/global/ink/orchestrator-state.js";
import { handleLaunchInput } from "../src/global/ink/launch-input.js";

test("confirm stays single-step for default; unsafe routes to UNSAFE_CONFIRM", () => {
  assert.equal(
    advanceLaunchWizardStep(LAUNCH_WIZARD_STEPS.CONFIRM, { permissionIndex: 0 }),
    LAUNCH_WIZARD_STEPS.CONFIRM
  );
  assert.equal(
    advanceLaunchWizardStep(LAUNCH_WIZARD_STEPS.CONFIRM, { permissionIndex: 1 }),
    LAUNCH_WIZARD_STEPS.UNSAFE_CONFIRM
  );
  assert.equal(
    advanceLaunchWizardStep(LAUNCH_WIZARD_STEPS.CONFIRM, { permissionIndex: 2 }),
    LAUNCH_WIZARD_STEPS.UNSAFE_CONFIRM
  );
  assert.equal(
    retreatLaunchWizardStep(LAUNCH_WIZARD_STEPS.UNSAFE_CONFIRM),
    LAUNCH_WIZARD_STEPS.CONFIRM
  );
});

test("unsafe confirm lines warn; Y launches with cockpit consent; N retreats", () => {
  const text = formatLaunchWizardLines({
    step: LAUNCH_WIZARD_STEPS.UNSAFE_CONFIRM,
    draft: { agentId: "codex", task: "x", model: "" },
    launchableAgents: ["codex"],
    agentIndex: 0,
    permissionIndex: 2
  }).join("\n");
  assert.match(text, /unsafe|YOLO|Press Y/i);

  let launched = null;
  let step = LAUNCH_WIZARD_STEPS.CONFIRM;
  const base = {
    launchDraft: { agentId: "codex", task: "do it", model: "" },
    launchableAgents: ["codex"],
    launchAgentIndex: 0,
    launchPermissionIndex: 2,
    setLaunchAgentIndex() {},
    setLaunchDraft() {},
    setLaunchStep(next) { step = typeof next === "function" ? next(step) : next; },
    setLaunchPermissionIndex() {},
    setError() {},
    handleLaunch(draft) { launched = draft; },
    reload: async () => {}
  };

  assert.equal(handleLaunchInput({
    ...base, key: { return: true }, inputKey: "", launchStep: LAUNCH_WIZARD_STEPS.CONFIRM
  }), true);
  assert.equal(step, LAUNCH_WIZARD_STEPS.UNSAFE_CONFIRM);
  assert.equal(launched, null);

  assert.equal(handleLaunchInput({
    ...base, key: {}, inputKey: "n", launchStep: LAUNCH_WIZARD_STEPS.UNSAFE_CONFIRM
  }), true);
  assert.equal(step, LAUNCH_WIZARD_STEPS.CONFIRM);
  assert.equal(launched, null);

  step = LAUNCH_WIZARD_STEPS.UNSAFE_CONFIRM;
  assert.equal(handleLaunchInput({
    ...base, key: {}, inputKey: "y", launchStep: LAUNCH_WIZARD_STEPS.UNSAFE_CONFIRM
  }), true);
  assert.equal(launched.allowUnsafePermissions, true);
  assert.equal(launched.permissionSource, "cockpit");
  assert.deepEqual(resolveLaunchPermissions({ permissionIndex: 2 }), ["yolo"]);
});

test("default confirm launches once without unsafe consent flags", () => {
  let launched = null;
  handleLaunchInput({
    key: { return: true },
    inputKey: "",
    launchStep: LAUNCH_WIZARD_STEPS.CONFIRM,
    launchDraft: { agentId: "codex", task: "safe", model: "" },
    launchableAgents: ["codex"],
    launchAgentIndex: 0,
    launchPermissionIndex: 0,
    setLaunchAgentIndex() {},
    setLaunchDraft() {},
    setLaunchStep() {},
    setLaunchPermissionIndex() {},
    setError() {},
    handleLaunch(draft) { launched = draft; },
    reload: async () => {}
  });
  assert.equal(launched.allowUnsafePermissions, false);
  assert.equal(launched.permissionSource, "cockpit");
  assert.deepEqual(resolveLaunchPermissions({ permissionIndex: 0 }), []);
});
