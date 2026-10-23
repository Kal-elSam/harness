import { isGentleOwnedActor } from "../intelligence/role-catalog.js";
import { mkdir, readdir, rmdir, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { writeAtomicText } from "../runtime/write-atomic-json.js";
import { readIfExists, backupExclusive } from "../file-safety.js";
import { getHost } from "./registry.js";
import { MARKER_RE, slugRole } from "./render.js";

/** A file is ours only when its marker names this host and the file's own role. */
export function isOurs(text, hostId, stem) {
  if (typeof text !== "string") return false;
  const match = MARKER_RE.exec(text);
  return match?.[1] === hostId && match[2] === stem;
}

/** Preview for one host. Never writes. Roles come from `catalog.registry`, picks by role id. */
export async function planRoleFiles({ host, projectRoot, catalog, picks = {}, env = process.env } = {}) {
  const adapter = getHost(host);
  const roles = [];
  const seen = new Set();
  const wrappers = [];
  for (const rendered of adapter.renderWrapperAgents?.({ env }) ?? []) {
    const path = join(projectRoot, rendered.path);
    const existing = await readIfExists(path);
    const action = existing === null ? "create" : !isOurs(existing, adapter.id, rendered.role)
      ? "skip-foreign" : existing === rendered.content ? "unchanged" : "update";
    wrappers.push({ role: rendered.role, host: adapter.id, provider: rendered.provider, model: null,
      source: "wrapper", path, action, content: rendered.content });
    seen.add(path);
  }
  for (const [id, entry] of Object.entries(catalog?.registry ?? {})) {
    const pick = picks[id];
    const base = { role: id, host: adapter.id };
    if (isGentleOwnedActor(id)) { roles.push({ ...base, action: "skipped", reason: "owned by gentle-ai" }); continue; }
    if (!pick && !adapter.unsupportedReason) { roles.push({ ...base, action: "no-route" }); continue; }
    const rendered = adapter.renderRoleFile({ id, description: entry.description }, pick ?? {});
    const meta = { model: pick?.model ?? null, source: pick?.source ?? null };
    if (rendered.path === null) {
      const wrapper = wrappers.find(entry => entry.role === rendered.wrapperAgent && entry.action !== "skip-foreign");
      roles.push({ ...base, ...meta, action: rendered.reason === "needs-wrapper" ? "needs-wrapper" : "unsupported", reason: rendered.reason,
        ...(rendered.wrapperAgent ? { wrapperAgent: rendered.wrapperAgent, path: wrapper?.path ?? null } : {}) });
      continue;
    }
    const path = join(projectRoot, rendered.path);
    if (seen.has(path)) { roles.push({ ...base, ...meta, path, action: "skip-duplicate" }); continue; }
    seen.add(path);
    const existing = await readIfExists(path);
    let action = "create";
    if (existing !== null) {
      if (!isOurs(existing, adapter.id, slugRole(id))) action = "skip-foreign";
      else action = existing === rendered.content ? "unchanged" : "update";
    }
    roles.push({ ...base, ...meta, path, action, content: rendered.content });
  }
  return { ok: true, host: adapter.id, applied: false, roles: [...roles, ...wrappers], reasons: [] };
}

export async function applyRoleFiles({ yes, now = Date.now, ...rest } = {}) {
  const plan = await planRoleFiles(rest);
  if (yes !== true) return stripContent(plan);
  let applied = false;
  const roles = [];
  for (const entry of plan.roles) {
    const { content, ...out } = entry;
    if (entry.action === "create" || entry.action === "update") {
      await mkdir(dirname(entry.path), { recursive: true });
      if (entry.action === "update") out.backupPath = await backupExclusive(entry.path, now());
      await writeAtomicText(entry.path, content);
      applied = true;
    }
    roles.push(out);
  }
  return { ...plan, applied, roles };
}

const stripContent = (plan) => ({ ...plan, roles: plan.roles.map(({ content, ...rest }) => rest) });

/** Removes only Kairo-marked role files of this host; foreign files and symlinks are never listed or touched. */
export async function retireRoleFiles({ host, projectRoot, yes } = {}) {
  const adapter = getHost(host);
  const roleDir = adapter.capabilities().roleDir;
  const roles = [];
  let applied = false;
  if (roleDir) {
    const dir = join(projectRoot, roleDir);
    let names = [];
    try { names = (await readdir(dir)).sort(); } catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error; }
    for (const name of names) {
      const ext = extname(name);
      if (ext !== ".md" && ext !== ".toml") continue;
      const path = join(dir, name);
      const stem = basename(name, ext);
      if (!isOurs(await readIfExists(path), adapter.id, stem)) continue;
      if (yes === true) { await unlink(path); applied = true; }
      roles.push({ role: stem, host: adapter.id, path, action: "remove" });
    }
    if (applied) for (const empty of [dir, dirname(dir)]) { try { await rmdir(empty); } catch { break; } }
  }
  return { ok: true, host: adapter.id, applied, roles, reasons: [] };
}
