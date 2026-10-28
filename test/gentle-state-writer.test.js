import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, chmod, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planGentleStateWrite, applyGentleStateWrite } from "../src/global/gentle-state-writer.js";
import { recordKairoWrites, ensureHostBaseline } from "../src/global/team/manual-picks.js";

const picks = {
  "odd-explorer": { role: "Explorer", model: "haiku-x", adapterId: "claude" },
  "odd-worker": { role: "Builder", model: "sonnet-x", adapterId: "claude", effort: "high" },
  "odd-verify": { role: "Verifier", model: "opus-x", adapterId: "claude" }
};

const sha = (text) => createHash("sha256").update(text).digest("hex");

async function makeHome(content, { dir = true } = {}) {
  const home = await mkdtemp(join(tmpdir(), "gsw-"));
  const dirPath = join(home, ".gentle-ai");
  const file = join(dirPath, "state.json");
  if (dir) await mkdir(dirPath);
  if (content !== undefined) await writeFile(file, content);
  return { home, dirPath, file };
}

const baseState = {
  version: 4,
  other: { nested: [1, 2, { a: true }] },
  claude_phase_assignments: {
    "odd-explorer": { model: "old-model" },
    default: { model: "keep-me", effort: "low" },
    "review-risk": { model: "rev" }
  }
};
const baseText = (indent = 2) => `${JSON.stringify(baseState, null, indent)}\n`;

test("preview writes nothing and reports current/new/unchanged", async () => {
  const { home, file, dirPath } = await makeHome(baseText());
  await recordKairoWrites(home, "claude", { "odd-explorer": { model: "old-model" } });
  const before = sha(await readFile(file, "utf8"));
  const plan = await planGentleStateWrite({ homeDir: home, picks });
  assert.equal(plan.ok, true);
  assert.equal(plan.createsField, false);
  assert.deepEqual(plan.changes["odd-explorer"].current, { model: "old-model" });
  assert.deepEqual(plan.changes["odd-explorer"].next, { model: "haiku-x" });
  assert.deepEqual(plan.changes["odd-worker"].next, { model: "sonnet-x", effort: "high" });
  const res = await applyGentleStateWrite({ homeDir: home, picks });
  assert.equal(res.applied, false);
  assert.equal(res.ok, true);
  assert.equal(sha(await readFile(file, "utf8")), before);
  assert.deepEqual(await readdir(dirPath), ["state.json"]);
});

test("yes=true writes only odd-* keys, rest preserved, backup has original bytes", async () => {
  const { home, file, dirPath } = await makeHome(baseText());
  await recordKairoWrites(home, "claude", { "odd-explorer": { model: "old-model" } });
  const original = await readFile(file, "utf8");
  const res = await applyGentleStateWrite({ homeDir: home, picks, yes: true });
  assert.equal(res.applied, true);
  const next = JSON.parse(await readFile(file, "utf8"));
  const expected = structuredClone(baseState);
  expected.claude_phase_assignments["odd-explorer"] = { model: "haiku-x" };
  expected.claude_phase_assignments["odd-worker"] = { model: "sonnet-x", effort: "high" };
  expected.claude_phase_assignments["odd-verify"] = { model: "opus-x" };
  assert.deepEqual(next, expected);
  assert.deepEqual(next.claude_phase_assignments.default, baseState.claude_phase_assignments.default);
  assert.equal("effort" in next.claude_phase_assignments["odd-verify"], false);
  assert.equal(await readFile(res.backupPath, "utf8"), original);
  const files = await readdir(dirPath);
  assert.equal(files.length, 2);
  assert.ok(files.some((n) => n.startsWith("state.json.kairo-backup.")));
});

