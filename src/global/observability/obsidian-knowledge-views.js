import { resolveKairoNotePath } from "./obsidian-vault.js";
import { formatKnowledgeFrontmatter } from "./obsidian-knowledge-preview.js";

/** Canonical view folders / kairo_kind values under Kairo/. */
export const KAIRO_VIEW_KINDS = Object.freeze([
  "projects", "decisions", "architecture", "sessions", "reviews"
]);

const KIND_SET = new Set(KAIRO_VIEW_KINDS);
const MAX_INDEX_LINKS = 80;

function envelope(partial = {}) {
  return { state: "error", views: emptyViews(), links: [], diagnostics: [], error: null, ...partial };
}

function emptyViews() {
  return Object.fromEntries(KAIRO_VIEW_KINDS.map((k) => [k, []]));
}

/** Parse simple `key: "value"` frontmatter between leading --- fences. */
export function parseKnowledgeFrontmatter(markdown) {
  const text = String(markdown ?? "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return { fields: {}, body: text, hasFrontmatter: false };
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*"(.*)"\s*$/);
    if (kv) fields[kv[1]] = kv[2];
  }
  return { fields, body: text.slice(m[0].length), hasFrontmatter: true };
}

/** Extract `[[target]]` / `[[target|alias]]` wikilinks — display-only graph edges. */
export function extractWikilinks(markdown) {
  const links = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let match;
  const text = String(markdown ?? "");
  while ((match = re.exec(text)) != null) {
    const target = match[1].trim().replace(/\\/g, "/");
    if (target && !target.includes("..")) links.push(target);
  }
  return links;
}

function inferKind(relativePath, fields) {
  const kind = fields.kairo_kind;
  if (typeof kind === "string" && KIND_SET.has(kind)) return kind;
  const head = String(relativePath ?? "").split(/[/\\]/)[0];
  return KIND_SET.has(head) ? head : null;
}

function normalizeWikiTarget(target) {
  const t = String(target).replace(/\.md$/i, "");
  return t.startsWith("/") ? t.slice(1) : t;
}

/**
 * Read-only index of Kairo notes into view buckets + wikilink edges.
 * `contentsByPath` is optional utf8 map; missing content → title-only entries.
 */
export function buildObsidianKnowledgeViews({
  notes = [],
  contentsByPath = {},
  kairoRoot = "/virtual/Kairo"
} = {}) {
  const views = emptyViews();
  const links = [];
  const diagnostics = [];
  const byPath = new Set();

  for (const note of notes ?? []) {
    if (note == null || typeof note !== "object") {
      diagnostics.push("skipped malformed note");
      continue;
    }
    const relativePath = String(note.relativePath ?? "");
    const gate = resolveKairoNotePath(kairoRoot, relativePath);
    if (!gate.ok) {
      diagnostics.push(`skipped ${relativePath || "?"}: ${gate.reason}`);
      continue;
    }
    const markdown = contentsByPath[relativePath];
    const parsed = typeof markdown === "string"
      ? parseKnowledgeFrontmatter(markdown)
      : { fields: {}, body: "", hasFrontmatter: false };
    const kind = inferKind(relativePath, parsed.fields);
    if (!kind) {
      diagnostics.push(`unclassified ${relativePath}`);
      continue;
    }
    const title = parsed.fields.title
      || note.title
      || relativePath.replace(/\.md$/i, "").split("/").pop();
    const entry = {
      relativePath,
      title: String(title),
      kairoId: parsed.fields.kairo_id ?? null,
      kind,
      wikiPath: relativePath.replace(/\.md$/i, "")
    };
    views[kind].push(entry);
    byPath.add(entry.wikiPath);

    if (typeof markdown === "string") {
      for (const target of extractWikilinks(markdown)) {
        links.push({
          from: entry.wikiPath,
          to: normalizeWikiTarget(target),
          kind: entry.kind
        });
      }
    }
  }

  for (const kind of KAIRO_VIEW_KINDS) {
    views[kind].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }
  links.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  const total = KAIRO_VIEW_KINDS.reduce((n, k) => n + views[k].length, 0);
  return envelope({
    state: total > 0 ? "available" : "empty",
    views,
    links,
    diagnostics,
    error: null,
    resolvedTargets: [...byPath].sort()
  });
}

/** Build index-note *proposals* only — publish via Slice 03 with consent. */
export function buildKnowledgeIndexProposals(viewsResult, {
  generatedAt = new Date().toISOString(),
  kairoRoot = "/virtual/Kairo"
} = {}) {
  const views = viewsResult?.views ?? emptyViews();
  const proposals = [];
  const diagnostics = [];

  for (const kind of KAIRO_VIEW_KINDS) {
    const entries = views[kind] ?? [];
    const lines = entries.slice(0, MAX_INDEX_LINKS).map((e) => `- [[${e.wikiPath}|${e.title}]]`);
    const fm = formatKnowledgeFrontmatter({
      kairo_kind: kind,
      kairo_id: `index-${kind}`,
      source: "kairo-index",
      generated_at: generatedAt,
      title: `${kind} index`
    });
    const markdown = `${fm}# ${kind}\n\n${lines.length ? lines.join("\n") : "_No notes yet._"}\n`;
    const relativePath = `${kind}/index.md`;
    const gate = resolveKairoNotePath(kairoRoot, relativePath);
    if (!gate.ok) {
      diagnostics.push(`index ${kind}: ${gate.reason}`);
      continue;
    }
    proposals.push({
      relativePath,
      title: `${kind} index`,
      markdown,
      provenance: { system: "kairo", kind: "index", id: kind },
      absolutePath: gate.path
    });
  }

  return {
    state: proposals.length ? "available" : "empty",
    proposals,
    diagnostics,
    generatedAt
  };
}

/**
 * Convenience: inspect notes + optional content loader → views.
 * Never writes; `readNote` must be injectable (tests / CLI).
 */
export async function loadObsidianKnowledgeViews({
  inspectVault,
  vaultPath,
  readNote = null,
  kairoRoot = null
} = {}) {
  if (typeof inspectVault !== "function") {
    return envelope({ error: "inspectVault required", diagnostics: ["inspectVault required"] });
  }
  let inspected;
  try {
    inspected = await inspectVault({ vaultPath });
  } catch (err) {
    return envelope({
      error: String(err?.message ?? err),
      diagnostics: [`inspect failed: ${String(err?.message ?? err)}`]
    });
  }
  const root = kairoRoot ?? inspected?.kairoRoot;
  if (!root) {
    return envelope({
      state: inspected?.state ?? "error",
      error: inspected?.error ?? "kairoRoot missing",
      diagnostics: inspected?.diagnostics ?? ["kairoRoot missing"]
    });
  }
  const contentsByPath = {};
  if (typeof readNote === "function") {
    for (const note of inspected.notes ?? []) {
      try {
        const text = await readNote(note.relativePath, root);
        if (typeof text === "string") contentsByPath[note.relativePath] = text;
      } catch {
        /* fail-soft: title-only entry */
      }
    }
  }
  const built = buildObsidianKnowledgeViews({
    notes: inspected.notes ?? [],
    contentsByPath,
    kairoRoot: root
  });
  return {
    ...built,
    diagnostics: [...(inspected.diagnostics ?? []), ...built.diagnostics],
    vaultPath: inspected.vaultPath ?? vaultPath ?? null,
    kairoRoot: root
  };
}
