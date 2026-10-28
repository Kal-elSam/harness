import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { resolveHomeDir, harnessHomePaths } from "../paths.js";
import { projectKeyForPath } from "../next/project-key.js";
import { resolveActiveHost } from "../hosts/active-host.js";

const DONE_WORDS = /\b(done|complete|completed|closed)\b/i;
const DONE_TOKEN = /^(done|complete|completed|closed)$/i;
const OPEN_WORDS = /^\s*(pending|open|todo|in progress|blocked)\b/i;

/** Status of a "- T..." line: the trailing segment after the last " — ", or a bare status token before the first " — "; never the description. */
function tLineDone(line) {
  const parts = line.split(" — ");
  const trailing = parts.length > 1 ? parts[parts.length - 1] : "";
  // An explicit trailing open status wins over any completion word earlier in the line.
  if (OPEN_WORDS.test(trailing)) return false;
  if (DONE_WORDS.test(trailing)) return true;
  const head = parts[0].replace(/^- T\d+\s*(\[[^\]]*\]\s*)*:?/, "");
  return head.split(/[,;]/).some(token => DONE_TOKEN.test(token.trim().replace(/[.()]/g, "")));
}
const LAUNCHABLE = { claude: "claude", codex: "codex" };
const PRINT_ONLY = new Set(["gentle-shell", "pi", "opencode"]);

/** Unfinished tasks under `## Tasks`: "- [ ] ..." boxes and "- T..." lines without a done/closed word. */
export function parseTasks(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const start = lines.findIndex(line => /^##\s+Tasks\b/.test(line));
  if (start < 0) return { tasks: [], next: null };
  const tasks = [];
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i += 1) {
    const line = lines[i];
    const box = line.match(/^- \[( |x|X)\]\s/);
    if (box) tasks.push({ line: line.trim(), done: box[1] !== " " });
    else if (/^- T\d+/.test(line)) tasks.push({ line: line.trim(), done: tLineDone(line) });
  }
  return { tasks, next: tasks.find(task => !task.done)?.line ?? null };
}

/** Branch named on the header's `Branch:` line, or null. */
export function parseBranch(markdown) {
  const header = String(markdown ?? "").split("\n").slice(0, 8).join("\n");
  const match = header.match(/\bBranch:\s*`?([A-Za-z0-9._/-]+)`?/);
  return match ? match[1].replace(/[.,;]+$/, "") : null;
}

