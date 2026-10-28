import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { projectKeyForPath } from "../next/project-key.js";
import { defaultDeps, listFeatureDocs, pickFeature, tryGit, writeCheckpoint } from "./continue.js";

const TRIGGERS = new Set(["commit", "delegate", "compact"]);
export const THROTTLE_MS = 60000;

const FRESH_COMMIT_S = 120;
const STALE_LOCK_MS = 10000;

/** Cheap pre-filter only; whether a commit really happened is decided by HEAD. */
function mentionsCommit(command) {
  return typeof command === "string" && /\bgit\b[^;&|]*\bcommit\b/.test(command);
}

function statePaths(deps, root, feature) {
  const dir = join(harnessHomePaths(deps.homeDir).sessionsDir, projectKeyForPath(root), "checkpoints");
  return { dir, checkpoint: join(dir, `${feature}.md`), throttle: join(dir, `${feature}.throttle.json`), lock: join(dir, `${feature}.lock`) };
}

/** HEAD's short hash when it is a commit the last checkpoint does not record and at most two minutes old, else null. */
function freshCommit(deps, root, paths) {
  const head = tryGit(deps, ["log", "-1", "--format=%h"], root, "");
  const seconds = Number(tryGit(deps, ["log", "-1", "--format=%ct"], root, ""));
  if (!head || !Number.isFinite(seconds) || deps.now().getTime() / 1000 - seconds > FRESH_COMMIT_S) return null;
  try {
    const recorded = deps.fs.readFileSync(paths.checkpoint, "utf8").match(/^- Last commit: (\S+)/m)?.[1];
    if (recorded === head) return null;
  } catch { /* no checkpoint yet */ }
  return head;
}

/**
 * Reserves the throttle slot before any work, so concurrent triggers collapse to one. An exclusive-create lock
 * guards the check-and-write; losing the lock race means another trigger is deciding, so this one stands down.
 */
function reserve(deps, paths, head = null) {
  const now = deps.now().getTime();
  deps.fs.mkdirSync(paths.dir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      deps.fs.writeFileSync(paths.lock, String(now), { flag: "wx" });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let held = Infinity;
      try { held = Date.now() - deps.fs.statSync(paths.lock).mtimeMs; } catch { /* released meanwhile */ }
      if (attempt === 1 || held < STALE_LOCK_MS) return false;
      try { deps.fs.unlinkSync(paths.lock); } catch { /* another process took it */ }
    }
  }
  try {
    let last = {};
    try { last = JSON.parse(deps.fs.readFileSync(paths.throttle, "utf8")) ?? {}; } catch { /* no state yet */ }
    // A closed task (new HEAD) always checkpoints once; the time window only collapses the other triggers.
    if (head ? last.head === head : Number.isFinite(last.at) && now - last.at >= 0 && now - last.at < THROTTLE_MS) return false;
    const temp = `${paths.throttle}.${process.pid}.tmp`;
    deps.fs.writeFileSync(temp, JSON.stringify({ at: now, head: head ?? last.head ?? null }));
    deps.fs.renameSync(temp, paths.throttle);
    return true;
  } finally {
    try { deps.fs.unlinkSync(paths.lock); } catch { /* already gone */ }
  }
}

/**
 * Automatic checkpoint at a stable point (closed task, before compaction, before delegating).
 * Writes only the checkpoint file and the best-effort Engram save; never starts or closes a session
 * and never fails the host action: it always returns 0 and prints at most one stderr line.
 */
export function runCheckpointTrigger(options = {}, overrides = {}) {
  try {
    // A hook must stay quick: the Engram save gets a short timeout here.
    const deps = { ...defaultDeps(), engram: args => spawnSync("engram", args, { encoding: "utf8", timeout: 4000 }), ...overrides };
    if (!TRIGGERS.has(options.trigger)) return 0;
    if (options.trigger === "commit" && options.command !== undefined && !mentionsCommit(options.command)) return 0;
    const cwd = options.cwd ?? process.cwd();
    const root = tryGit(deps, ["rev-parse", "--show-toplevel"], cwd, cwd);
    const branch = tryGit(deps, ["rev-parse", "--abbrev-ref", "HEAD"], root, "unknown");
    const doc = pickFeature(listFeatureDocs(deps, root), { branch });
    // --json: a commit trigger reports whether a checkpoint was written, the tree state and the task type, for the host's fresh-session decision.
    const report = (written) => {
      if (!options.json || options.trigger !== "commit") return;
      // A failing git never reads as a clean tree.
      const clean = tryGit(deps, ["status", "--porcelain"], root, null) === "";
      const fullHead = tryGit(deps, ["log", "-1", "--format=%H"], root, "");
      deps.stdout(`${JSON.stringify({ trigger: "commit", written, clean, taskType: doc ? "feature" : "small", feature: doc?.name ?? null, head: fullHead || null })}\n`);
    };
    if (!doc) { report(false); return 0; }
    const paths = statePaths(deps, root, doc.name);
    const head = options.trigger === "commit" ? freshCommit(deps, root, paths) : null;
    if (options.trigger === "commit" && !head) { report(false); return 0; }
    if (!reserve(deps, paths, head)) { report(false); return 0; }
    const written = writeCheckpoint(deps, root, branch, doc);
    if (!written.ok) {
      deps.stderr(`kairo checkpoint: skipped (${written.error})\n`);
      report(false);
      return 0;
    }
    report(true);
    if (written.engramError) deps.stderr(`kairo checkpoint: engram save skipped (${written.engramError})\n`);
  } catch (error) {
    try { (overrides.stderr ?? (text => process.stderr.write(text)))(`kairo checkpoint: skipped (${error.message})\n`); } catch { /* nothing left to report to */ }
  }
  return 0;
}
