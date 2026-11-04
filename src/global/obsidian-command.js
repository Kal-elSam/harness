import { buildObsidianHotProposal } from "./observability/obsidian-hot.js";
import { loadEngramExport } from "./integrations/engram-export.js";
import { loadGraphifyExport } from "./observability/obsidian-graphify-export.js";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { harnessHomePaths, resolveHomeDir } from "./paths.js";
import { writeAtomicJson } from "./runtime/write-atomic-json.js";
import { formatCliCommand } from "./brand/cli.js";
import {
  inspectObsidianVault, normalizeVaultPath, resolveKairoNotePath
} from "./observability/obsidian-vault.js";
import { loadObsidianVaultStatus } from "./observability/obsidian-status.js";
import { loadObsidianKnowledgePreview } from "./observability/obsidian-knowledge-preview.js";
import { planObsidianPublish, publishObsidianProposals, hasConsent } from "./observability/obsidian-publisher.js";
import { buildProjectLayoutProposals, layoutEntriesFromNotes } from "./observability/obsidian-layout.js";

export const OBSIDIAN_ACTIONS = Object.freeze(["config", "status", "publish"]);
const CONFIG_FILE = "obsidian.json";
const DEFAULT_PROJECT = "general";

/** Kairo-owned config: `<harness home>/.harness/obsidian.json` = { vaultPath, lastPublishAt }. */
export function obsidianConfigPath(homeDir) {
  return join(harnessHomePaths(homeDir).root, CONFIG_FILE);
}

export async function readObsidianConfig(homeDir) {
  try {
    const raw = JSON.parse(await readFile(obsidianConfigPath(homeDir), "utf8"));
    return {
      vaultPath: typeof raw?.vaultPath === "string" && raw.vaultPath ? raw.vaultPath : null,
      lastPublishAt: typeof raw?.lastPublishAt === "string" ? raw.lastPublishAt : null
    };
  } catch {
    return { vaultPath: null, lastPublishAt: null };
  }
}

async function writeObsidianConfig(homeDir, config) {
  await mkdir(harnessHomePaths(homeDir).root, { recursive: true });
  await writeAtomicJson(obsidianConfigPath(homeDir), config);
}

async function validateVaultDirectory(raw) {
  const norm = normalizeVaultPath(raw);
  if (!norm.ok) throw new Error(`Invalid vault: ${norm.reason}`);
  if (!existsSync(norm.path)) throw new Error(`Invalid vault: ${norm.path} does not exist`);
  if ((await lstat(norm.path)).isSymbolicLink()) throw new Error("Invalid vault: vault root is a symlink; refusing");
  if (!(await stat(norm.path)).isDirectory()) throw new Error(`Invalid vault: ${norm.path} is not a directory`);
  return norm.path;
}

async function runConfig(options, ctx) {
  const current = await readObsidianConfig(ctx.homeDir);
  if (options.obsidianVault == null) {
    if (options.json) ctx.print(JSON.stringify(current, null, 2));
    else ctx.print(`vault: ${current.vaultPath ?? "not configured"}`);
    return;
  }
  const vaultPath = await validateVaultDirectory(options.obsidianVault);
  await writeObsidianConfig(ctx.homeDir, { ...current, vaultPath });
  if (options.json) ctx.print(JSON.stringify({ vaultPath }, null, 2));
  else ctx.print(`vault configured: ${vaultPath}`);
}

async function runStatus(options, ctx) {
  const config = await readObsidianConfig(ctx.homeDir);
  const status = await loadObsidianVaultStatus({
    vaultPath: config.vaultPath, lastPublishAt: config.lastPublishAt
  });
  if (options.json) { ctx.print(JSON.stringify(status, null, 2)); return; }
  ctx.print(`state: ${status.state}`);
  if (status.vaultPath) ctx.print(`vault: ${status.vaultPath}`);
  ctx.print(`notes: ${status.noteCount}`);
  if (status.lastPublishAt) ctx.print(`last publish: ${status.lastPublishAt}`);
  for (const d of status.diagnostics) ctx.print(`note: ${d}`);
  if (status.error) ctx.print(`error: ${status.error}`);
  if (status.state === "unconfigured") {
    ctx.print(`hint: ${formatCliCommand("obsidian config --vault ABSOLUTE_PATH")}`);
  }
}

async function readExistingNotes(inspected) {
  const notes = [];
  for (const note of inspected.notes ?? []) {
    const gate = resolveKairoNotePath(inspected.kairoRoot, note.relativePath);
    if (!gate.ok) continue;
    try {
      notes.push({ relativePath: note.relativePath, markdown: await readFile(gate.path, "utf8") });
    } catch { /* unreadable note: leave it out of the hubs */ }
  }
  return notes;
}