export function defaultDeps() {
  return {
    homeDir: resolveHomeDir(),
    env: process.env,
    now: () => new Date(),
    isTTY: Boolean(process.stdout.isTTY),
    stdout: text => process.stdout.write(text),
    stderr: text => process.stderr.write(text),
    git: (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim(),
    spawn: (command, args, opts) => spawnSync(command, args, opts),
    engram: args => spawnSync("engram", args, { encoding: "utf8", timeout: 15000 }),
    fs: { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, renameSync, unlinkSync }
  };
}

export function tryGit(deps, args, cwd, fallback = null) {
  try { return deps.git(args, cwd); } catch { return fallback; }
}

export function listFeatureDocs(deps, root) {
  const dir = join(root, "odd", "tasks");
  let names;
  try { names = deps.fs.readdirSync(dir).filter(name => name.endsWith(".md")); } catch { return []; }
  return names.map(name => {
    const path = join(dir, name);
    const text = deps.fs.readFileSync(path, "utf8");
    return { name: name.slice(0, -3), path, text, mtime: deps.fs.statSync(path).mtimeMs, ...parseTasks(text), branch: parseBranch(text) };
  }).sort((a, b) => b.mtime - a.mtime);
}

export function pickFeature(docs, { feature, branch }) {
  if (feature) {
    const wanted = feature.replace(/\.md$/, "");
    return docs.find(doc => doc.name === wanted) ?? null;
  }
  return docs.find(doc => branch && doc.branch === branch)
    ?? docs.find(doc => doc.next !== null) ?? null;
}

export function buildResumePrompt({ feature, docPath, nextTask, branch, checkpointPath }) {
  return [
    `Resume the feature "${feature}" in a fresh session.`,
    `Feature document: ${docPath}. Read it until ## Log, then read the Log.`,
    `Next task: ${nextTask}`,
    `Branch: ${branch}. Checkpoint: ${checkpointPath}.`,
    `First run mem_context and mem_search for odd/${feature}, then continue with the next task.`
  ].join("\n");
}

function renderCheckpoint(c) {
  return [
    `# Checkpoint: ${c.feature}`, "",
    `- Feature document: ${c.docPath}`,
    `- Next task: ${c.nextTask}`,
    `- Branch: ${c.branch}`,
    `- Last commit: ${c.lastCommit}`,
    `- Uncommitted files: ${c.dirty}`,
    `- Saved at: ${c.savedAt}`, ""
  ].join("\n");
}

/** Engram's project: origin remote repository name; else the main checkout directory (a linked worktree resolves to it). */
export function engramProject(deps, root) {
  const url = tryGit(deps, ["remote", "get-url", "origin"], root);
  const name = url ? url.trim().replace(/[/\\]+$/, "").split(/[/:\\]/).pop().replace(/\.git$/, "") : "";
  if (name) return name;
  const common = tryGit(deps, ["rev-parse", "--path-format=absolute", "--git-common-dir"], root);
  return common && basename(common) === ".git" ? basename(dirname(common)) : basename(root);
}

/** Writes the Kairo checkpoint file and makes the best-effort Engram save. Never throws; the caller decides what to report. */
export function writeCheckpoint(deps, root, branch, doc) {
  const nextTask = doc.next ?? "(no unfinished task; all tasks are closed)";
  const lastCommit = tryGit(deps, ["log", "-1", "--format=%h %s"], root, "none");
  const status = tryGit(deps, ["status", "--porcelain"], root, "");
  const dirty = status ? status.split("\n").filter(Boolean).length : 0;
  const checkpointPath = join(harnessHomePaths(deps.homeDir).sessionsDir, projectKeyForPath(root), "checkpoints", `${doc.name}.md`);
  const info = { feature: doc.name, docPath: doc.path, nextTask, branch, lastCommit, dirty, savedAt: deps.now().toISOString() };
  const result = { ok: true, nextTask, checkpointPath, dirty, engramError: null, error: null };
  try {
    deps.fs.mkdirSync(dirname(checkpointPath), { recursive: true });
    // Temp file plus rename: a reader never sees a half-written checkpoint.
    const temp = `${checkpointPath}.${process.pid}.tmp`;
    deps.fs.writeFileSync(temp, renderCheckpoint(info));
    deps.fs.renameSync(temp, checkpointPath);
  } catch (error) {
    return { ...result, ok: false, error: error.message };
  }
  try {
    const saved = deps.engram(["save", `Checkpoint ${doc.name}`, renderCheckpoint(info), "--type", "architecture",
      "--project", engramProject(deps, root), "--topic", `odd/${doc.name}/checkpoint`]);
    if (!saved || saved.error || saved.status !== 0) result.engramError = saved?.error?.message ?? `exit ${saved?.status ?? "unknown"}`;
  } catch (error) {
    result.engramError = error.message;
  }
  return result;
}

/** Runs `kairo continue`. Returns the exit code; never closes or kills the current session. */
export function runContinue(options = {}, overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const cwd = options.cwd ?? process.cwd();
  const root = tryGit(deps, ["rev-parse", "--show-toplevel"], cwd, cwd);
  const branch = tryGit(deps, ["rev-parse", "--abbrev-ref", "HEAD"], root, "unknown");

  const docs = listFeatureDocs(deps, root);
  const doc = pickFeature(docs, { feature: options.feature, branch });
  if (!doc) {
    deps.stderr(`kairo continue: no feature document found in ${join(root, "odd", "tasks")}${options.feature ? ` for "${options.feature}"` : ""}.\n`);
    return 1;
  }

  const written = writeCheckpoint(deps, root, branch, doc);
  if (written.dirty > 0) deps.stderr(`warning: ${written.dirty} uncommitted file(s); the checkpoint records the count, commit or stash before the fresh session.\n`);
  if (!written.ok) {
    deps.stderr(`kairo continue: cannot write the checkpoint at ${written.checkpointPath}: ${written.error}\n`);
    return 1;
  }
  if (written.engramError) deps.stderr(`warning: engram save skipped (${written.engramError}); the Kairo checkpoint file is written.\n`);
  const { nextTask, checkpointPath } = written;

  const prompt = buildResumePrompt({ feature: doc.name, docPath: doc.path, nextTask, branch, checkpointPath });

  let hostId;
  if (options.host) hostId = options.host === "claude-code" ? "claude" : options.host;
  else {
    let active = null;
    try { active = resolveActiveHost({ env: deps.env }).id; } catch { /* ambiguous markers: fall back */ }
    hostId = active === "claude-code" ? "claude" : active ?? "claude";
  }
  const command = LAUNCHABLE[hostId];
  if (!command && !PRINT_ONLY.has(hostId)) {
    deps.stderr(`kairo continue: unsupported host "${hostId}". Use claude, codex or gentle-shell.\n`);
    return 1;
  }

  if (options.print || !deps.isTTY) {
    deps.stdout(`${prompt}\n`);
    return 0;
  }
  if (!command) {
    deps.stdout(`${prompt}\n`);
    deps.stdout(`Start a fresh ${hostId} session and paste the prompt above (the positional prompt is unverified for ${hostId}).\n`);
    return 0;
  }
  const result = deps.spawn(command, [prompt], { stdio: "inherit", cwd: root });
  if (result?.error) {
    deps.stderr(`kairo continue: cannot start ${command}: ${result.error.message}\n`);
    return 1;
  }
  return result?.status ?? 1;
}
