import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, rm, symlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planClaudeOddBridge, applyClaudeOddBridge, retireClaudeOddBridge, renderBridgeAgent, BRIDGE_ROLES
} from "../src/global/claude-odd-bridge.js";

const picks = {
  "odd-explorer": { model: "claude-haiku-4-5", adapterId: "claude" },
  "odd-worker": { model: "claude-sonnet-5-5", adapterId: "claude", effort: "high" },
  "odd-verify": { model: "claude-opus-5-5", adapterId: "claude" }
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
  const next = { ...picks, "odd-verify": { model: "claude-sonnet-5-5", adapterId: "claude" } };
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

test("non-Claude pick is refused without writing", async () => {
  const h = await home();
  const bad = { ...picks, "odd-worker": { model: "gpt-x", adapterId: "codex" } };
  const plan = await planClaudeOddBridge({ homeDir: h, picks: bad });
  assert.equal(plan.ok, false);
  assert.match(plan.reasons.join("\n"), /odd-worker.*gpt-x.*codex/);
  const res = await applyClaudeOddBridge({ homeDir: h, picks: bad, yes: true });
  assert.equal(res.ok, false);
  assert.equal(res.applied, false);
  await assert.rejects(stat(join(h, ".claude")));
  await rm(h, { recursive: true });
});

test("same-now updates keep distinct backups", async () => {
  const h = await home();
  await applyClaudeOddBridge({ homeDir: h, picks, yes: true });
  const v0 = await readFile(agentPath(h, "odd-verify"), "utf8");
  const p1 = { ...picks, "odd-verify": { model: "claude-sonnet-5-5", adapterId: "claude" } };
  const p2 = { ...picks, "odd-verify": { model: "claude-haiku-4-5", adapterId: "claude" } };
  const a = await applyClaudeOddBridge({ homeDir: h, picks: p1, yes: true, now: () => 5 });
  const v1 = await readFile(agentPath(h, "odd-verify"), "utf8");
  const b = await applyClaudeOddBridge({ homeDir: h, picks: p2, yes: true, now: () => 5 });
  const ba = a.roles.find((r) => r.role === "odd-verify").backupPath;
  const bb = b.roles.find((r) => r.role === "odd-verify").backupPath;
  assert.notEqual(ba, bb);
  assert.equal(await readFile(ba, "utf8"), v0);
  assert.equal(await readFile(bb, "utf8"), v1);
  await rm(h, { recursive: true });
});

test("symlinks (dangling or to a marked file) are foreign and untouched", async () => {
  const h = await home();
  const dir = join(h, ".claude", "agents");
  await mkdir(dir, { recursive: true });
  const elsewhere = join(h, "elsewhere.md");
  const marked = renderBridgeAgent("odd-verify", "claude-opus-5-5");
  await writeFile(elsewhere, marked);
  await symlink(join(h, "missing.md"), agentPath(h, "odd-worker"));
  await symlink(elsewhere, agentPath(h, "odd-verify"));
  const plan = await planClaudeOddBridge({ homeDir: h, picks });
  for (const role of ["odd-worker", "odd-verify"]) {
    assert.equal(plan.roles.find((r) => r.role === role).action, "skip-foreign");
  }
  await applyClaudeOddBridge({ homeDir: h, picks, yes: true });
  const retired = await retireClaudeOddBridge({ homeDir: h, yes: true });
  for (const role of ["odd-worker", "odd-verify"]) {
    assert.equal(retired.roles.find((r) => r.role === role).action, "skip-foreign");
    assert.equal((await lstat(agentPath(h, role))).isSymbolicLink(), true);
  }
  assert.equal(await readFile(elsewhere, "utf8"), marked);
  await assert.rejects(stat(join(h, "missing.md")));
  await rm(h, { recursive: true });
});
