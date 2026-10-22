import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseAssignmentList,
  parsePlatformList,
  mapClaudeAssignmentsToOpenCode,
  buildFleetConfigurePlan,
  loadGentleClaudeAssignments,
  CLAUDE_TO_OPENCODE
} from "../src/global/fleet-configure.js";

async function gentleFixture(t, state) {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-fleet-gentle-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  await mkdir(join(homeDir, ".gentle-ai"));
  await writeFile(join(homeDir, ".gentle-ai", "state.json"), JSON.stringify(state));
  return homeDir;
}

test("loadGentleClaudeAssignments loads current model and optional effort", async (t) => {
  const assignments = {
    "odd-worker": { model: "sonnet", effort: "medium" },
    "odd-explorer": { model: "haiku" }
  };
  const homeDir = await gentleFixture(t, { claude_phase_assignments: assignments });
  const statePath = join(homeDir, ".gentle-ai", "state.json");
  const before = await readFile(statePath, "utf8");
  assert.deepEqual(await loadGentleClaudeAssignments(homeDir), assignments);
  assert.equal(await readFile(statePath, "utf8"), before);
});

test("loadGentleClaudeAssignments preserves legacy-only string assignments", async (t) => {
  const assignments = { default: "sonnet", "sdd-apply": "opus", "odd-worker": "haiku" };
  const homeDir = await gentleFixture(t, { claude_model_assignments: assignments });
  assert.deepEqual(await loadGentleClaudeAssignments(homeDir), assignments);
});

test("loadGentleClaudeAssignments prefers current field and normalizes entries", async (t) => {
  const homeDir = await gentleFixture(t, {
    claude_phase_assignments: {
      "odd-worker": { model: "sonnet", effort: "medium", extra: "ignored" },
      "odd-explorer": "haiku"
    },
    claude_model_assignments: { "odd-worker": "opus", "sdd-apply": "opus" }
  });
  assert.deepEqual(await loadGentleClaudeAssignments(homeDir), {
    "odd-worker": { model: "sonnet", effort: "medium" },
    "odd-explorer": { model: "haiku" }
  });
});

test("loadGentleClaudeAssignments skips current entries without a model", async (t) => {
  const homeDir = await gentleFixture(t, {
    claude_phase_assignments: { "odd-worker": { effort: "high" }, "odd-verify": { model: "opus" } }
  });
  assert.deepEqual(await loadGentleClaudeAssignments(homeDir), { "odd-verify": { model: "opus" } });
});

for (const field of ["claude_phase_assignments", "claude_model_assignments"]) {
  test(`buildFleetConfigurePlan imports ${field} without changing model values`, async (t) => {
    const models = { default: "sonnet", "sdd-apply": "opus" };
    const assignments = field === "claude_phase_assignments"
      ? Object.fromEntries(Object.entries(models).map(([key, model]) => [key, { model }]))
      : models;
    const homeDir = await gentleFixture(t, { [field]: assignments });
    await mkdir(join(homeDir, ".claude", "agents"), { recursive: true });
    await mkdir(join(homeDir, ".config", "opencode"), { recursive: true });
    await writeFile(join(homeDir, ".claude", "settings.json"), JSON.stringify({ model: "haiku" }));
    await writeFile(join(homeDir, ".claude", "agents", "sdd-apply.md"), "---\nmodel: haiku\n---\nbody\n");
    await writeFile(join(homeDir, ".config", "opencode", "opencode.json"), JSON.stringify({
      agent: { "sdd-apply": { mode: "subagent", model: CLAUDE_TO_OPENCODE.haiku } }
    }));
    const plan = await buildFleetConfigurePlan({ homeDir, from: "gentle", platforms: ["claude", "opencode"] });
    assert.equal(plan.source, "gentle");
    assert.equal(plan.changes.find(c => c.platform === "claude" && c.agent === "default").next.model, "sonnet");
    assert.match(plan.changes.find(c => c.platform === "claude" && c.agent === "sdd-apply").nextText, /model: opus/);
    assert.equal(plan.changes.find(c => c.platform === "opencode").next.agent["sdd-apply"].model, CLAUDE_TO_OPENCODE.opus);
  });
}

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

test("seedFleetProfile stores model strings for current and legacy Gentle state", async (t) => {
  const { seedFleetProfile } = await import("../src/global/fleet-models.js");
  const current = await gentleFixture(t, {
    claude_phase_assignments: { default: { model: "sonnet", effort: "low" }, "sdd-apply": { model: "opus", effort: "high" } }
  });
  const cp = await seedFleetProfile({ homeDir: current });
  assert.equal(cp.claudeDefault, "sonnet");
  assert.equal(cp.phases["sdd-apply"].claude, "opus");
  const legacy = await gentleFixture(t, { claude_model_assignments: { default: "haiku", "sdd-apply": "opus" } });
  const lp = await seedFleetProfile({ homeDir: legacy });
  assert.equal(lp.claudeDefault, "haiku");
  assert.equal(lp.phases["sdd-apply"].claude, "opus");
});
