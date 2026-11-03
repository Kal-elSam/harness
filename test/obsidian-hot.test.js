import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { runObsidianCli } from "../src/global/obsidian-command.js";
import { createToolHandlers, registerKairoMcpTools } from "../src/global/mcp/kairo-mcp.js";

const scratch = await mkdtemp(join(tmpdir(), "kairo-hot-"));
console.log(`scratch: ${scratch}`);
async function setup() {
  const base = await mkdtemp(join(scratch, "case-"));
  const homeDir = join(base, "home"), vault = join(base, "vault");
  await mkdir(join(homeDir, ".harness"), { recursive: true });
  await mkdir(vault);
  await writeFile(join(homeDir, ".harness/obsidian.json"), JSON.stringify({ vaultPath: vault }));
  let report, exit = 0, tick = 0;
  const records = [
    { id: "old", type: "decision", title: "Old decision", project: "alpha", content: "Old", updated_at: "2025-01-01" },
    { id: "new", type: "decision", title: "New decision", project: "alpha", content: "Use durable storage", updated_at: "2026-11-02" },
    { id: "arch", type: "architecture", title: "Core", project: "beta", content: "Separate adapters", updated_at: "2026-11-01" },
    { id: "bug", type: "bugfix", title: "Race fixed", project: "alpha", content: "Root cause: shared mutable state. Fix: isolate state.", updated_at: "2026-11-01" }
  ];
  const deps = { env: { HARNESS_HOME: homeDir }, print: s => { report = JSON.parse(s); },
    setExitCode: c => { exit = c; }, now: () => `2026-11-02T00:00:0${tick++}.000Z`,
    loadEngramExport: async () => ({ observations: records }), loadGraphifyExport: async () => ({ architecture: [] }) };
  return { homeDir, vault, records, publish: async (extra = {}) => {
    exit = 0;
    await runObsidianCli({ obsidianAction: "publish", json: true, ...extra }, deps);
    return { ...report, exit };
  } };
}

test("publish creates grouped, linked recent hot memory, with root cause and hard bounds", async () => {
  const s = await setup();
  await s.publish({ yes: true });
  const hot = await readFile(join(s.vault, "Kairo/hot.md"), "utf8");
  assert.match(hot, /kairo_kind: "hot"/);
  assert.match(hot, /## alpha/);
  assert.match(hot, /## beta/);
  assert.match(hot, /Root cause: shared mutable state/);
  assert.match(hot, /\[\[decisions\/alpha-new-decision-new\|New decision\]\]/);
  assert.ok(hot.indexOf("New decision") < hot.indexOf("Old decision"));
  assert.ok(hot.split("\n").length <= 100);
  assert.ok(Buffer.byteLength(hot) <= 12000);
  const { buildObsidianHotProposal } = await import("../src/global/observability/index.js");
  const proposals = Array.from({ length: 200 }, (_, i) => ({ relativePath: `decisions/n${i}.md`, markdown: `---\nproject: "p${i}"\nkairo_kind: "decision"\ntitle: "${"界".repeat(80)}"\n---\n# Title\n${"界".repeat(5000)}` }));
  const { stampKairoHash } = await import("../src/global/observability/obsidian-hash-guard.js");
  const bounded = stampKairoHash(buildObsidianHotProposal(proposals).markdown);
  assert.ok(Buffer.byteLength(bounded) <= 12000);
  assert.ok(bounded.split("\n").length <= 100);
});

test("unchanged hot memory skips even when publish clock changes", async () => {
  const s = await setup();
  await s.publish({ yes: true });
  const before = await readFile(join(s.vault, "Kairo/hot.md"), "utf8");
  const result = await s.publish({ yes: true });
  assert.equal(result.results.find(r => r.relativePath === "hot.md")?.action, "skip");
  assert.equal(await readFile(join(s.vault, "Kairo/hot.md"), "utf8"), before);
});

test("human-edited hot memory is refused without overwriting", async () => {
  const s = await setup();
  await s.publish({ yes: true });
  const path = join(s.vault, "Kairo/hot.md");
  const edited = `${await readFile(path, "utf8")}Human edit\n`;
  await writeFile(path, edited);
  const result = await s.publish({ yes: true });
  assert.equal(result.results.find(r => r.relativePath === "hot.md")?.action, "refuse");
  assert.equal(result.exit, 1);
  assert.equal(await readFile(path, "utf8"), edited);
});

test("dry run plans hot memory but writes nothing", async () => {
  const s = await setup();
  const result = await s.publish();
  assert.equal(result.dryRun, true);
  assert.equal(result.exit, 0);
  assert.equal(result.results.find(r => r.relativePath === "hot.md")?.action, "create");
  assert.deepEqual(await readdir(s.vault), []);
});

test("vault_hot registered bound and unbound; returns guarded content and sha256", async () => {
  const s = await setup();
  await s.publish({ yes: true });
  const content = await readFile(join(s.vault, "Kairo/hot.md"), "utf8");
  for (const workspaceBound of [false, true]) {
    const tools = new Map();
    registerKairoMcpTools((name, config, handler) => tools.set(name, handler), { homeDir: s.homeDir, env: {}, workspaceBound });
    assert.equal(typeof tools.get("vault_hot"), "function");
    const result = (await tools.get("vault_hot")({ path: "other.md" })).structuredContent;
    assert.equal(result.code, "ok");
    assert.equal(result.data.content, content);
    assert.equal(result.data.path, "Kairo/hot.md");
    assert.equal(result.data.sha256, createHash("sha256").update(content).digest("hex"));
  }
});

test("vault_hot returns typed unconfigured and missing-note results", async () => {
  const s = await setup();
  const missing = (await createToolHandlers({ homeDir: s.homeDir, env: {} }).vault_hot()).structuredContent;
  assert.equal(missing.code, "note_unavailable");
  const unset = (await createToolHandlers({ homeDir: join(s.homeDir, "unset"), env: {} }).vault_hot()).structuredContent;
  assert.equal(unset.code, "not_configured");
  assert.equal(unset.data.state, "unconfigured");
});