async function runPublish(options, ctx) {
  const config = await readObsidianConfig(ctx.homeDir);
  if (!config.vaultPath) {
    throw new Error(`Obsidian vault not configured. Run: ${formatCliCommand("obsidian config --vault ABSOLUTE_PATH")}`);
  }
  const inspected = await inspectObsidianVault({ vaultPath: config.vaultPath });
  if (inspected.state !== "available" && inspected.state !== "partial") {
    throw new Error(`Obsidian vault ${inspected.state}: ${inspected.error ?? "unusable"}`);
  }
  const kairoRoot = inspected.kairoRoot;
  const generatedAt = ctx.now();
  const preview = await loadObsidianKnowledgePreview({
    loadEngramExport: ctx.deps.loadEngramExport ?? (() => loadEngramExport({ project: options.obsidianProject ?? DEFAULT_PROJECT, execFile: ctx.deps.execFile })),
    loadGraphifyExport: ctx.deps.loadGraphifyExport ?? (() => loadGraphifyExport({ cwd: ctx.deps.cwd, projectDir: options.obsidianProjectDir ?? ctx.deps.cwd, project: options.obsidianProject ?? DEFAULT_PROJECT })),
    maxPerKind: options.obsidianMaxPerKind ?? 10,
    kairoRoot, generatedAt,
    defaultProject: options.obsidianProject ?? DEFAULT_PROJECT
  });

  const existing = await readExistingNotes(inspected);
  const merged = new Map(layoutEntriesFromNotes(existing).map((e) => [e.relativePath, e]));
  for (const e of layoutEntriesFromNotes(preview.proposals)) merged.set(e.relativePath, e);
  const layout = buildProjectLayoutProposals([...merged.values()], { kairoRoot });
  const hot = buildObsidianHotProposal(preview.proposals);
  const proposals = [...preview.proposals, ...layout.proposals, ...(hot ? [hot] : [])];
  const diagnostics = [...preview.diagnostics, ...layout.diagnostics];

  const consent = hasConsent({ yes: options.yes === true });
  const apply = consent && options.dryRun !== true && proposals.length > 0;
  let result;
  if (!existsSync(kairoRoot)) {
    if (apply) await mkdir(kairoRoot, { recursive: true });
  }
  if (existsSync(kairoRoot)) {
    result = await publishObsidianProposals({
      kairoRoot, proposals, hashGuard: true,
      yes: apply, dryRun: !apply, nowMs: Date.parse(generatedAt)
    });
  } else {
    result = planObsidianPublish(proposals, { kairoRoot, hashGuard: true });
  }
  const dryRun = !apply;
  const state = proposals.length === 0 ? "noop" : result.state;
  const report = {
    state, dryRun,
    counts: Object.fromEntries(["decisions", "architecture", "bugs"].map((kind) => [kind, preview.proposals.filter((p) => p.relativePath.startsWith(`${kind}/`)).length])),
    results: result.results.map((r) => ({
      relativePath: r.relativePath, action: r.action, reason: r.reason ?? null
    })),
    diagnostics: [...diagnostics, ...result.diagnostics.filter((d) => !diagnostics.includes(d))]
  };

  if (apply && (state === "applied" || state === "noop" || state === "partial")) {
    await writeObsidianConfig(ctx.homeDir, { ...config, lastPublishAt: generatedAt });
  }
  if (state === "error" || state === "partial" || result.results.some((r) => r.action === "refuse")) ctx.setExitCode(1);

  if (options.json) { ctx.print(JSON.stringify(report, null, 2)); return; }
  ctx.print(`publish: ${dryRun ? "dry run" : state}`);
  for (const r of report.results) {
    if (r.action === "skip") continue;
    ctx.print(`  ${r.action} ${r.relativePath}${r.reason ? ` (${r.reason})` : ""}`);
  }
  const skipped = report.results.filter((r) => r.action === "skip").length;
  if (skipped > 0) ctx.print(`  unchanged: ${skipped}`);
  for (const d of report.diagnostics) ctx.print(`note: ${d}`);
  if (dryRun && proposals.length > 0) ctx.print("dry run: nothing written. Pass --yes to apply.");
}

/**
 * `kairo obsidian config|status|publish`. `deps` is for tests and for wiring
 * export adapters (`loadEngramExport`, `loadGraphifyExport`: async () => records).
 */
export async function runObsidianCli(options, deps = {}) {
  const env = deps.env ?? process.env;
  const ctx = {
    deps,
    homeDir: resolveHomeDir(env),
    print: deps.print ?? ((line) => console.log(line)),
    setExitCode: deps.setExitCode ?? ((code) => { process.exitCode = code; }),
    now: deps.now ?? (() => new Date().toISOString())
  };
  const action = options.obsidianAction ?? "status";
  if (action === "config") return runConfig(options, ctx);
  if (action === "status") return runStatus(options, ctx);
  if (action === "publish") return runPublish(options, ctx);
  throw new Error(`Unknown obsidian action "${action}". Use config, status, or publish.`);
}
