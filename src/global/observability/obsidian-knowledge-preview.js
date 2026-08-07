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

function scrubTitle(raw, fallback = "untitled") {
  const text = String(raw ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\[\]#|\\/]+/g, " ")
    .trim()
    .slice(0, TITLE_MAX);
  return text || fallback;
}

function slugify(title) {
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

export function renderDecisionMarkdown(entry, { generatedAt } = {}) {
  const title = scrubTitle(entry?.title ?? entry?.id, "decision");
  const id = scrubTitle(entry?.id ?? slugify(title), slugify(title));
  const body = String(entry?.body ?? entry?.content ?? "").trim();
  const fm = formatKnowledgeFrontmatter({
    kairo_kind: "decision",
    kairo_id: id,
    source: "engram-export",
    generated_at: generatedAt ?? null,
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

export function renderArchitectureMarkdown(entry, { generatedAt } = {}) {
  const title = scrubTitle(entry?.title ?? entry?.name ?? entry?.id, "architecture");
  const id = scrubTitle(entry?.id ?? slugify(title), slugify(title));
  const detail = String(entry?.detail ?? entry?.summary ?? "").trim();
  const links = Array.isArray(entry?.related)
    ? entry.related.map((r) => `- [[architecture/${slugify(r)}]]`).join("\n")
    : "";
  const fm = formatKnowledgeFrontmatter({
    kairo_kind: "architecture",
    kairo_id: id,
    source: "graphify-export",
    generated_at: generatedAt ?? null,
    title
  });
  return {
    relativePath: `architecture/${slugify(title)}.md`,
    title,
    provenance: { system: "graphify", kind: "architecture", id },
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
  kairoRoot = "/virtual/Kairo"
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
    push(renderDecisionMarkdown(entry, { generatedAt }));
  }
  for (const entry of architecture ?? []) {
    if (entry == null || typeof entry !== "object") {
      diagnostics.push("skipped malformed architecture");
      continue;
    }
    push(renderArchitectureMarkdown(entry, { generatedAt }));
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

/**
 * Load preview via injectable export adapters — never vault writes.
 * Adapters must return plain arrays of records (already exported).
 */
export async function loadObsidianKnowledgePreview({
  loadEngramExport = null,
  loadGraphifyExport = null,
  kairoRoot = "/virtual/Kairo",
  generatedAt = new Date().toISOString(),
  maxProposals = MAX_PROPOSALS
} = {}) {
  const diagnostics = [];
  let decisions = [];
  let architecture = [];

  if (typeof loadEngramExport === "function") {
    try {
      const raw = await loadEngramExport();
      decisions = Array.isArray(raw) ? raw : Array.isArray(raw?.decisions) ? raw.decisions : [];
      if (!Array.isArray(raw) && raw != null && !Array.isArray(raw?.decisions)) {
        diagnostics.push("engram export shape unrecognized");
      }
    } catch (err) {
      diagnostics.push(`engram export failed: ${String(err?.message ?? err)}`);
    }
  } else {
    diagnostics.push("engram export adapter not provided");
  }

  if (typeof loadGraphifyExport === "function") {
    try {
      const raw = await loadGraphifyExport();
      architecture = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.architecture)
          ? raw.architecture
          : Array.isArray(raw?.communities)
            ? raw.communities
            : [];
      if (
        !Array.isArray(raw)
        && raw != null
        && !Array.isArray(raw?.architecture)
        && !Array.isArray(raw?.communities)
      ) {
        diagnostics.push("graphify export shape unrecognized");
      }
    } catch (err) {
      diagnostics.push(`graphify export failed: ${String(err?.message ?? err)}`);
    }
  } else {
    diagnostics.push("graphify export adapter not provided");
  }

  const preview = buildObsidianKnowledgePreview({
    decisions, architecture, generatedAt, maxProposals, kairoRoot
  });
  return {
    ...preview,
    diagnostics: [...diagnostics, ...(preview.diagnostics ?? [])]
  };
}
