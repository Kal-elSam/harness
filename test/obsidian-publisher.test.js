import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyNoteWrite, hasConsent, planObsidianPublish, publishObsidianProposals, BACKUP_DIR_NAME
} from "../src/global/observability/obsidian-publisher.js";
import { renderDecisionMarkdown } from "../src/global/observability/obsidian-knowledge-preview.js";

const proposal = (title = "Ship Gate", body = "ok") =>
  renderDecisionMarkdown({ id: "d1", title, body }, { generatedAt: "t0" });

test("consent + classify helpers", () => {
  assert.equal(hasConsent({}), false);
  assert.equal(hasConsent({ yes: true }), true);
  assert.equal(classifyNoteWrite("a", "a").action, "skip");
  assert.equal(classifyNoteWrite("kairo_kind: \"decision\"\n\n# x\n", "# y\n").action, "update");
  assert.equal(classifyNoteWrite("# manual\n", "# other\n").action, "refuse");
});

test("plan: create / skip / refuse manual / path escape", () => {
  const good = proposal();
  assert.equal(planObsidianPublish([good], { kairoRoot: "/vault/Kairo" }).results[0].action, "create");
  assert.equal(planObsidianPublish([good], {
    kairoRoot: "/vault/Kairo", existingByPath: { [good.relativePath]: good.markdown }
  }).results[0].action, "skip");
  assert.equal(planObsidianPublish([good], {
    kairoRoot: "/vault/Kairo", existingByPath: { [good.relativePath]: "# hand written\n" }
  }).results[0].action, "refuse");
  assert.equal(planObsidianPublish(
    [{ relativePath: "../x.md", markdown: "# x" }], { kairoRoot: "/vault/Kairo" }
  ).results[0].action, "refuse");
});

test("publish blocks without consent; dryRun never writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-pub-"));
  const kairoRoot = join(root, "Kairo");
  await mkdir(kairoRoot, { recursive: true });
  try {
    const p = proposal("Blocked");
    const blocked = await publishObsidianProposals({ kairoRoot, proposals: [p] });
    assert.equal(blocked.state, "blocked");
    const dry = await publishObsidianProposals({ kairoRoot, proposals: [p], dryRun: true, yes: true });
    assert.equal(dry.state, "planned");
    await assert.rejects(() => readFile(join(kairoRoot, p.relativePath), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("publish: create, skip, managed update+backup, refuse manual", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-pub-"));
  const kairoRoot = join(root, "Kairo");
  await mkdir(kairoRoot, { recursive: true });
  try {
    const p1 = proposal("Alpha", "v1");
    const created = await publishObsidianProposals({ kairoRoot, proposals: [p1], yes: true });
    assert.equal(created.state, "applied");
    assert.equal(created.results[0].action, "created");
    assert.equal(await readFile(join(kairoRoot, p1.relativePath), "utf8"), p1.markdown);

    assert.equal((await publishObsidianProposals({
      kairoRoot, proposals: [p1], confirm: true
    })).results[0].action, "skip");

    const p2 = proposal("Alpha", "v2");
    const updated = await publishObsidianProposals({ kairoRoot, proposals: [p2], yes: true });
    assert.equal(updated.results[0].action, "updated");
    assert.ok(updated.results[0].backupPath?.includes(BACKUP_DIR_NAME));
    assert.match(await readFile(updated.results[0].backupPath, "utf8"), /v1/);

    await writeFile(join(kairoRoot, "decisions", "manual-note.md"), "# mine\n", "utf8");
    const manual = await publishObsidianProposals({
      kairoRoot, yes: true,
      proposals: [{ relativePath: "decisions/manual-note.md", markdown: "kairo_kind: \"decision\"\n\n# x\n" }]
    });
    assert.equal(manual.results[0].action, "refuse");
    assert.equal(await readFile(join(kairoRoot, "decisions", "manual-note.md"), "utf8"), "# mine\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
