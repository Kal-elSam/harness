import { layoutEntriesFromNotes } from "./obsidian-layout.js";
import { formatKnowledgeFrontmatter, scrubTitle } from "./obsidian-knowledge-preview.js";
import { parseKnowledgeFrontmatter } from "./obsidian-knowledge-views.js";
import { stampKairoHash } from "./obsidian-hash-guard.js";

export const OBSIDIAN_HOT_LIMITS = Object.freeze({ lines: 100, bytes: 12000, perKind: 3, summaryChars: 600 });
const kinds = new Set(["decision", "decisions", "architecture", "bugs"]);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function summarize(body) {
  const text = body.replace(/^# [^\n]*\n/, "").split(/\n---\nSource:/)[0].replace(/\s+/g, " ").trim();
  const max = OBSIDIAN_HOT_LIMITS.summaryChars;
  if (text.length <= max) return text;
  // Keep a late root cause visible even when the preceding bug narrative is long.
  const cause = text.match(/root cause\s*:[\s\S]*/i)?.[0];
  return cause ? `${text.slice(0, max / 2)} … ${cause.slice(0, max / 2 - 3)}` : `${text.slice(0, max - 1)}…`;
}

/** Compose only this publish's curated proposals; never load a second memory source. */
export function buildObsidianHotProposal(proposals = []) {
  const byPath = new Map(proposals.map(p => [p.relativePath, p]));
  const projects = new Map();
  for (const entry of layoutEntriesFromNotes(proposals)) {
    if (!kinds.has(entry.kind)) continue;
    const { fields, body } = parseKnowledgeFrontmatter(byPath.get(entry.relativePath).markdown);
    const project = scrubTitle(entry.project);
    if (!projects.has(project)) projects.set(project, []);
    projects.get(project).push({ ...entry, date: fields.generated_at ?? "", summary: summarize(body) });
  }
  if (!projects.size) return null;
  let markdown = `${formatKnowledgeFrontmatter({ kairo_kind: "hot", kairo_id: "hot", source: "kairo-index", title: "Hot context" })}# Hot context\n\n`;
  const fits = text => {
    const stamped = stampKairoHash(text);
    return stamped.split("\n").length <= OBSIDIAN_HOT_LIMITS.lines && Buffer.byteLength(stamped) <= OBSIDIAN_HOT_LIMITS.bytes;
  };
  for (const project of [...projects.keys()].sort(compare)) {
    const counts = new Map();
    const entries = projects.get(project).sort((a, b) => compare(b.date, a.date) || compare(a.relativePath, b.relativePath));
    let section = `## ${project}\n`;
    for (const entry of entries) {
      const kind = entry.kind === "decision" ? "decisions" : entry.kind;
      if ((counts.get(kind) ?? 0) >= OBSIDIAN_HOT_LIMITS.perKind) continue;
      const line = `- ${kind}: [[${entry.relativePath.replace(/\.md$/i, "")}|${scrubTitle(entry.title)}]] — ${entry.summary}\n`;
      if (!fits(markdown + section + line + "\n")) continue;
      section += line;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    if (counts.size) markdown += `${section}\n`;
  }
  return { relativePath: "hot.md", title: "Hot context", markdown,
    provenance: { system: "kairo", kind: "hot", id: "hot" } };
}
