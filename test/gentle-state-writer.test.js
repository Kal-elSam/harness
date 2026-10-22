import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, chmod, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planGentleStateWrite, applyGentleStateWrite } from "../src/global/gentle-state-writer.js";

const picks = {
  "odd-explorer": { role: "Explorer", model: "haiku-x" },
  "odd-worker": { role: "Builder", model: "sonnet-x", effort: "high" },
  "odd-verify": { role: "Verifier", model: "opus-x" }
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
    picks: { "odd-explorer": { role: "Explorer", model: "old-model" } }
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
