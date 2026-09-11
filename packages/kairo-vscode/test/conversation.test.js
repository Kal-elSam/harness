"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchConversation } = require("../src/conversation-cache.js");
const { renderConversationSection, renderPanelHtml } = require("../src/panel-html.js");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

test("Cursor conversation bridge uses the shared CLI protocol", async () => {
  let captured;
  const result = await fetchConversation({
    cwd: "/repo",
    run: async (args, options) => {
      captured = { args, options };
      return { schema: "kairo.conversation/v1", timeline: [] };
    }
  });
  assert.equal(result.schema, "kairo.conversation/v1");
  assert.deepEqual(captured.args, ["conversation", "snapshot", "--cwd", "/repo"]);
  assert.equal(captured.options.cwd, "/repo");
});

test("conversation bridge source is included by VSIX packaging rules", () => {
  const root = join(__dirname, "..");
  assert.equal(existsSync(join(root, "src", "conversation-cache.js")), true);
  const ignored = readFileSync(join(root, ".vscodeignore"), "utf8");
  assert.doesNotMatch(ignored, /src\/conversation/);
});

test("Cursor presentation is safe and distinguishes approval from implementation", () => {
  const html = renderConversationSection({
    timeline: [{ taskId: "task-id", state: "awaiting_approval", planReady: true }],
    error: "<img src=x onerror=alert(1)>"
  });
  assert.match(html, /Approval does not start implementation/);
  assert.match(html, /Claude execution is explicit, subscription-only/);
  assert.match(html, /data-conversation-action="approve"/);
  assert.doesNotMatch(html, /<img src=x/);

  const approved = renderConversationSection({ timeline: [{
    taskId: "approved-id", state: "approved", planReady: true,
    execution: { state: "not_started", active: false, message: "Ready." }
  }] });
  assert.match(approved, /data-conversation-action="execute"/);
  const running = renderConversationSection({ timeline: [{
    taskId: "running-id", state: "approved", planReady: true,
    execution: { state: "running", active: true, message: "Running." }
  }] });
  assert.match(running, /data-conversation-action="cancel"/);

  const full = renderPanelHtml({ entries: [], connections: [], conversation: {
    timeline: [], error: "</script><script>alert(1)</script>"
  } }, "nonce");
  assert.doesNotMatch(full, /<script>alert\(1\)<\/script>/);
});
