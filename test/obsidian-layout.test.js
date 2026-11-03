import test from "node:test";
import assert from "node:assert/strict";
import {
  renderDecisionMarkdown, renderArchitectureMarkdown, buildObsidianKnowledgePreview
} from "../src/global/observability/obsidian-knowledge-preview.js";
import {
  buildProjectLayoutProposals, layoutEntriesFromNotes
} from "../src/global/observability/obsidian-layout.js";
import { parseKnowledgeFrontmatter } from "../src/global/observability/obsidian-knowledge-views.js";

test("renderers add project frontmatter only when a project is known", () => {
  const d = renderDecisionMarkdown({ id: "d1", title: "Auth", body: "x", project: "Alpha" }, { generatedAt: "t0" });
  assert.equal(parseKnowledgeFrontmatter(d.markdown).fields.project, "Alpha");
  const a = renderArchitectureMarkdown({ id: "a1", title: "Core" }, { generatedAt: "t0", project: "Beta" });
  assert.equal(parseKnowledgeFrontmatter(a.markdown).fields.project, "Beta");
  const none = renderDecisionMarkdown({ id: "d2", title: "Old" }, { generatedAt: "t0" });
  assert.equal(parseKnowledgeFrontmatter(none.markdown).fields.project, undefined);
});

test("preview applies defaultProject to records without one", () => {
  const out = buildObsidianKnowledgePreview({
    kairoRoot: "/vault/Kairo", generatedAt: "t0", defaultProject: "gamma",
    decisions: [{ id: "d1", title: "One" }, { id: "d2", title: "Two", project: "alpha" }],
    architecture: [{ id: "a1", title: "Core" }]
  });
  const projects = out.proposals.map((p) => parseKnowledgeFrontmatter(p.markdown).fields.project);
  assert.deepEqual(projects, ["gamma", "alpha", "gamma"]);
});

test("layout: one hub per project with wikilinks, plus Home index", () => {
  const entries = [
    { relativePath: "decisions/auth.md", title: "Auth", project: "alpha", kind: "decision" },
    { relativePath: "architecture/core.md", title: "Core", project: "alpha", kind: "architecture" },
    { relativePath: "decisions/billing.md", title: "Billing", project: "beta Corp", kind: "decision" }
  ];
  const out = buildProjectLayoutProposals(entries, { kairoRoot: "/vault/Kairo" });
  const paths = out.proposals.map((p) => p.relativePath);
  assert.deepEqual(paths, ["projects/alpha.md", "projects/beta-corp.md", "Home.md"]);
  const [alpha, beta, home] = out.proposals;
  assert.match(alpha.markdown, /\[\[decisions\/auth\|Auth\]\]/);
  assert.match(alpha.markdown, /\[\[architecture\/core\|Core\]\]/);
  assert.doesNotMatch(alpha.markdown, /billing/);
  assert.match(beta.markdown, /\[\[decisions\/billing\|Billing\]\]/);
  assert.equal(parseKnowledgeFrontmatter(alpha.markdown).fields.project, "alpha");
  assert.equal(parseKnowledgeFrontmatter(alpha.markdown).fields.kairo_kind, "projects");
  assert.match(home.markdown, /\[\[projects\/alpha\|alpha\]\]/);
  assert.match(home.markdown, /\[\[projects\/beta-corp\|beta Corp\]\]/);
  assert.equal(parseKnowledgeFrontmatter(home.markdown).fields.kairo_kind, "home");
  const again = buildProjectLayoutProposals(entries, { kairoRoot: "/vault/Kairo" });
  assert.deepEqual(again.proposals.map((p) => p.markdown), out.proposals.map((p) => p.markdown));
});

test("layout: no entries yields nothing; hubs and Home never link themselves", () => {
  assert.deepEqual(buildProjectLayoutProposals([], { kairoRoot: "/vault/Kairo" }).proposals, []);
  const notes = [
    { relativePath: "projects/alpha.md", markdown: '---\nkairo_kind: "projects"\nproject: "alpha"\n---\n# a\n' },
    { relativePath: "Home.md", markdown: '---\nkairo_kind: "home"\n---\n# h\n' },
    { relativePath: "decisions/auth.md", markdown: '---\nkairo_kind: "decision"\nproject: "alpha"\ntitle: "Auth"\n---\n# Auth\n' },
    { relativePath: "decisions/old.md", markdown: '---\nkairo_kind: "decision"\ntitle: "Old"\n---\n# Old\n' }
  ];
  const entries = layoutEntriesFromNotes(notes);
  assert.deepEqual(entries.map((e) => e.relativePath), ["decisions/auth.md"]);
  assert.equal(entries[0].project, "alpha");
});
