import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile, lstat, mkdir, readFile, realpath, rename, rm, writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { hashBuffer } from "../../hash.js";
import {
  assertInsideKairoRoot, isAllowedKairoNoteName, resolveKairoNotePath
} from "./obsidian-vault.js";

/** Slice 02 frontmatter marker — managed notes may be updated; manual notes refused. */
export const KAIRO_MANAGED_FRONTMATTER = /^kairo_kind:\s*"/m;
export const BACKUP_DIR_NAME = ".kairo-backups";

const envelope = (partial = {}) => ({
  state: "error", dryRun: false, results: [], diagnostics: [], error: null, ...partial
});

export const hasConsent = ({ yes = false, confirm = false } = {}) =>
  yes === true || confirm === true;

export function classifyNoteWrite(existingMarkdown, proposedMarkdown) {
  if (existingMarkdown === proposedMarkdown) return { action: "skip", reason: "identical" };
  if (KAIRO_MANAGED_FRONTMATTER.test(String(existingMarkdown ?? ""))) {
    return { action: "update", reason: "managed" };
  }
  return { action: "refuse", reason: "manual content" };
}

function validateProposal(proposal, kairoRoot) {
  if (proposal == null || typeof proposal !== "object") return { ok: false, reason: "malformed proposal" };
  const relativePath = String(proposal.relativePath ?? "");
  const markdown = proposal.markdown;
  if (typeof markdown !== "string") return { ok: false, reason: "proposal markdown required" };
  const base = relativePath.split(/[/\\]/).pop() ?? "";
  if (!isAllowedKairoNoteName(base)) return { ok: false, reason: "proposal basename not allowed" };
  const gate = resolveKairoNotePath(kairoRoot, relativePath);
  if (!gate.ok) return { ok: false, reason: gate.reason };
  return { ok: true, relativePath, markdown, absolutePath: gate.path };
}

/** Plan-only: `existingByPath` maps relativePath → utf8 (null = missing). No writes. */
export function planObsidianPublish(proposals = [], { kairoRoot, existingByPath = {} } = {}) {
  if (typeof kairoRoot !== "string" || !kairoRoot) {
    return envelope({ error: "kairoRoot required", diagnostics: ["kairoRoot required"] });
  }
  const results = [], diagnostics = [];
  for (const proposal of proposals) {
    const v = validateProposal(proposal, kairoRoot);
    if (!v.ok) {
      results.push({ relativePath: proposal?.relativePath ?? null, action: "refuse", reason: v.reason });
      diagnostics.push(v.reason);
      continue;
    }
    const existing = existingByPath[v.relativePath];
    const cls = existing == null
      ? { action: "create", reason: "missing" }
      : classifyNoteWrite(existing, v.markdown);
    results.push({
      relativePath: v.relativePath, absolutePath: v.absolutePath,
      action: cls.action, reason: cls.reason,
      hash: hashBuffer(Buffer.from(v.markdown, "utf8"))
    });
  }
  return envelope({ state: "planned", dryRun: true, results, diagnostics, error: null });
}

async function resolveKairoRoot(kairoRoot, { realpathFn = realpath, existsFn = existsSync } = {}) {
  if (typeof kairoRoot !== "string" || !kairoRoot) return { ok: false, reason: "kairoRoot required" };
  if (!existsFn(kairoRoot)) return { ok: false, reason: "kairoRoot missing" };
  try { return { ok: true, path: await realpathFn(kairoRoot) }; }
  catch { return { ok: false, reason: "kairoRoot unreadable" }; }
}

async function readExistingMap(proposals, kairoRoot, { readFileFn = readFile, existsFn = existsSync } = {}) {
  const map = {};
  for (const proposal of proposals) {
    const v = validateProposal(proposal, kairoRoot);
    if (!v.ok) continue;
    if (!existsFn(v.absolutePath)) { map[v.relativePath] = null; continue; }
    try { map[v.relativePath] = await readFileFn(v.absolutePath, "utf8"); }
    catch { map[v.relativePath] = null; }
  }
  return map;
}

async function backupExisting(absolutePath, relativePath, kairoRoot, {
  copyFileFn = copyFile, mkdirFn = mkdir, nowMs = Date.now()
} = {}) {
  const backupGate = resolveKairoNotePath(kairoRoot, join(BACKUP_DIR_NAME, `${relativePath}.${nowMs}.bak`));
  if (!backupGate.ok) return { ok: false, reason: backupGate.reason };
  await mkdirFn(dirname(backupGate.path), { recursive: true });
  await copyFileFn(absolutePath, backupGate.path);
  return { ok: true, path: backupGate.path };
}

