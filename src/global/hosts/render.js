import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveAdapter } from "../registry.js";

export const MARKER_RE = /kairo-role: v1 host=([\w-]+) role=([a-z0-9-]+)/;
const MODEL_RE = /^[\w.\-:/@+]+$/;

/** Safe file stem for a role id, or null when nothing usable is left. */
export function slugRole(id) {
  const slug = String(id ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || null;
}

export const markerText = (host, slug) => `kairo-role: v1 host=${host} role=${slug}`;

export function roleInstructions(role) {
  const description = String(role.description ?? "").trim();
  return `Kairo role "${role.id}". ${description ? `${description} ` : ""}Do the delegated task exactly as specified and return the observed results. Kairo chose this model from the approved team; regenerate with kairo team roles sync.`;
}

/** Quoted scalar valid in both YAML and TOML basic strings. */
export const quote = (value) => JSON.stringify(String(value).replace(/\s+/g, " ").trim());

export const nullRender = (reason) => ({ path: null, content: null, reason });

export function isNativePick(caps, pick) {
  return caps.nativeProviders.includes("*") || caps.nativeProviders.includes(pick?.adapterId);
}

/** Shared detection: reuses the managed-config adapter detector, plus home and project dir evidence. */
export function detectDirs({ adapterId = null, homeDirName, projectDirName }, { homeDir, projectRoot } = {}) {
  const evidence = [];
  if (adapterId && homeDir) {
    try { if (resolveAdapter(adapterId).detect({ homeDir })) evidence.push(`managed adapter "${adapterId}" detected in home`); } catch { /* unknown adapter */ }
  }
  if (!adapterId && homeDir && homeDirName && existsSync(join(homeDir, homeDirName))) evidence.push(`~/${homeDirName}`);
  if (projectRoot && projectDirName && existsSync(join(projectRoot, projectDirName))) evidence.push(`${projectDirName}/ in project`);
  return { installed: evidence.length > 0, evidence };
}

/**
 * Builds a host adapter. `format(role, slug, model)` returns file text; the
 * marker is embedded by the formatter through markerText().
 */
export function createHost({ id, caps, detect, unsupportedReason = null, extension = "md", modelFor = (pick) => pick.model, format }) {
  const capabilities = () => ({ ...caps, nativeProviders: Array.isArray(caps.nativeProviders) ? [...caps.nativeProviders] : caps.nativeProviders });
  return {
    id,
    unsupportedReason,
    detect: (context = {}) => detect(context),
    capabilities,
    /** @returns {{path: string, content: string} | {path: null, content: null, reason: string}} */
    renderRoleFile(role, pick) {
      if (unsupportedReason) return nullRender(unsupportedReason);
      const slug = slugRole(role?.id);
      if (!slug) return nullRender("invalid-role");
      if (!isNativePick(caps, pick)) return nullRender("needs-wrapper");
      const model = modelFor(pick);
      if (typeof model !== "string" || !MODEL_RE.test(model)) return nullRender("invalid-model");
      return { path: `${caps.roleDir}/${slug}.${extension}`, content: format(role, slug, model) };
    }
  };
}

/** Markdown agent file: frontmatter lines, then instructions and the marker. */
export function markdownAgent(host, frontmatter, role, slug) {
  return ["---", ...frontmatter, "---", "", roleInstructions(role), "", `<!-- ${markerText(host, slug)} -->`, ""].join("\n");
}
