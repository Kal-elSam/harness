import assert from "node:assert/strict";
import test from "node:test";
import {
  mapSessionRowsToActivity,
  parseSessionModel,
  buildOpenCodeActivity
} from "../src/global/observability/fleet-activity.js";
import {
  buildOpenCodeFleetSetPlan,
  runFleetSet
} from "../src/global/fleet-set.js";
import {
  parseFrontmatterModel,
  replaceFrontmatterModel,
  replaceCodexDefaultModel
} from "../src/global/observability/fleet-platforms.js";

test("parseSessionModel reads OpenCode JSON model blob", () => {
  const parsed = parseSessionModel(
    JSON.stringify({ id: "deepseek-v4-pro", providerID: "opencode-go" })
  );
  assert.equal(parsed.model, "opencode-go/deepseek-v4-pro");
  assert.equal(parsed.modelShort, "deepseek-v4-pro");
});

test("mapSessionRowsToActivity marks recent sessions active and groups by agent", () => {
  const now = 1_000_000_000_000;
  const mapped = mapSessionRowsToActivity([
    {
      id: "parent",
      parent_id: null,
      title: "Root",
      agent: "gentle-orchestrator",
      model: JSON.stringify({ id: "deepseek-v4-pro", providerID: "opencode-go" }),
      time_created: now - 1000,
      time_updated: now - 1000,
      time_archived: null
    },
    {
      id: "child",
      parent_id: "parent",
      title: "Apply",
      agent: "sdd-apply",
      model: JSON.stringify({ id: "deepseek-v4-pro", providerID: "opencode-go" }),
      time_created: now - 500,
      time_updated: now - 500,
      time_archived: null
    },
    {
      id: "old",
      parent_id: "parent",
      title: "Old",
      agent: "sdd-verify",
      model: JSON.stringify({ id: "flash", providerID: "opencode-go" }),
      time_created: now - 3_600_000,
      time_updated: now - 3_600_000,
      time_archived: null
    }
  ], { nowMs: now, activeWindowMs: 15 * 60 * 1000 });

  assert.equal(mapped.activeCount, 2);
  assert.ok(mapped.agents.some((a) => a.id === "sdd-apply" && a.state === "active" && a.parentId === "parent"));
  assert.ok(mapped.agents.some((a) => a.id === "sdd-verify" && a.state === "idle"));
});

test("buildOpenCodeActivity missing db returns unavailable", async () => {
  const report = await buildOpenCodeActivity({
    homeDir: "/tmp/no-opencode-home",
    exists: async () => false
  });
  assert.equal(report.available, false);
  assert.equal(report.sessions.length, 0);
});

test("buildOpenCodeFleetSetPlan updates agent.model", () => {
  const plan = buildOpenCodeFleetSetPlan({
    configPath: "/tmp/opencode.json",
    agent: "sdd-apply",
    model: "opencode-go/qwen3.5-plus",
    config: {
      model: "opencode-go/deepseek-v4-pro",
      agent: {
        "sdd-apply": { mode: "subagent", model: "opencode-go/deepseek-v4-pro" }
      }
    }
  });
  assert.equal(plan.wouldWrite, true);
  assert.equal(plan.next.agent["sdd-apply"].model, "opencode-go/qwen3.5-plus");
});

test("runFleetSet plans without writing", async () => {
  const files = new Map([
    ["/tmp/home/.config/opencode/opencode.json", JSON.stringify({
      agent: { "sdd-apply": { mode: "subagent", model: "a/b" } }
    }, null, 2)]
  ]);
  const writes = [];
  const result = await runFleetSet({
    platform: "opencode",
    agent: "sdd-apply",
    model: "a/c",
    yes: false,
    json: false,
    homeDir: "/tmp/home",
    read: async (path) => {
      if (!files.has(path)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return files.get(path);
    },
    writeAtomicJsonFn: async (path, value) => { writes.push({ path, value }); },
    copyFileFn: async () => {}
  });
  assert.equal(result.applied, false);
  assert.equal(writes.length, 0);
  assert.equal(result.plan.previousModel, "a/b");
});

test("claude frontmatter model replace preserves body", () => {
  const raw = `---\nname: sdd-apply\nmodel: sonnet\n---\n\nBody here\n`;
  assert.equal(parseFrontmatterModel(raw).model, "sonnet");
  const next = replaceFrontmatterModel(raw, "opus");
  assert.match(next, /^---\nname: sdd-apply\nmodel: opus\n---/);
  assert.match(next, /Body here/);
});

test("codex toml model replace", () => {
  const toml = `model = "gpt-5.6-sol"\nmodel_reasoning_effort = "medium"\n`;
  assert.equal(replaceCodexDefaultModel(toml, "gpt-5.4").includes('model = "gpt-5.4"'), true);
});