async function atomicWrite(absolutePath, markdown, kairoRoot, {
  writeFileFn = writeFile, renameFn = rename, rmFn = rm, mkdirFn = mkdir,
  lstatFn = lstat, existsFn = existsSync
} = {}) {
  const parent = dirname(absolutePath);
  await mkdirFn(parent, { recursive: true });
  const parentGate = await assertInsideKairoRoot(parent, kairoRoot, { lstatFn, existsFn });
  if (!parentGate.ok && !parentGate.missing) throw new Error(parentGate.reason ?? "parent escapes Kairo/");
  const destGate = await assertInsideKairoRoot(absolutePath, kairoRoot, { lstatFn, existsFn });
  if (!destGate.ok) throw new Error(destGate.reason);
  if (destGate.symlink) throw new Error("destination is a symlink; refusing");
  const tmp = join(parent, `.kairo-write-${randomBytes(12).toString("hex")}.tmp`);
  try {
    await writeFileFn(tmp, markdown, { encoding: "utf8", flag: "wx" });
    await renameFn(tmp, absolutePath);
  } catch (err) {
    await rmFn(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Consent-gated publish. dryRun / no consent → plan only. Never deletes notes. */
export async function publishObsidianProposals({
  kairoRoot, proposals = [], yes = false, confirm = false, dryRun = false,
  readFileFn = readFile, writeFileFn = writeFile, renameFn = rename, rmFn = rm,
  mkdirFn = mkdir, copyFileFn = copyFile, lstatFn = lstat, existsFn = existsSync,
  realpathFn = realpath, nowMs = Date.now()
} = {}) {
  const resolved = await resolveKairoRoot(kairoRoot, { realpathFn, existsFn });
  if (!resolved.ok) return envelope({ error: resolved.reason, diagnostics: [resolved.reason] });
  kairoRoot = resolved.path;

  const plan = planObsidianPublish(proposals, {
    kairoRoot,
    existingByPath: await readExistingMap(proposals, kairoRoot, { readFileFn, existsFn })
  });
  if (dryRun === true || !hasConsent({ yes, confirm })) {
    const reason = dryRun === true ? null : "consent required: pass yes or confirm";
    return {
      ...plan, state: dryRun === true ? "planned" : "blocked", dryRun: true, error: reason,
      diagnostics: reason ? [...plan.diagnostics, reason] : plan.diagnostics
    };
  }

  const results = [], diagnostics = [...plan.diagnostics];
  const io = { writeFileFn, renameFn, rmFn, mkdirFn, copyFileFn, lstatFn, existsFn, nowMs };
  for (const step of plan.results) {
    if (step.action === "refuse" || step.action === "skip") { results.push({ ...step }); continue; }
    const markdown = proposals.find((p) => p?.relativePath === step.relativePath)?.markdown;
    if (typeof markdown !== "string") {
      results.push({ ...step, action: "refuse", reason: "proposal markdown required" });
      continue;
    }
    try {
      let backupPath = null;
      if (step.action === "update" && existsFn(step.absolutePath)) {
        const bak = await backupExisting(step.absolutePath, step.relativePath, kairoRoot, io);
        if (!bak.ok) {
          results.push({ ...step, action: "refuse", reason: bak.reason });
          diagnostics.push(bak.reason);
          continue;
        }
        backupPath = bak.path;
      }
      const gate = resolveKairoNotePath(kairoRoot, step.relativePath);
      if (!gate.ok) { results.push({ ...step, action: "refuse", reason: gate.reason }); continue; }
      await atomicWrite(gate.path, markdown, kairoRoot, io);
      results.push({
        ...step, absolutePath: gate.path, backupPath,
        action: step.action === "create" ? "created" : "updated"
      });
    } catch (err) {
      const msg = String(err?.message ?? err);
      results.push({ ...step, action: "error", reason: msg });
      diagnostics.push(msg);
    }
  }
  const wrote = results.some((r) => r.action === "created" || r.action === "updated");
  const errored = results.some((r) => r.action === "error");
  return envelope({
    state: errored ? "partial" : wrote ? "applied" : "noop",
    dryRun: false, results, diagnostics, error: null
  });
}
