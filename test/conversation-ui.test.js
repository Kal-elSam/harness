import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { startLocalConversationUi } from "../src/global/conversation/ui.js";

function request(port, { path = "/", method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("local conversation UI is loopback-authenticated with allowlisted actions", async () => {
  const calls = [];
  const service = {
    snapshot: async () => ({ schema: "kairo.conversation/v1", timeline: [] }),
    submitArchitecture: async (value) => { calls.push(["architect", value]); return { taskId: "id" }; },
    showPlan: async (value) => { calls.push(["show", value]); return { taskId: value.taskId, planMarkdown: "safe" }; },
    decidePlan: async (value) => { calls.push(["decide", value]); return { taskId: value.taskId }; },
    executePlan: async (value) => { calls.push(["execute", value]); return { taskId: value.taskId }; },
    cancelExecution: async (value) => { calls.push(["cancel", value]); return { taskId: value.taskId }; }
  };
  const ui = await startLocalConversationUi({ cwd: "/repo", token: "a".repeat(48), service });
  const auth = { authorization: `Bearer ${ui.token}` };
  try {
    assert.equal((await request(ui.port)).status, 401);
    assert.equal((await request(ui.port, { path: `/?token=${ui.token}`, headers: { host: "evil.example" } })).status, 403);
    assert.equal((await request(ui.port, { path: "/api/snapshot", headers: { ...auth, origin: "https://evil.example" } })).status, 403);
    assert.equal((await request(ui.port, { path: "/api/unknown", headers: auth })).status, 404);

    const html = await request(ui.port, { path: `/?token=${ui.token}` });
    assert.equal(html.status, 200);
    assert.match(html.text, /Approval and execution are separate/);
    assert.match(html.text, /window\.confirm\('Execute this approved plan with Claude/);
    assert.match(html.text, /const options=action==='show'\?\{\}:\{method:'POST',body:'\{\}'\}/);
    assert.equal(html.headers["x-frame-options"], "DENY");

    const created = await request(ui.port, {
      path: "/api/architect", method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ task: "Plan auth" })
    });
    assert.equal(created.status, 200);
    assert.deepEqual(calls[0], ["architect", { cwd: "/repo", task: "Plan auth", model: null }]);
    const shown = await request(ui.port, { path: "/api/plans/task-id/show", headers: auth });
    assert.equal(shown.status, 200);
    assert.deepEqual(calls[1], ["show", { cwd: "/repo", taskId: "task-id" }]);
    assert.equal((await request(ui.port, {
      path: "/api/plans/task-id/show", method: "POST", headers: auth, body: "{}"
    })).status, 404);
    const approved = await request(ui.port, {
      path: "/api/plans/task-id/approve", method: "POST", headers: auth, body: "{}"
    });
    assert.equal(approved.status, 200);
    assert.deepEqual(calls[2], ["decide", { cwd: "/repo", taskId: "task-id", decision: "approved" }]);
    const executed = await request(ui.port, {
      path: "/api/plans/task-id/execute", method: "POST", headers: auth, body: "{}"
    });
    assert.equal(executed.status, 202);
    assert.deepEqual(calls[3], ["execute", { cwd: "/repo", taskId: "task-id" }]);
    const cancelled = await request(ui.port, {
      path: "/api/plans/task-id/cancel", method: "POST", headers: auth, body: "{}"
    });
    assert.equal(cancelled.status, 200);
    assert.deepEqual(calls[4], ["cancel", { cwd: "/repo", taskId: "task-id" }]);
    assert.equal((await request(ui.port, { path: "/api/plans/task-id/execute", headers: auth })).status, 404);
    assert.equal((await request(ui.port, { path: "/api/plans/task-id/approve", headers: auth })).status, 404);
    assert.equal((await request(ui.port, { path: "/api/plans/../show", headers: auth })).status, 404);
  } finally { await ui.close(); }
});
