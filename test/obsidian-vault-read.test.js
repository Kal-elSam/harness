import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashBuffer } from "../src/hash.js";
import { createToolHandlers, registerKairoMcpTools } from "../src/global/mcp/kairo-mcp.js";

const scratch = await mkdtemp(join(tmpdir(), "kairo-vault-read-"));
console.log(`scratch: ${scratch}`);
const homeDir = join(scratch, "home");
const vault = join(scratch, "vault");
await mkdir(join(homeDir, ".harness"), { recursive: true });
await mkdir(vault);
await writeFile(join(homeDir, ".harness/obsidian.json"), JSON.stringify({ vaultPath: vault }));
const note = '---\ntitle: "Human memory"\nproject: "harness"\nkairo_kind: "decisions"\n---\n# Human memory\nRemember bounded reads.\n';
async function put(path, content = "Remember hidden.") {
  await mkdir(join(vault, path, ".."), { recursive: true });
  await writeFile(join(vault, path), content);
}
await put("Human/memory.md", note);
await put("Kairo/decisions/other.md", note.replace('"harness"', '"other"'));
await put("large.md", "x".repeat(20000));
await put("oversize.md", "x".repeat(262145));
for (const path of [".obsidian/a.md", ".kairo-backups/a.md", "Kairo/.kairo-backups/a.md", ".trash/a.md", ".env.md", "private.pem.md", "private.key.md", "id_rsa.md", "mysecret.md", "mytoken.md", "mycredential.md", "plain.txt"]) await put(path);
await writeFile(join(scratch, "outside.md"), "Remember outside.");
await symlink(join(scratch, "outside.md"), join(vault, "escape.md"));
await symlink(join(vault, ".obsidian/a.md"), join(vault, "alias.md"));
await symlink(scratch, join(vault, "escape-dir"));
const api = () => import("../src/global/observability/obsidian-vault-read.js");
const handlers = createToolHandlers({ homeDir, env: {} });
async function readBoth(path) {
  const { readObsidianVaultNote } = await api();
  return [await readObsidianVaultNote({ homeDir, path }), (await handlers.vault_read({ path })).structuredContent.data];
}

test("search covers human and Kairo notes with filters, metadata and bounded snippets", async () => {
  const { searchObsidianVault } = await api();
  for (const result of [await searchObsidianVault({ homeDir, query: "Remember", project: "harness", kind: "decisions" }), (await handlers.vault_search({ query: "Remember", project: "harness", kind: "decisions" })).structuredContent.data]) {
    assert.equal(result.state, "available");
    assert.deepEqual(result.results.map(x => x.path), ["Human/memory.md"]);
    assert.equal(result.results[0].title, "Human memory");
    assert.equal(result.results[0].frontmatter.project, "harness");
    assert.match(result.results[0].snippet, /Remember/);
    assert.ok(result.results[0].snippet.length <= 240);
    assert.equal(result.results[0].sha256, hashBuffer(Buffer.from(note)));
  }
  assert.equal((await searchObsidianVault({ homeDir, query: "Remember", project: "other" })).results.length, 1);
});
test("read returns full content and whole-file sha256", async () => {
  for (const r of await readBoth("Human/memory.md")) {
    assert.equal(r.content, note);
    assert.equal(r.sha256, hashBuffer(Buffer.from(note)));
    assert.equal(r.truncated, false);
  }
});
test("read truncates response but hashes entire bounded file", async () => {
  for (const r of await readBoth("large.md")) {
    assert.equal(r.truncated, true);
    assert.ok(Buffer.byteLength(r.content) <= 16384);
    assert.equal(r.sha256, hashBuffer(Buffer.from("x".repeat(20000))));
  }
});
test("absolute, dot-dot, Windows paths and NUL inputs refused", async () => {
  for (const path of ["../outside.md", "Human/../large.md", "/etc/passwd", "C:\\private.md", "Human\\..\\large.md", "bad\0.md"]) {
    for (const r of await readBoth(path)) assert.equal(r.code, "invalid_path");
  }
});
test("symlink escapes and aliases into excluded directories refused", async () => {
  for (const path of ["escape.md", "escape-dir/outside.md", "alias.md"]) {
    for (const r of await readBoth(path)) assert.equal(r.code, "forbidden_path");
  }
});
test("excluded directories, secret names and non-markdown are neither read nor searched", async () => {
  const paths = [".obsidian/a.md", ".kairo-backups/a.md", "Kairo/.kairo-backups/a.md", ".trash/a.md", ".env.md", "private.pem.md", "private.key.md", "id_rsa.md", "mysecret.md", "mytoken.md", "mycredential.md", "plain.txt"];
  for (const path of paths) for (const r of await readBoth(path)) assert.equal(r.code, "forbidden_path");
  const { searchObsidianVault } = await api();
  for (const r of [await searchObsidianVault({ homeDir, query: "Remember" }), (await handlers.vault_search({ query: "Remember" })).structuredContent.data]) assert.deepEqual(r.results.map(x => x.path).sort(), ["Human/memory.md", "Kairo/decisions/other.md"]);
});
test("oversized files refused", async () => {
  for (const r of await readBoth("oversize.md")) assert.equal(r.code, "file_too_large");
});
test("unconfigured vault never guesses a path", async () => {
  const { searchObsidianVault, readObsidianVaultNote } = await api();
  const homeDir = join(scratch, "unconfigured");
  const h = createToolHandlers({ homeDir, env: {} });
  for (const r of [await searchObsidianVault({ homeDir, query: "x" }), await readObsidianVaultNote({ homeDir, path: "x.md" }), (await h.vault_search({ query: "x" })).structuredContent.data, (await h.vault_read({ path: "x.md" })).structuredContent.data]) assert.equal(r.code, "not_configured");
});
test("result and traversal hard caps hold", async () => {
  const { searchObsidianVault } = await api();
  for (let i = 0; i < 1050; i++) await put(`many/${String(i).padStart(4, "0")}.md`, "capneedle");
  for (const r of [await searchObsidianVault({ homeDir, query: "capneedle", limit: 10000 }), (await handlers.vault_search({ query: "capneedle", limit: 10000 })).structuredContent.data]) {
    assert.equal(r.results.length, 50);
    assert.ok(r.walked <= 1000);
    assert.equal(r.truncated, true);
  }
  assert.equal((await searchObsidianVault({ homeDir, query: "capneedle", limit: 1 })).results.length, 1);
});
test("both tools registered on bound and unbound MCP servers", async () => {
  await api();
  for (const workspaceBound of [false, true]) {
    const registered = new Map();
    registerKairoMcpTools((name, config, handler) => registered.set(name, { config, handler }), { homeDir, workspaceBound, env: {} });
    for (const name of ["vault_search", "vault_read"]) assert.equal(typeof registered.get(name)?.handler, "function");
    assert.equal((await registered.get("vault_read").handler({ path: "Human/memory.md" })).structuredContent.data.content, note);
  }
});
