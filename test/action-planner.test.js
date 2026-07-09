import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PLAN_ACTIONS,
  buildActionPlan,
  formatActionPlan,
  shouldExecutePlan
} from "../src/global/action-planner.js";
import { assertPlanExecution } from "../src/global/orchestrator.js";

test("diagnostics plan is read-only", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-plan-home-"));
  const workspaceRoot = await mkdtemp(join(tmpdir(), "kairo-plan-workspace-"));

  const plan = await buildActionPlan({
    action: PLAN_ACTIONS.DIAGNOSE,
    homeDir,
    workspaceRoot,
    packageName: "@kal-elsam/kairo-runtime"
  });

  assert.equal(plan.readOnly, true);
  assert.equal(plan.requiresConfirmation, false);
  assert.equal(shouldExecutePlan(plan), true);
});

test("setup plan requires confirmation for writes", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-plan-setup-"));
  const workspaceRoot = await mkdtemp(join(tmpdir(), "kairo-plan-setup-ws-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });

  const plan = await buildActionPlan({
    action: PLAN_ACTIONS.SETUP,
    homeDir,
    workspaceRoot,
    packageName: "@kal-elsam/kairo-runtime"
  });

  assert.equal(plan.readOnly, false);
  assert.equal(plan.requiresConfirmation, true);
  assert.equal(shouldExecutePlan(plan, { confirmed: false }), false);
  assert.equal(shouldExecutePlan(plan, { confirmed: true }), true);
  assert.match(formatActionPlan(plan), /Confirmation required: yes/);
});

test("declining a plan performs no writes", () => {
  const plan = { readOnly: false, requiresConfirmation: true, action: PLAN_ACTIONS.SETUP };

  assert.throws(
    () => assertPlanExecution(plan, { confirmed: false }),
    /Plan declined/
  );
});

test("dry-run setup plan stays read-only", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-plan-dry-"));
  const workspaceRoot = await mkdtemp(join(tmpdir(), "kairo-plan-dry-ws-"));

  const plan = await buildActionPlan({
    action: PLAN_ACTIONS.SETUP,
    homeDir,
    workspaceRoot,
    packageName: "@kal-elsam/kairo-runtime",
    options: { dryRun: true }
  });

  assert.equal(plan.readOnly, true);
  assert.equal(plan.requiresConfirmation, false);
});
