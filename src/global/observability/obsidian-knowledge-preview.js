import { resolveKairoNotePath } from "./obsidian-vault.js";

const MAX_PROPOSALS = 40;
const TITLE_MAX = 80;

function envelope(partial = {}) {
  return {
    state: "error",
    proposals: [],
    diagnostics: [],
    error: null,
    generatedAt: null,
    ...partial
  };
}

export function scrubTitle(raw, fallback = "untitled") {
  const text = String(raw ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\[\]#|\\/]+/g, " ")
    .trim()
    .slice(0, TITLE_MAX);
  return text || fallback;
}

export function slugify(title) {
  return scrubTitle(title, "note")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "note";
}

/** Stable YAML-ish frontmatter — no nested objects; values are scalars only. */
export function formatKnowledgeFrontmatter(fields = {}) {
  const lines = ["---"];
  for (const key of Object.keys(fields).sort()) {
    const value = fields[key];
    if (value == null || value === "") continue;
    const safe = String(value).replace(/[\r\n]+/g, " ").replace(/"/g, "'");
    lines.push(`${key}: "${safe}"`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

export function renderDecisionMarkdown(entry, { generatedAt, project = null } = {}) {
  const title = scrubTitle(entry?.title ?? entry?.id, "decision");
  const id = scrubTitle(entry?.id ?? slugify(title), slugify(title));
  const body = String(entry?.body ?? entry?.content ?? "").trim();
  const fm = formatKnowledgeFrontmatter({
    kairo_kind: "decision",
    kairo_id: id,
    source: "engram-export",
    generated_at: entry?.updated_at ?? entry?.created_at ?? generatedAt ?? null,
    project: entry?.project ?? project,
    title
  });
  const wiki = `[[decisions/${slugify(title)}]]`;
  return {
    relativePath: `decisions/${slugify(title)}.md`,
    title,
    provenance: { system: "engram", kind: "decision", id },
    markdown: `${fm}# ${title}\n\n${body || "_No body provided._"}\n\n---\nSource: Engram export · ${wiki}\n`
  };
}

export function renderArchitectureMarkdown(entry, { generatedAt, project = null } = {}) {
  const title = scrubTitle(entry?.title ?? entry?.name ?? entry?.id, "architecture");
  const id = scrubTitle(entry?.id ?? slugify(title), slugify(title));
  const detail = String(entry?.detail ?? entry?.summary ?? entry?.content ?? "").trim();
  const links = Array.isArray(entry?.related)
    ? entry.related.map((r) => `- [[architecture/${slugify(r)}]]`).join("\n")
    : "";
  const fm = formatKnowledgeFrontmatter({
    kairo_kind: "architecture",
    kairo_id: id,
    source: entry?.source ?? "graphify-export",
    generated_at: entry?.source === "graphify-report" ? null : entry?.updated_at ?? entry?.created_at ?? generatedAt ?? null,
    project: entry?.project ?? project,
    title
  });
  return {
    relativePath: `architecture/${slugify(title)}.md`,
    title,
    provenance: { system: entry?.source === "engram-export" ? "engram" : "graphify", kind: "architecture", id },
    markdown: `${fm}# ${title}\n\n${detail || "_No summary provided._"}\n${links ? `\n## Related\n${links}\n` : ""}`
  };
}

/**
 * Pure composer — accepts already-exported records only.
 * Never opens Engram/Graphify internal DBs or vault files.
 */
export function buildObsidianKnowledgePreview({
  decisions = [],
  architecture = [],
  generatedAt = new Date().toISOString(),
  maxProposals = MAX_PROPOSALS,
  kairoRoot = "/virtual/Kairo",
  defaultProject = null
} = {}) {
  const diagnostics = [];
  const proposals = [];

  const push = (draft) => {
    if (proposals.length >= maxProposals) return;
    const gate = resolveKairoNotePath(kairoRoot, draft.relativePath);
    if (!gate.ok) {
      diagnostics.push(`rejected ${draft.relativePath}: ${gate.reason}`);
      return;
    }
    proposals.push({
      relativePath: draft.relativePath,
      title: draft.title,
      markdown: draft.markdown,
      provenance: draft.provenance,
      absolutePath: gate.path
    });
  };

  for (const entry of decisions ?? []) {
    if (entry == null || typeof entry !== "object") {
      diagnostics.push("skipped malformed decision");
      continue;
    }
    push(renderDecisionMarkdown(entry, { generatedAt, project: defaultProject }));
  }
  for (const entry of architecture ?? []) {
    if (entry == null || typeof entry !== "object") {
      diagnostics.push("skipped malformed architecture");
      continue;
    }
    push(renderArchitectureMarkdown(entry, { generatedAt, project: defaultProject }));
  }

  if (proposals.length === 0 && diagnostics.length === 0) {
    return envelope({
      state: "empty",
      proposals: [],
      diagnostics: ["no export records provided"],
      generatedAt,
      error: null
    });
  }

  return envelope({
    state: proposals.length > 0 ? "available" : "partial",
    proposals,
    diagnostics,
    generatedAt,
    error: null
  });
}

/** Curate official observations, newest first within each project and kind. */
function curateObservations(records, maxPerKind, defaultProject) {
  const counts = new Map();
  return records.filter((r) => r && ["decision", "architecture", "bugfix"].includes(r.type))
    .sort((a, b) => String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")) || String(b.id).localeCompare(String(a.id)))
    .filter((record) => {
      const key = JSON.stringify([record.project ?? defaultProject, record.type]);
      const count = counts.get(key) ?? 0;
      counts.set(key, count + 1);
      return count < maxPerKind;
    });
}

/** Load exported records without writing to the vault. Legacy injected shapes remain supported. */
export async function loadObsidianKnowledgePreview({
  loadEngramExport = null, loadGraphifyExport = null,
  kairoRoot = "/virtual/Kairo", generatedAt = new Date().toISOString(),
  maxProposals = MAX_PROPOSALS, maxPerKind = 10, defaultProject = null
} = {}) {
  const diagnostics = [];
  const proposals = [];
  let decisions = [];
  let architecture = [];
  if (typeof loadEngramExport === "function") {
    try {
      const raw = await loadEngramExport();
      if (raw?.scratchPath) diagnostics.push(`Engram scratch: ${raw.scratchPath}`);
      if (raw?.error) diagnostics.push(`engram export failed: ${raw.error.code}`);
      const records = raw?.records ?? raw?.observations;
      if (Array.isArray(records)) {
        for (const entry of curateObservations(records, maxPerKind, defaultProject)) {
          const project = entry.project ?? defaultProject;
          const kind = entry.type === "bugfix" ? "bugs" : entry.type === "decision" ? "decisions" : "architecture";
          const draft = entry.type === "architecture"
            ? renderArchitectureMarkdown({ ...entry, source: "engram-export" }, { generatedAt: null, project })
            : renderDecisionMarkdown(entry, { generatedAt: null, project });
          const id = String(entry.id ?? slugify(entry.title));
          const relativePath = `${kind}/${slugify(project)}-${slugify(entry.title)}-${slugify(id)}.md`;
          const gate = resolveKairoNotePath(kairoRoot, relativePath);
          if (!gate.ok) { diagnostics.push(`rejected ${relativePath}: ${gate.reason}`); continue; }
          proposals.push({ ...draft, relativePath, absolutePath: gate.path,
            provenance: { system: "engram", kind: entry.type, id },
            markdown: (entry.type === "bugfix" ? draft.markdown.replace('kairo_kind: "decision"', 'kairo_kind: "bugs"') : draft.markdown)
              .replace(`[[decisions/${slugify(entry.title)}]]`, `[[${relativePath.replace(/\.md$/, "")}]]`) });
        }
      } else {
        decisions = Array.isArray(raw) ? raw : Array.isArray(raw?.decisions) ? raw.decisions : [];
        if (!raw?.error && !Array.isArray(raw) && !Array.isArray(raw?.decisions)) diagnostics.push("engram export shape unrecognized");
      }
    } catch { diagnostics.push("engram export failed"); }
  } else diagnostics.push("engram export adapter not provided");
  if (typeof loadGraphifyExport === "function") {
    try {
      const raw = await loadGraphifyExport();
      diagnostics.push(...(raw?.diagnostics ?? []));
      architecture = Array.isArray(raw) ? raw : raw?.architecture ?? raw?.communities ?? [];
      if (!Array.isArray(architecture)) architecture = [];
      if (!Array.isArray(raw) && !Array.isArray(raw?.architecture) && !Array.isArray(raw?.communities)) diagnostics.push("graphify export shape unrecognized");
    } catch { diagnostics.push("graphify export failed"); }
  } else diagnostics.push("graphify export adapter not provided");
  const preview = buildObsidianKnowledgePreview({ decisions, architecture, generatedAt, maxProposals, kairoRoot, defaultProject });
  const combined = [...proposals, ...preview.proposals].slice(0, maxProposals);
  return { ...preview, state: combined.length ? "available" : preview.state, proposals: combined,
    diagnostics: [...diagnostics, ...(combined.length ? [] : preview.diagnostics)] };
}
