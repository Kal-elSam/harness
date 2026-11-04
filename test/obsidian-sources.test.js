import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadObsidianKnowledgePreview } from "../src/global/observability/obsidian-knowledge-preview.js";
import { KAIRO_VIEW_KINDS, buildObsidianKnowledgeViews } from "../src/global/observability/obsidian-knowledge-views.js";
import { parseArgs } from "../src/cli.js";
import { runObsidianCli } from "../src/global/obsidian-command.js";
const fixture = JSON.parse(await readFile(new URL("./fixtures/obsidian/export.json", import.meta.url)));
async function scratch() { const path = await mkdtemp(join(tmpdir(), "obsidian-source-")); console.log(`scratch: ${path}`); return path; }

test("curation keeps newest N per kind/project, preserves bug root cause and existing kinds", async () => {
  const observations = [...fixture.observations, { ...fixture.observations[0], id: 5, created_at: "2026-10-05 00:00:00", updated_at: "2026-10-05 00:00:00" }, { ...fixture.observations[0], id: 6, project: "other" }];
  const result = await loadObsidianKnowledgePreview({ loadEngramExport: async () => ({ observations }), loadGraphifyExport: async () => [], maxPerKind: 1 });
  assert.equal(result.proposals.length, 4);
  assert.equal(new Set(result.proposals.map(p => p.relativePath)).size, 4);
  assert.ok(result.proposals.some(p => p.provenance.id === "5"));
  assert.ok(!result.proposals.some(p => p.provenance.id === "1"));
  const bug = result.proposals.find(p => p.relativePath.startsWith("bugs/"));
  assert.match(bug.markdown, /Root cause: stale key reused across projects/);
  assert.match(bug.markdown, /project: "demo"/);
  assert.deepEqual(KAIRO_VIEW_KINDS, ["projects", "decisions", "architecture", "sessions", "reviews", "bugs"]);
  const views = buildObsidianKnowledgeViews({ notes: KAIRO_VIEW_KINDS.map(k => ({ relativePath: `${k}/example.md` })) });
  for (const kind of KAIRO_VIEW_KINDS) assert.equal(views.views[kind].length, 1);
});

test("Graphify report produces bounded architecture; missing file is diagnostic, repo root resolved", async () => {
  const { loadGraphifyExport } = await import("../src/global/observability/obsidian-graphify-export.js");
  const root = await scratch();
  execFileSync("git", ["init", "-q", root]);
  await mkdir(join(root, "nested"));
  const absent = await loadGraphifyExport({ cwd: join(root, "nested"), project: "demo" });
  assert.deepEqual(absent.architecture, []);
  assert.match(absent.diagnostics.join(), /missing/i);
  await mkdir(join(root, "graphify-out"));
  const file = join(root, "graphify-out", "GRAPH_REPORT.md");
  const text = "# Report\n\n## God Nodes\nCore has many dependencies.\n\n## Communities\nStorage and UI.\n";
  await writeFile(file, text);
  const found = await loadGraphifyExport({ cwd: join(root, "nested"), project: "demo" });
  assert.equal(found.architecture.length, 2);
  assert.ok(found.architecture.every(a => a.project === "demo"));
  const bounded = await loadGraphifyExport({ projectDir: root, project: "demo", maxBytes: 10 });
  assert.deepEqual(bounded.architecture, []);
  assert.match(bounded.diagnostics.join(), /size|large/i);
  assert.equal(await readFile(file, "utf8"), text);
});

test("default loaders publish curated notes only with --yes and preserve hash guard and hubs", async () => {
  const root = await scratch();
  const vault = join(root, "vault"); await mkdir(vault);
  await mkdir(join(root, "graphify-out"));
  await writeFile(join(root, "graphify-out", "GRAPH_REPORT.md"), "# Report\n## Communities\nCore.\n");
  const out = []; let exit = 0;
  const deps = { env: { HARNESS_HOME: root }, cwd: root, print: x => out.push(x), setExitCode: x => { exit = x; }, execFile: async (bin, args) => {
    assert.equal(bin, "engram"); assert.equal(args.at(-1), "demo");
    await writeFile(args[1], JSON.stringify(fixture));
  }};
  await runObsidianCli({ obsidianAction: "config", obsidianVault: vault }, deps);
  const opts = { obsidianAction: "publish", obsidianProject: "demo", obsidianProjectDir: root, json: true };
  out.length = 0; await runObsidianCli(opts, deps);
  const dry = JSON.parse(out.pop());
  assert.equal(dry.dryRun, true); assert.equal(exit, 0);
  assert.equal(dry.counts.bugs, 1); assert.equal(dry.counts.architecture, 2);
  assert.deepEqual(await readdir(vault), []);
  out.length = 0; await runObsidianCli({ ...opts, yes: true }, deps);
  const applied = JSON.parse(out.pop()); assert.equal(applied.dryRun, false); assert.equal(exit, 0);
  const bug = applied.results.find(r => r.relativePath.startsWith("bugs/"));
  const path = join(vault, "Kairo", bug.relativePath);
  assert.match(await readFile(path, "utf8"), /Root cause/);
  assert.match(await readFile(join(vault, "Kairo/projects/demo.md"), "utf8"), /\[\[bugs\//);
  assert.match(await readFile(join(vault, "Kairo/Home.md"), "utf8"), /projects\/demo/);
  out.length = 0; await runObsidianCli({ ...opts, yes: true }, deps);
  assert.equal(JSON.parse(out.pop()).state, "noop");
  await writeFile(path, "human edit");
  out.length = 0; await runObsidianCli({ ...opts, yes: true }, deps);
  assert.ok(JSON.parse(out.pop()).results.some(r => r.action === "refuse"));
  assert.equal(exit, 1); assert.equal(await readFile(path, "utf8"), "human edit");
});

test("publish options and help name source, project directory and per-kind bound", () => {
  const p = parseArgs(["obsidian", "publish", "--project", "demo", "--project-dir", "/repo", "--max-per-kind", "2"]);
  assert.equal(p.options.obsidianProjectDir, "/repo"); assert.equal(p.options.obsidianMaxPerKind, 2);
  assert.equal(parseArgs(["obsidian", "publish", "--max-per-kind=3"]).options.obsidianMaxPerKind, 3);
  for (const value of ["0", "-1", "abc", "1.5", "1001"]) assert.throws(() => parseArgs(["obsidian", "publish", "--max-per-kind", value]), /max-per-kind/);
  const help = execFileSync(process.execPath, ["bin/kairo.js", "--help"], { encoding: "utf8" });
  assert.match(help, /--max-per-kind/); assert.match(help, /--project-dir/); assert.match(help, /Engram/);
});
