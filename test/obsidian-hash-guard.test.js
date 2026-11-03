import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  stampKairoHash, verifyKairoHash
} from "../src/global/observability/obsidian-hash-guard.js";
import {
  classifyNoteWrite, planObsidianPublish, publishObsidianProposals
} from "../src/global/observability/obsidian-publisher.js";
import { renderDecisionMarkdown } from "../src/global/observability/obsidian-knowledge-preview.js";

const proposal = (body = "v1") =>
  renderDecisionMarkdown({ id: "d1", title: "Guarded", body, project: "alpha" }, { generatedAt: "t0" });

test("stamp records kairo_sha256 and verify detects any edit", () => {
  const stamped = stampKairoHash(proposal().markdown);
  assert.match(stamped, /\nkairo_sha256: "[0-9a-f]{64}"\n---\n/);
  assert.equal(verifyKairoHash(stamped).state, "ok");
  assert.equal(stampKairoHash(stamped), stamped, "stamping is idempotent");
  assert.equal(verifyKairoHash(stamped.replace("v1", "hand edit")).state, "modified");
  assert.equal(verifyKairoHash(proposal().markdown).state, "unrecorded");
  assert.equal(verifyKairoHash("# plain\n").state, "unrecorded");
});

test("classify with hashGuard: modified or unrecorded managed notes are refused", () => {
  const stamped = stampKairoHash(proposal("v1").markdown);
  const next = stampKairoHash(proposal("v2").markdown);
  assert.equal(classifyNoteWrite(stamped, next, { hashGuard: true }).action, "update");
  assert.equal(classifyNoteWrite(stamped, stamped, { hashGuard: true }).action, "skip");
  const edited = classifyNoteWrite(stamped.replace("v1", "mine"), next, { hashGuard: true });
  assert.equal(edited.action, "refuse");
  assert.match(edited.reason, /modified since last publish/);
  const legacy = classifyNoteWrite(proposal("v1").markdown, next, { hashGuard: true });
  assert.equal(legacy.action, "refuse");
  assert.match(legacy.reason, /no recorded hash/);
  assert.equal(classifyNoteWrite("# manual\n", next, { hashGuard: true }).reason, "manual content");
});

test("previous behavior holds without hashGuard", () => {
  assert.equal(classifyNoteWrite("kairo_kind: \"decision\"\n\n# x\n", "# y\n").action, "update");
  const p = proposal();
  const plan = planObsidianPublish([p], { kairoRoot: "/vault/Kairo" });
  assert.equal(plan.results[0].action, "create");
  assert.equal(plan.results[0].hash.length, 64);
});

test("publish with hashGuard: stamps on create, updates untouched, refuses edited, no backup for refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-hg-"));
  const kairoRoot = join(root, "Kairo");
  await mkdir(kairoRoot, { recursive: true });
  try {
    const p1 = proposal("v1");
    const created = await publishObsidianProposals({ kairoRoot, proposals: [p1], yes: true, hashGuard: true });
    assert.equal(created.state, "applied");
    const file = join(kairoRoot, p1.relativePath);
    const onDisk = await readFile(file, "utf8");
    assert.equal(verifyKairoHash(onDisk).state, "ok");

    const again = await publishObsidianProposals({ kairoRoot, proposals: [p1], yes: true, hashGuard: true });
    assert.equal(again.results[0].action, "skip");
    assert.equal(again.state, "noop");

    const p2 = proposal("v2");
    const updated = await publishObsidianProposals({ kairoRoot, proposals: [p2], yes: true, hashGuard: true });
    assert.equal(updated.results[0].action, "updated");
    assert.ok(updated.results[0].backupPath);

    const mine = (await readFile(file, "utf8")).replace("v2", "my own words");
    await writeFile(file, mine, "utf8");
    const p3 = proposal("v3");
    const refused = await publishObsidianProposals({ kairoRoot, proposals: [p3], yes: true, hashGuard: true });
    assert.equal(refused.results[0].action, "refuse");
    assert.match(refused.results[0].reason, /modified since last publish/);
    assert.equal(refused.state, "noop");
    assert.equal(await readFile(file, "utf8"), mine, "edited note untouched");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
