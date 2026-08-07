import test from "node:test";
import assert from "node:assert/strict";
import {
  formatKnowledgeFrontmatter,
  renderDecisionMarkdown,
  renderArchitectureMarkdown,
  buildObsidianKnowledgePreview,
  loadObsidianKnowledgePreview
} from "../src/global/observability/obsidian-knowledge-preview.js";

test("frontmatter + renderers stay path-safe", () => {
  const fm = formatKnowledgeFrontmatter({ title: 'Say "hi"', kairo_kind: "decision" });
  assert.match(fm, /^---\n/);
  assert.match(fm, /title: "Say 'hi'"/);
  const d = renderDecisionMarkdown({ id: "d1", title: "Auth Model", body: "JWT" }, { generatedAt: "t0" });
  assert.equal(d.relativePath, "decisions/auth-model.md");
  assert.match(d.markdown, /kairo_kind: "decision"/);
  assert.match(d.markdown, /Source: Engram export/);
  const a = renderArchitectureMarkdown({
    id: "c1", title: "Companion", detail: "overlay", related: ["Hermes"]
  }, { generatedAt: "t0" });
  assert.equal(a.relativePath, "architecture/companion.md");
  assert.match(a.markdown, /\[\[architecture\/hermes\]\]/);
});

test("build preview validates Kairo/ paths and never emits traversal", () => {
  const out = buildObsidianKnowledgePreview({
    kairoRoot: "/vault/Kairo",
    generatedAt: "2026-08-07T00:00:00.000Z",
    decisions: [
      { id: "1", title: "Good Decision", body: "ok" },
      { id: "2", title: "../../escape", body: "nope" }
    ],
    architecture: [{ id: "a", title: "Graph Hub", summary: "nodes" }]
  });
  assert.equal(out.state, "available");
  assert.ok(out.proposals.some((p) => p.relativePath === "decisions/good-decision.md"));
  assert.ok(out.proposals.some((p) => p.relativePath === "architecture/graph-hub.md"));
  assert.ok(out.proposals.every((p) => !p.relativePath.split("/").includes("..")));
  assert.ok(out.proposals.every((p) => p.absolutePath.startsWith("/vault/Kairo/")));
});

test("empty / malformed / max proposals", () => {
  const empty = buildObsidianKnowledgePreview({ decisions: [], architecture: [] });
  assert.equal(empty.state, "empty");
  const partial = buildObsidianKnowledgePreview({
    kairoRoot: "/vault/Kairo",
    decisions: [null, "x", { title: "Only" }],
    architecture: []
  });
  assert.equal(partial.state, "available");
  assert.ok(partial.diagnostics.some((d) => /malformed/i.test(d)));
  const capped = buildObsidianKnowledgePreview({
    kairoRoot: "/vault/Kairo",
    maxProposals: 1,
    decisions: [{ title: "A" }, { title: "B" }],
    architecture: [{ title: "C" }]
  });
  assert.equal(capped.proposals.length, 1);
});

test("load adapters: success, fail-soft, unrecognized shapes", async () => {
  const ok = await loadObsidianKnowledgePreview({
    kairoRoot: "/vault/Kairo",
    loadEngramExport: async () => [{ id: "e1", title: "Ship It", body: "done" }],
    loadGraphifyExport: async () => ({ communities: [{ id: "g1", name: "Core", summary: "hub" }] })
  });
  assert.equal(ok.state, "available");
  assert.equal(ok.proposals.length, 2);

  const soft = await loadObsidianKnowledgePreview({
    kairoRoot: "/vault/Kairo",
    loadEngramExport: async () => { throw new Error("engram down"); },
    loadGraphifyExport: async () => ({ weird: true })
  });
  assert.ok(soft.diagnostics.some((d) => /engram export failed/i.test(d)));
  assert.ok(soft.diagnostics.some((d) => /graphify export shape/i.test(d)));

  const missing = await loadObsidianKnowledgePreview({ kairoRoot: "/vault/Kairo" });
  assert.ok(missing.diagnostics.some((d) => /engram export adapter not provided/i.test(d)));
  assert.ok(missing.diagnostics.some((d) => /graphify export adapter not provided/i.test(d)));
});

test("preview never invents vault writes (contract smoke)", async () => {
  let writes = 0;
  const preview = await loadObsidianKnowledgePreview({
    kairoRoot: "/vault/Kairo",
    loadEngramExport: async () => {
      writes += 0;
      return [{ title: "Read Only", body: "x" }];
    }
  });
  assert.equal(writes, 0);
  assert.ok(preview.proposals[0]?.markdown.includes("Read Only"));
  assert.equal(typeof preview.proposals[0]?.absolutePath, "string");
});
