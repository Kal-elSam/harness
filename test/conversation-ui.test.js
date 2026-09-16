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
    planExecution: async (value) => { calls.push(["preview", value]); return { decision: "ROUTED", provider: "codex", model: "gpt-6-astra", why: "reasoning task" }; },
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
    assert.doesNotMatch(html.text, /Execute with Claude/, "the hardcoded provider label must be gone — the real routing decision names the real provider");
    assert.doesNotMatch(html.text, /Cancel Claude run/);
    assert.match(html.text, /const options=action==='show'\?\{\}:\{method:'POST',body:'\{\}'\}/);
    assert.match(html.text, /\/api\/plans\/'\+encodeURIComponent\(id\)\+'\/preview/, "execute must fetch the real preview before ever confirming");
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
    const previewed = await request(ui.port, { path: "/api/plans/task-id/preview", headers: auth });
    assert.equal(previewed.status, 200);
    assert.deepEqual(calls[3], ["preview", { cwd: "/repo", taskId: "task-id", role: null }]);

    const previewedForRole = await request(ui.port, { path: "/api/plans/task-id/preview?role=Builder", headers: auth });
    assert.equal(previewedForRole.status, 200);
    assert.deepEqual(calls[4], ["preview", { cwd: "/repo", taskId: "task-id", role: "Builder" }]);

    const executed = await request(ui.port, {
      path: "/api/plans/task-id/execute", method: "POST", headers: auth, body: "{}"
    });
    assert.equal(executed.status, 202);
    assert.deepEqual(calls[5], ["execute", { cwd: "/repo", taskId: "task-id" }], "no confirmationTarget in the body falls back to the legacy no-role path, unchanged");

    const confirmationTarget = { role: "Builder", selection: "assigned", strategyFingerprint: "fp-1", candidateKey: "codex::gpt-6-astra" };
    const executedWithTarget = await request(ui.port, {
      path: "/api/plans/task-id/execute", method: "POST", headers: auth, body: JSON.stringify({ confirmationTarget })
    });
    assert.equal(executedWithTarget.status, 202);
    assert.deepEqual(calls[6], ["execute", { cwd: "/repo", taskId: "task-id", confirmationTarget }], "the browser must never send a free-form agentId/model override — only a confirmationTarget it just fetched from /preview");

    const executedWithNullTarget = await request(ui.port, {
      path: "/api/plans/task-id/execute", method: "POST", headers: auth, body: JSON.stringify({ confirmationTarget: null })
    });
    assert.equal(executedWithNullTarget.status, 400, "an explicit but falsy confirmationTarget (e.g. forwarded from a blocked preview) must be rejected outright, never silently downgraded to the legacy path");
    assert.equal(calls.length, 7, "executePlan must never have been called for the rejected request");

    const cancelled = await request(ui.port, {
      path: "/api/plans/task-id/cancel", method: "POST", headers: auth, body: "{}"
    });
    assert.equal(cancelled.status, 200);
    assert.deepEqual(calls[7], ["cancel", { cwd: "/repo", taskId: "task-id" }]);
    assert.equal((await request(ui.port, { path: "/api/plans/task-id/execute", headers: auth })).status, 404);
    assert.equal((await request(ui.port, { path: "/api/plans/task-id/preview", method: "POST", headers: auth, body: "{}" })).status, 404);
    assert.equal((await request(ui.port, { path: "/api/plans/task-id/approve", headers: auth })).status, 404);
    assert.equal((await request(ui.port, { path: "/api/plans/../show", headers: auth })).status, 404);
  } finally { await ui.close(); }
});
