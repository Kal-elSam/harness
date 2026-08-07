import test from "node:test";
import assert from "node:assert/strict";
import {
  KAIRO_VIEW_KINDS,
  parseKnowledgeFrontmatter,
  extractWikilinks,
  buildObsidianKnowledgeViews,
  buildKnowledgeIndexProposals,
  loadObsidianKnowledgeViews
} from "../src/global/observability/obsidian-knowledge-views.js";
import { formatKnowledgeFrontmatter } from "../src/global/observability/obsidian-knowledge-preview.js";

test("parse frontmatter + extract wikilinks", () => {
  const md = `${formatKnowledgeFrontmatter({ kairo_kind: "decision", title: "Auth" })}# Auth\n\nSee [[architecture/companion|Hub]] and [[decisions/auth]].\n`;
  const parsed = parseKnowledgeFrontmatter(md);
  assert.equal(parsed.fields.kairo_kind, "decision");
  assert.equal(parsed.fields.title, "Auth");
  assert.deepEqual(extractWikilinks(md), ["architecture/companion", "decisions/auth"]);
  assert.equal(parseKnowledgeFrontmatter("# no fm\n").hasFrontmatter, false);
});

test("build views buckets + link graph; skip unsafe paths", () => {
  const decisionMd = `${formatKnowledgeFrontmatter({
    kairo_kind: "decision", kairo_id: "d1", title: "Ship"
  })}# Ship\n\n[[architecture/core]]\n`;
  const archMd = `${formatKnowledgeFrontmatter({
    kairo_kind: "architecture", title: "Core"
  })}# Core\n`;
  const out = buildObsidianKnowledgeViews({
    kairoRoot: "/vault/Kairo",
    notes: [
      { relativePath: "decisions/ship.md", title: "Ship" },
      { relativePath: "architecture/core.md", title: "Core" },
      { relativePath: "../escape.md", title: "bad" },
      { relativePath: "misc/orphan.md", title: "Orphan" }
    ],
    contentsByPath: {
      "decisions/ship.md": decisionMd,
      "architecture/core.md": archMd
    }
  });
  assert.equal(out.state, "available");
  assert.equal(out.views.decisions.length, 1);
  assert.equal(out.views.architecture[0].title, "Core");
  assert.ok(out.links.some((l) => l.from === "decisions/ship" && l.to === "architecture/core"));
  assert.ok(out.diagnostics.some((d) => /escape|unclassified/i.test(d)));
  assert.deepEqual(KAIRO_VIEW_KINDS.length, 5);
});

test("index proposals are publish-ready and path-gated", () => {
  const views = buildObsidianKnowledgeViews({
    kairoRoot: "/vault/Kairo",
    notes: [{ relativePath: "sessions/s1.md", title: "S1" }],
    contentsByPath: {
      "sessions/s1.md": `${formatKnowledgeFrontmatter({ kairo_kind: "sessions", title: "S1" })}# S1\n`
    }
  });
  const idx = buildKnowledgeIndexProposals(views, {
    kairoRoot: "/vault/Kairo", generatedAt: "t0"
  });
  assert.equal(idx.proposals.length, 5);
  const sessions = idx.proposals.find((p) => p.relativePath === "sessions/index.md");
  assert.ok(sessions.markdown.includes("[[sessions/s1|S1]]"));
  assert.match(sessions.markdown, /kairo_kind: "sessions"/);
  assert.ok(sessions.absolutePath.startsWith("/vault/Kairo/"));
});

test("loadObsidianKnowledgeViews fail-soft + injectable read", async () => {
  const loaded = await loadObsidianKnowledgeViews({
    vaultPath: "/vault",
    inspectVault: async () => ({
      state: "available", vaultPath: "/vault", kairoRoot: "/vault/Kairo",
      notes: [{ relativePath: "reviews/r1.md", title: "R1" }], diagnostics: []
    }),
    readNote: async (rel) => `${formatKnowledgeFrontmatter({
      kairo_kind: "reviews", title: "R1"
    })}# R1\n\n[[decisions/ship]]\n`
  });
  assert.equal(loaded.views.reviews[0].relativePath, "reviews/r1.md");
  assert.ok(loaded.links.some((l) => l.to === "decisions/ship"));

  const missing = await loadObsidianKnowledgeViews({});
  assert.match(missing.error ?? "", /inspectVault/);

  const boom = await loadObsidianKnowledgeViews({
    inspectVault: async () => { throw new Error("down"); }
  });
  assert.match(boom.error ?? "", /down/);
});
