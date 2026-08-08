import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAssignmentList,
  parsePlatformList,
  mapClaudeAssignmentsToOpenCode,
  buildFleetConfigurePlan,
  CLAUDE_TO_OPENCODE
} from "../src/global/fleet-configure.js";

test("parseAssignmentList and platforms", () => {
  assert.deepEqual(parseAssignmentList("sdd-apply=sonnet,sdd-design=opus"), {
    "sdd-apply": "sonnet",
    "sdd-design": "opus"
  });
  assert.deepEqual(parsePlatformList("opencode,claude"), ["opencode", "claude"]);
  assert.deepEqual(parsePlatformList("claude,opencode,cursor"), ["claude", "opencode", "cursor"]);
  assert.throws(() => parsePlatformList("nope"), /Unsupported platform/);
});

test("mapClaudeAssignmentsToOpenCode uses tier table", () => {
  const mapped = mapClaudeAssignmentsToOpenCode({
    default: "sonnet",
    "sdd-apply": "sonnet",
    "sdd-design": "opus",
    "sdd-archive": "haiku"
  });
  assert.equal(mapped["sdd-apply"], CLAUDE_TO_OPENCODE.sonnet);
  assert.equal(mapped["sdd-design"], CLAUDE_TO_OPENCODE.opus);
  assert.equal(mapped["sdd-archive"], CLAUDE_TO_OPENCODE.haiku);
  assert.equal(mapped.default, undefined);
});

test("buildFleetConfigurePlan plans Claude + OpenCode from assignments", async () => {
  const files = new Map([
    ["/tmp/fc/.claude/settings.json", JSON.stringify({ model: "haiku" })],
    ["/tmp/fc/.claude/agents/sdd-apply.md", "---\nname: sdd-apply\nmodel: haiku\n---\n\nbody\n"],
    ["/tmp/fc/.config/opencode/opencode.json", JSON.stringify({
      model: "opencode-go/deepseek-v4-pro",
      agent: {
        "sdd-apply": { mode: "subagent", model: "opencode-go/deepseek-v4-flash" }
      }
    })]
  ]);

  const plan = await buildFleetConfigurePlan({
    homeDir: "/tmp/fc",
    platforms: ["claude", "opencode"],
    from: "explicit",
    assignments: { default: "sonnet", "sdd-apply": "sonnet" },
    read: async (path) => {
      if (!files.has(path)) {
        const err = new Error("missing");
        err.code = "ENOENT";
        throw err;
      }
      return files.get(path);
    },
    pathExists: async (path) => files.has(path)
  });

  assert.equal(plan.source, "explicit");
  assert.ok(plan.changes.some((c) => c.platform === "claude" && c.agent === "default"));
  assert.ok(plan.changes.some((c) => c.platform === "claude" && c.agent === "sdd-apply"));
  assert.ok(plan.changes.some((c) => c.platform === "opencode" && c.kind === "json"));
});
