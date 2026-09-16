import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli.js";
import { runArchitectCli } from "../src/global/architect/architect-cli.js";

test("architect and plans CLI parse their dedicated options", () => {
  const architect = parseArgs(["architect", "--task", "Design auth", "--model", "gpt-x", "--json"]);
  assert.equal(architect.command, "architect");
  assert.equal(architect.options.task, "Design auth");
  assert.equal(architect.options.model, "gpt-x");
  assert.equal(architect.options.json, true);

  const approve = parseArgs(["plans", "approve", "20260101-task-abcdef12", "--json"]);
  assert.equal(approve.command, "plans");
  assert.equal(approve.options.plansAction, "approve");
  assert.equal(approve.options.taskId, "20260101-task-abcdef12");
  assert.throws(() => parseArgs(["plans", "approve"]), /Missing task id/);
});

test("conversation and local UI CLI parse bounded actions", () => {
  const ui = parseArgs(["ui", "--cwd", "/repo", "--port", "4312"]);
  assert.equal(ui.command, "ui");
  assert.equal(ui.options.port, 4312);

  const architect = parseArgs(["conversation", "architect", "--task", "Plan auth", "--json"]);
  assert.equal(architect.options.conversationAction, "architect");
  assert.equal(architect.options.task, "Plan auth");
  const approve = parseArgs(["conversation", "approve", "task-id"]);
  assert.equal(approve.options.taskId, "task-id");
  const execute = parseArgs(["conversation", "execute", "task-id"]);
  assert.equal(execute.options.conversationAction, "execute");
  assert.equal(execute.options.taskId, "task-id");

  const executeWithRole = parseArgs(["conversation", "execute", "task-id", "--role", "Builder", "--confirm"]);
  assert.equal(executeWithRole.options.role, "Builder");
  assert.equal(executeWithRole.options.confirm, true);
  const executeWithRoleEq = parseArgs(["conversation", "execute", "task-id", "--role=Builder"]);
  assert.equal(executeWithRoleEq.options.role, "Builder");
});

test("architect CLI exposes when an existing plan was reused", async () => {
  const writes = [];
  const original = console.log;
  console.log = (value) => writes.push(value);
  try {
    const data = await runArchitectCli({ task: "same", cwd: "/repo", json: true }, {
      createPlan: async () => ({
        reused: true,
        paths: { planPath: "/repo/.ai/tasks/task-id/plan.md" },
        status: {
          taskId: "task-id", state: "awaiting_approval", projectRoot: "/repo",
          artifacts: { plan: ".ai/tasks/task-id/plan.md" }
        }
      })
    });
    assert.equal(data.reused, true);
    assert.match(writes.join("\n"), /"reused":true/);
  } finally {
    console.log = original;
  }
});

test("architect CLI does not advertise approval while a reused draft has no plan", async () => {
  const writes = [];
  const original = console.log;
  console.log = (value) => writes.push(value);
  try {
    const data = await runArchitectCli({ task: "same", cwd: "/repo", json: false }, {
      createPlan: async () => ({
        reused: true,
        paths: { planPath: "/repo/.ai/tasks/task-id/plan.md" },
        status: {
          taskId: "task-id", state: "draft", projectRoot: "/repo",
          artifacts: { plan: ".ai/tasks/task-id/plan.md" }
        }
      })
    });
    assert.equal(data.planPath, null);
    assert.match(writes.join("\n"), /still active/);
    assert.doesNotMatch(writes.join("\n"), /Approve:/);
  } finally {
    console.log = original;
  }
});
