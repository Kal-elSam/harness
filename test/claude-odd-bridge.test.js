import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planClaudeOddBridge, applyClaudeOddBridge, retireClaudeOddBridge, BRIDGE_ROLES
} from "../src/global/claude-odd-bridge.js";

const picks = {
  "odd-explorer": { model: "claude-haiku-4-5" },
  "odd-worker": { model: "claude-sonnet-5-5", effort: "high" },
  "odd-verify": { model: "claude-opus-5-5" }
};

async function home() {
  return mkdtemp(join(tmpdir(), "odd-bridge-"));
}
const agentPath = (h, role) => join(h, ".claude", "agents", `${role}.md`);

test("preview writes nothing and reports create", async () => {
  const h = await home();
  const plan = await planClaudeOddBridge({ homeDir: h, picks });
  assert.deepEqual(plan.roles.map((r) => r.action), ["create", "create", "create"]);
  const applied = await applyClaudeOddBridge({ homeDir: h, picks });
  assert.equal(applied.applied, false);
  await assert.rejects(stat(join(h, ".claude")));
  await rm(h, { recursive: true });
});

test("yes creates three files with model and marker, creating the agents dir", async () => {
  const h = await home();
  const res = await applyClaudeOddBridge({ homeDir: h, picks, yes: true });
  assert.equal(res.applied, true);
  for (const role of BRIDGE_ROLES) {
    const text = await readFile(agentPath(h, role), "utf8");
    assert.match(text, new RegExp(`^---\\nname: ${role}\\n`));
    assert.match(text, new RegExp(`\\nmodel: ${picks[role].model}\\n`));
    assert.match(text, new RegExp(`<!-- kairo-bridge: v1 role=${role} -->`));
    assert.doesNotMatch(text, /\ntools:/);
    assert.doesNotMatch(text, /\neffort:/);
  }
  await rm(h, { recursive: true });
});

test("foreign file is skipped and untouched by apply and retire", async () => {
  const h = await home();
  await mkdir(join(h, ".claude", "agents"), { recursive: true });
  const foreign = "---\nname: odd-worker\nmodel: opus\n---\nmine\n";
  await writeFile(agentPath(h, "odd-worker"), foreign);
  const plan = await planClaudeOddBridge({ homeDir: h, picks });
  assert.equal(plan.roles.find((r) => r.role === "odd-worker").action, "skip-foreign");
  await applyClaudeOddBridge({ homeDir: h, picks, yes: true });
  assert.equal(await readFile(agentPath(h, "odd-worker"), "utf8"), foreign);
  const retired = await retireClaudeOddBridge({ homeDir: h, yes: true });
  assert.equal(await readFile(agentPath(h, "odd-worker"), "utf8"), foreign);
  assert.equal(retired.roles.find((r) => r.role === "odd-worker").action, "skip-foreign");
  await rm(h, { recursive: true });
});

test("update keeps a backup with the old bytes", async () => {
  const h = await home();
  await applyClaudeOddBridge({ homeDir: h, picks, yes: true });
  const old = await readFile(agentPath(h, "odd-verify"), "utf8");
  const next = { ...picks, "odd-verify": { model: "claude-sonnet-5-5" } };
  const plan = await planClaudeOddBridge({ homeDir: h, picks: next });
  assert.equal(plan.roles.find((r) => r.role === "odd-verify").action, "update");
  await applyClaudeOddBridge({ homeDir: h, picks: next, yes: true, now: () => 123 });
  assert.match(await readFile(agentPath(h, "odd-verify"), "utf8"), /model: claude-sonnet-5-5/);
  assert.equal(await readFile(`${agentPath(h, "odd-verify")}.kairo-backup.123`, "utf8"), old);
  await rm(h, { recursive: true });
});

test("unchanged pick does not rewrite or back up", async () => {
  const h = await home();
  await applyClaudeOddBridge({ homeDir: h, picks, yes: true });
  const before = await stat(agentPath(h, "odd-worker"));
  await new Promise((r) => setTimeout(r, 15));
  const plan = await planClaudeOddBridge({ homeDir: h, picks });
  assert.deepEqual(plan.roles.map((r) => r.action), ["unchanged", "unchanged", "unchanged"]);
  await applyClaudeOddBridge({ homeDir: h, picks, yes: true });
  assert.equal((await stat(agentPath(h, "odd-worker"))).mtimeMs, before.mtimeMs);
  assert.equal((await readdir(join(h, ".claude", "agents"))).length, 3);
  await rm(h, { recursive: true });
});

test("retire previews without yes, then removes only marked files", async () => {
  const h = await home();
  await applyClaudeOddBridge({ homeDir: h, picks: { "odd-explorer": picks["odd-explorer"], "odd-verify": picks["odd-verify"] }, yes: true });
  const foreign = "---\nname: odd-worker\n---\nmine\n";
  await writeFile(agentPath(h, "odd-worker"), foreign);
  const preview = await retireClaudeOddBridge({ homeDir: h });
  assert.equal(preview.applied, false);
  assert.equal((await stat(agentPath(h, "odd-explorer"))).isFile(), true);
  const done = await retireClaudeOddBridge({ homeDir: h, yes: true });
  assert.equal(done.applied, true);
  await assert.rejects(stat(agentPath(h, "odd-explorer")));
  await assert.rejects(stat(agentPath(h, "odd-verify")));
  assert.equal(await readFile(agentPath(h, "odd-worker"), "utf8"), foreign);
  await rm(h, { recursive: true });
});
