import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFleetModelsCatalog,
  formatFleetModelsText,
  CLAUDE_TIERS
} from "../src/global/observability/fleet-models-catalog.js";

test("buildFleetModelsCatalog reports available vs enabled per platform", async () => {
  const files = new Map([
    ["/tmp/mc/.config/opencode/opencode.json", JSON.stringify({
      model: "opencode-go/deepseek-v4-pro",
      agent: { "sdd-apply": { model: "opencode-go/kimi-k2.6" } }
    })],
    ["/tmp/mc/.claude/settings.json", JSON.stringify({ model: "sonnet" })],
    ["/tmp/mc/.claude/agents/sdd-apply.md", "---\nname: sdd-apply\nmodel: opus\n---\n"],
    ["/tmp/mc/.codex/config.toml", 'model = "gpt-5.6-sol"\n'],
    ["/tmp/mc/.cursor/cli-config.json", JSON.stringify({ model: { modelId: "claude-4-sonnet" } })],
    ["/tmp/mc/.cursor/agents/sdd-apply.md", "---\nname: sdd-apply\nmodel: inherit\n---\n"]
  ]);
  const dirs = new Map([
    ["/tmp/mc/.claude/agents", ["sdd-apply.md"]],
    ["/tmp/mc/.cursor/agents", ["sdd-apply.md"]]
  ]);

  const catalog = await buildFleetModelsCatalog({
    homeDir: "/tmp/mc",
    read: async (path) => {
      if (!files.has(path)) {
        const err = new Error("missing");
        err.code = "ENOENT";
        throw err;
      }
      return files.get(path);
    },
    list: async (path) => dirs.get(path) ?? []
  });

  const by = Object.fromEntries(catalog.platforms.map((p) => [p.platform, p]));
  assert.equal(by.opencode.kind, "multi");
  assert.ok(by.opencode.available.includes("opencode-go/kimi-k2.6"));
  assert.deepEqual(by.claude.available, [...CLAUDE_TIERS]);
  assert.ok(by.claude.enabled.includes("sonnet"));
  assert.equal(by.codex.kind, "single");
  assert.deepEqual(by.codex.enabled, ["gpt-5.6-sol"]);
  assert.ok(by.cursor.enabled.includes("inherit"));
  assert.match(formatFleetModelsText(catalog), /available/);
});