test("indentation and mode preserved", async () => {
  for (const indent of [4, "\t"]) {
    const { home, file } = await makeHome(baseText(indent));
    await chmod(file, 0o600);
    await applyGentleStateWrite({ homeDir: home, picks, yes: true });
    const text = await readFile(file, "utf8");
    assert.ok(text.includes(`\n${indent === 4 ? "    " : "\t"}"version"`));
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
});

test("absent claude_phase_assignments is created and flagged", async () => {
  const { home, file } = await makeHome(`${JSON.stringify({ keep: 1 }, null, 2)}\n`);
  const plan = await planGentleStateWrite({ homeDir: home, picks });
  assert.equal(plan.createsField, true);
  await applyGentleStateWrite({ homeDir: home, picks, yes: true });
  const next = JSON.parse(await readFile(file, "utf8"));
  assert.equal(next.keep, 1);
  assert.deepEqual(Object.keys(next.claude_phase_assignments).sort(), ["odd-explorer", "odd-verify", "odd-worker"]);
});

test("unchanged keys are reported and not rewritten", async () => {
  const { home } = await makeHome(baseText());
  const plan = await planGentleStateWrite({
    homeDir: home,
    picks: { "odd-explorer": { role: "Explorer", model: "old-model", adapterId: "claude" } }
  });
  assert.deepEqual(plan.unchanged, ["odd-explorer"]);
  assert.deepEqual(plan.changes, {});
});

test("non odd keys in picks are refused", async () => {
  const { home, file } = await makeHome(baseText());
  const before = sha(await readFile(file, "utf8"));
  const res = await applyGentleStateWrite({ homeDir: home, picks: { default: { model: "x" } }, yes: true });
  assert.equal(res.ok, false);
  assert.equal(res.applied, false);
  assert.equal(sha(await readFile(file, "utf8")), before);
});

const refusals = {
  "missing file": [undefined, /missing/i],
  "invalid JSON": ["{not json", /JSON/i],
  "root array": ["[]\n", /object/i],
  "assignments not object": [`${JSON.stringify({ claude_phase_assignments: [] })}\n`, /claude_phase_assignments/]
};
for (const [name, [content, re]] of Object.entries(refusals)) {
  test(`refuses: ${name}; file untouched`, async () => {
    const { home, file, dirPath } = await makeHome(content);
    const before = content === undefined ? null : sha(await readFile(file, "utf8"));
    const res = await applyGentleStateWrite({ homeDir: home, picks, yes: true });
    assert.equal(res.ok, false);
    assert.equal(res.applied, false);
    assert.match(res.reasons.join(" "), re);
    if (before) assert.equal(sha(await readFile(file, "utf8")), before);
    assert.deepEqual((await readdir(dirPath)).filter((n) => n !== "state.json"), []);
  });
}

test("refuses: empty picks; file untouched", async () => {
  const { home, file } = await makeHome(baseText());
  const before = sha(await readFile(file, "utf8"));
  const res = await applyGentleStateWrite({ homeDir: home, picks: {}, yes: true });
  assert.equal(res.ok, false);
  assert.equal(res.applied, false);
  assert.match(res.reasons.join(" "), /picks/i);
  assert.equal(sha(await readFile(file, "utf8")), before);
  await rm(home, { recursive: true, force: true });
});

test("non-Claude pick is refused without writing", async () => {
  const { home, file, dirPath } = await makeHome(baseText());
  const before = sha(await readFile(file, "utf8"));
  const bad = { ...picks, "odd-worker": { role: "Builder", model: "gpt-x", adapterId: "codex" } };
  for (const fn of [planGentleStateWrite, applyGentleStateWrite]) {
    const res = await fn({ homeDir: home, picks: bad, yes: true });
    assert.equal(res.ok, false);
    assert.equal(res.applied, false);
    assert.match(res.reasons.join("\n"), /Builder.*gpt-x.*codex/);
  }
  assert.equal(sha(await readFile(file, "utf8")), before);
  assert.deepEqual(await readdir(dirPath), ["state.json"]);
});

test("two changing applies with the same now keep distinct backups", async () => {
  const { home, file, dirPath } = await makeHome(baseText());
  const original = await readFile(file, "utf8");
  const first = await applyGentleStateWrite({ homeDir: home, picks, yes: true, now: () => 7 });
  const afterFirst = await readFile(file, "utf8");
  const next = { ...picks, "odd-verify": { role: "Verifier", model: "other-x", adapterId: "claude" } };
  const second = await applyGentleStateWrite({ homeDir: home, picks: next, yes: true, now: () => 7 });
  assert.notEqual(first.backupPath, second.backupPath);
  assert.equal(await readFile(first.backupPath, "utf8"), original);
  assert.equal(await readFile(second.backupPath, "utf8"), afterFirst);
  assert.equal((await readdir(dirPath)).length, 3);
});

test("a manual odd-* value is kept, reported as kept manual, and never overwritten", async () => {
  const { home, file } = await makeHome(baseText());
  await ensureHostBaseline(home, {}, "claude", {});
  const plan = await planGentleStateWrite({ homeDir: home, picks });
  assert.deepEqual(plan.keptManual, [{ key: "odd-explorer", current: { model: "old-model" } }]);
  assert.equal("odd-explorer" in plan.changes, false);
  const res = await applyGentleStateWrite({ homeDir: home, picks, yes: true });
  assert.deepEqual(res.keptManual.map((row) => row.key), ["odd-explorer"]);
  const next = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(next.claude_phase_assignments["odd-explorer"], { model: "old-model" });
  assert.deepEqual(next.claude_phase_assignments["odd-worker"], { model: "sonnet-x", effort: "high" });
});

test("a value Kairo wrote is not manual on the next apply, a user edit afterwards is", async () => {
  const { home, file } = await makeHome(baseText());
  await recordKairoWrites(home, "claude", { "odd-explorer": { model: "old-model" } });
  await applyGentleStateWrite({ homeDir: home, picks, yes: true });
  const again = { ...picks, "odd-explorer": { ...picks["odd-explorer"], model: "haiku-y" } };
  const second = await planGentleStateWrite({ homeDir: home, picks: again });
  assert.deepEqual(second.keptManual, []);
  assert.deepEqual(second.changes["odd-explorer"].next, { model: "haiku-y" });
  const state = JSON.parse(await readFile(file, "utf8"));
  state.claude_phase_assignments["odd-explorer"] = { model: "by-hand" };
  await writeFile(file, JSON.stringify(state));
  const third = await planGentleStateWrite({ homeDir: home, picks: again });
  assert.deepEqual(third.keptManual.map((row) => row.key), ["odd-explorer"]);
});

test("starting point: with no ledger an existing odd-* value is not manual and the writer updates it", async () => {
  const { home, file } = await makeHome(baseText());
  const plan = await planGentleStateWrite({ homeDir: home, picks });
  assert.deepEqual(plan.keptManual, []);
  assert.deepEqual(plan.changes["odd-explorer"].next, { model: "haiku-x" });
  await applyGentleStateWrite({ homeDir: home, picks, yes: true });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).claude_phase_assignments["odd-explorer"], { model: "haiku-x" });
  const state = JSON.parse(await readFile(file, "utf8"));
  state.claude_phase_assignments["odd-worker"] = { model: "by-hand" };
  await writeFile(file, JSON.stringify(state));
  const later = await planGentleStateWrite({ homeDir: home, picks: { "odd-worker": picks["odd-worker"] } });
  assert.deepEqual(later.keptManual.map((row) => row.key), ["odd-worker"]);
});

test("key order of a recorded entry does not make it manual", async () => {
  const { home } = await makeHome(`${JSON.stringify({ claude_phase_assignments: { "odd-worker": { model: "sonnet-x", effort: "high" } } })}\n`);
  await ensureHostBaseline(home, {}, "claude", {});
  await recordKairoWrites(home, "claude", { "odd-worker": { effort: "high", model: "sonnet-x" } });
  const plan = await planGentleStateWrite({ homeDir: home, picks: { "odd-worker": { ...picks["odd-worker"], model: "next-x" } } });
  assert.deepEqual(plan.keptManual, []);
  assert.deepEqual(plan.changes["odd-worker"].next, { model: "next-x", effort: "high" });
});
