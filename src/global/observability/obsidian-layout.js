import { resolveKairoNotePath } from "./obsidian-vault.js";
import {
  formatKnowledgeFrontmatter, scrubTitle, slugify
} from "./obsidian-knowledge-preview.js";
import { parseKnowledgeFrontmatter } from "./obsidian-knowledge-views.js";

export const HOME_NOTE = "Home.md";
export const PROJECT_HUB_DIR = "projects";

const wikiPath = (relativePath) => relativePath.replace(/\.md$/i, "");

/**
 * Entries `{ relativePath, title, project, kind }` for notes that belong to a project,
 * read from note markdown. Hubs, Home and notes without a `project:` field are skipped.
 */
export function layoutEntriesFromNotes(notes = []) {
  const entries = [];
  for (const note of notes) {
    if (note == null || typeof note.markdown !== "string") continue;
    const { fields } = parseKnowledgeFrontmatter(note.markdown);
    const kind = fields.kairo_kind;
    if (!fields.project || !kind || kind === "projects" || kind === "home") continue;
    entries.push({
      relativePath: note.relativePath,
      title: fields.title || note.relativePath.replace(/\.md$/i, "").split("/").pop(),
      project: fields.project,
      kind
    });
  }
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Deterministic hub-per-project and Home index proposals. No timestamps, so an
 * unchanged vault republishes as identical (skip).
 */
export function buildProjectLayoutProposals(entries = [], { kairoRoot = "/virtual/Kairo" } = {}) {
  const diagnostics = [];
  const byProject = new Map();
  for (const entry of entries) {
    const project = scrubTitle(entry?.project, "");
    if (!project || !entry?.relativePath) continue;
    if (!byProject.has(project)) byProject.set(project, new Map());
    byProject.get(project).set(entry.relativePath, entry);
  }
  const proposals = [];
  const add = (relativePath, title, id, markdown) => {
    const gate = resolveKairoNotePath(kairoRoot, relativePath);
    if (!gate.ok) { diagnostics.push(`layout ${relativePath}: ${gate.reason}`); return; }
    proposals.push({
      relativePath, title, markdown,
      provenance: { system: "kairo", kind: "layout", id },
      absolutePath: gate.path
    });
  };

  const projects = [...byProject.keys()].sort((a, b) => slugify(a).localeCompare(slugify(b)));
  const hubs = [];
  for (const project of projects) {
    const slug = slugify(project);
    const notes = [...byProject.get(project).values()]
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    const lines = notes.map((n) => `- [[${wikiPath(n.relativePath)}|${scrubTitle(n.title)}]]`);
    const fm = formatKnowledgeFrontmatter({
      kairo_kind: "projects", kairo_id: `hub-${slug}`, source: "kairo-index",
      project, title: project
    });
    const relativePath = `${PROJECT_HUB_DIR}/${slug}.md`;
    add(relativePath, project, `hub-${slug}`, `${fm}# ${project}\n\n${lines.join("\n")}\n\n[[Home]]\n`);
    hubs.push({ project, wiki: wikiPath(relativePath), count: notes.length });
  }
  if (hubs.length > 0) {
    const fm = formatKnowledgeFrontmatter({
      kairo_kind: "home", kairo_id: "home", source: "kairo-index", title: "Kairo"
    });
    const lines = hubs.map((h) => `- [[${h.wiki}|${h.project}]] (${h.count})`);
    add(HOME_NOTE, "Kairo", "home", `${fm}# Kairo\n\n## Projects\n\n${lines.join("\n")}\n`);
  }
  return { state: proposals.length ? "available" : "empty", proposals, diagnostics };
}
