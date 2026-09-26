/**
 * Pi session files on disk for one cwd (RPC has no list_sessions command).
 */

import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, basename } from "node:path";
import { resolveHomeDir } from "../paths.js";

/** Same encoding as Pi session-transcripts / session manager. */
export function cwdToSessionDirName(cwd) {
  const normalized = resolve(cwd).replace(/\//g, "-");
  return `--${normalized.slice(1)}--`;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolvePiSessionsRoot(env = process.env) {
  const home = resolveHomeDir(env);
  const agentDir =
    typeof env.PI_CODING_AGENT_DIR === "string" && env.PI_CODING_AGENT_DIR.trim()
      ? env.PI_CODING_AGENT_DIR.trim()
      : join(home, ".harness", "pi-agent");
  return join(agentDir, "sessions");
}

/**
 * @param {string} filePath
 * @returns {{ sessionId: string|null, sessionName: string|null, cwd: string|null }}
 */
export function readPiSessionHeader(filePath) {
  try {
    const fd = readFileSync(filePath, "utf8");
    const firstLine = fd.split("\n").find((l) => l.trim());
    if (!firstLine) return { sessionId: null, sessionName: null, cwd: null };
    const header = JSON.parse(firstLine);
    if (header?.type !== "session") {
      return { sessionId: null, sessionName: null, cwd: null };
    }
    return {
      sessionId: typeof header.id === "string" ? header.id : null,
      sessionName: typeof header.name === "string" ? header.name : null,
      cwd: typeof header.cwd === "string" ? header.cwd : null
    };
  } catch {
    return { sessionId: null, sessionName: null, cwd: null };
  }
}

/**
 * List `.jsonl` session files for `cwd`, newest mtime first.
 *
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Array<{ path: string, sessionId: string|null, label: string, mtimeMs: number }>}
 */
export function listPiSessionFilesForCwd({ cwd = process.cwd(), env = process.env } = {}) {
  const root = resolvePiSessionsRoot(env);
  const dirName = cwdToSessionDirName(cwd);
  const sessionDir = join(root, dirName);
  if (!existsSync(sessionDir)) {
    return [];
  }
  let names;
  try {
    names = readdirSync(sessionDir);
  } catch {
    return [];
  }
  const resolvedCwd = resolve(cwd);
  const out = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const path = join(sessionDir, name);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    const header = readPiSessionHeader(path);
    if (header.cwd && resolve(header.cwd) !== resolvedCwd) continue;
    const sessionId = header.sessionId ?? basename(name, ".jsonl");
    const label =
      header.sessionName?.trim() ||
      (sessionId.length > 8 ? `${sessionId.slice(0, 8)}…` : sessionId);
    out.push({ path, sessionId, label, mtimeMs });
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}
