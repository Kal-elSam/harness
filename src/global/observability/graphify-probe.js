import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isExecutableAvailable, probeCommand as defaultProbeCommand } from "../cli-probe.js";
import { normalizeProbeResult } from "./probe-contract.js";

export const GRAPH_REPORT_COMMIT_PATTERN = /Built from commit:\s*`([0-9a-f]+)`/i;

/** Env keys that redirect Git away from cwd — strip before rev-parse. */
const GIT_OVERRIDE_KEYS = Object.freeze([
  "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY",
  "GIT_INDEX_FILE", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CEILING_DIRECTORIES",
  "GIT_NAMESPACE"
]);

export function scrubGitOverrideEnv(env = process.env) {
  const clean = { ...env };
  for (const key of GIT_OVERRIDE_KEYS) delete clean[key];
  return clean;
}

/** Fail-soft productive HEAD bound to workspace top-level; never throws. */
export function resolveGitHeadSha(cwd = process.cwd(), {
  spawn = spawnSync, timeoutMs = 3000, env = process.env, realpath = realpathSync
} = {}) {
  try {
    const cleanEnv = scrubGitOverrideEnv(env);
    const opts = { cwd, encoding: "utf8", timeout: timeoutMs, env: cleanEnv };
    const top = spawn("git", ["rev-parse", "--show-toplevel"], opts);
    if (top.status !== 0) return null;
    const topLevel = String(top.stdout ?? "").trim();
    if (!topLevel) return null;
    let wanted;
    let actual;
    try {
      wanted = realpath(resolve(cwd));
      actual = realpath(topLevel);
    } catch {
      return null;
    }
    if (wanted !== actual) return null;
    const head = spawn("git", ["rev-parse", "HEAD"], opts);
    if (head.status !== 0) return null;
    const sha = String(head.stdout ?? "").trim();
    return /^[0-9a-f]{7,64}$/i.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

function effectiveHeadSha(headSha, cwd, resolveHead) {
  if (typeof headSha === "string" && headSha.trim()) return headSha.trim();
  return resolveHead(cwd);
}

function defaultWhichAbsolute(command, env) {
  if (!isExecutableAvailable(command, { env })) return "";
  const which = defaultProbeCommand("which", [command], { env, timeoutMs: 3000 });
  const path = String(which.stdout ?? "").trim().split(/\r?\n/)[0] ?? "";
  return isAbsolute(path) ? path : "";
}

export function resolveGraphifyBinaryPath(command = "graphify", env = process.env, {
  whichCommand = defaultWhichAbsolute
} = {}) {
  const resolved = whichCommand(command, env) || null;
  return resolved && isAbsolute(resolved) ? resolved : null;
}

function ioFail(code, status, path, err) {
  return { status, path, error: status === "missing" ? null : (err?.message ?? String(err)), diagnostics: [code] };
}

/** ENOENT→missing; invalid JSON / non-object / nodes|links not arrays→malformed; else error. */
export function inspectGraphArtifact(graphPath, {
  cwd = process.cwd(), readFile = (p) => readFileSync(p, "utf8"),
  realpath = (p) => realpathSync(p), headSha = null
} = {}) {
  if (typeof graphPath !== "string" || !graphPath.trim()) {
    return { status: "error", path: null, error: "missing graph path", diagnostics: ["invalid_request"] };
  }
  const abs = resolve(cwd, graphPath);
  let resolved;
  try { resolved = realpath(abs); }
  catch (err) {
    const missing = err?.code === "ENOENT";
    return ioFail(missing ? "graph_missing" : "realpath_error", missing ? "missing" : "error", abs, err);
  }
  let raw;
  try { raw = readFile(resolved); }
  catch (err) {
    const missing = err?.code === "ENOENT";
    return ioFail(missing ? "graph_missing" : "read_error", missing ? "missing" : "error", resolved, err);
  }
  let payload;
  try { payload = JSON.parse(String(raw)); }
  catch { return { status: "malformed", path: resolved, error: null, diagnostics: ["invalid_json"] }; }
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)
    || !Array.isArray(payload.nodes) || !Array.isArray(payload.links)) {
    return { status: "malformed", path: resolved, error: null, diagnostics: ["nodes_or_links_invalid"] };
  }
  const diagnostics = [];
  let status = "ok";
  if (typeof headSha === "string" && headSha) {
    try {
      const m = String(readFile(join(dirname(resolved), "GRAPH_REPORT.md"))).match(GRAPH_REPORT_COMMIT_PATTERN);
      if (m && !(headSha.startsWith(m[1]) || m[1].startsWith(headSha))) {
        status = "stale";
        diagnostics.push(`stale graph=${m[1]} head=${headSha.slice(0, 8)}`);
      }
    } catch { /* missing report → ok */ }
  }
  return { status, path: resolved, error: null, diagnostics };
}

/** realpath(--graph) inside workspace; missing leaf OK if parent is inside. */
export function assertGraphInsideWorkspace(workspaceRoot, graphPath, {
  cwd = process.cwd(), realpath = (p) => realpathSync(p)
} = {}) {
  let root;
  try { root = realpath(resolve(cwd, workspaceRoot)); }
  catch (err) {
    return { ok: false, code: "graphify_error", path: resolve(cwd, graphPath), root: null, error: err?.message };
  }
  const abs = resolve(cwd, graphPath);
  let target;
  try { target = realpath(abs); }
  catch (err) {
    if (err?.code !== "ENOENT") return { ok: false, code: "graphify_error", path: abs, root, error: err?.message };
    try { target = join(realpath(dirname(abs)), basename(abs)); }
    catch (e) {
      return { ok: false, code: e?.code === "ENOENT" ? "graph_unavailable" : "graphify_error", path: abs, root, error: e?.message };
    }
  }
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, code: "graph_path_outside_workspace", path: target, root };
  }
  return { ok: true, code: null, path: target, root };
}

export async function probeGraphify({
  env = process.env, cwd = process.cwd(), whichCommand = defaultWhichAbsolute,
  inspectGraph = inspectGraphArtifact, headSha = null, resolveHead = resolveGitHeadSha
} = {}) {
  let path = null;
  try {
    path = resolveGraphifyBinaryPath("graphify", env, { whichCommand });
    if (!path) {
      return normalizeProbeResult({
        id: "graphify", state: "missing", diagnostics: ["graphify absolute binary not resolved."],
        evidence: [{ kind: "binary", path: null }]
      }, "graphify");
    }
    const head = effectiveHeadSha(headSha, cwd, resolveHead);
    const graph = inspectGraph(join(cwd, "graphify-out", "graph.json"), { cwd, headSha: head });
    const state = graph.status === "error" ? "error" : "available";
    return normalizeProbeResult({
      id: "graphify", state, diagnostics: [...(graph.diagnostics ?? [])],
      evidence: [{ kind: "binary", path }, { kind: "graph", path: graph.path, status: graph.status }],
      error: graph.status === "error" ? graph.error : null
    }, "graphify");
  } catch (err) {
    return normalizeProbeResult({
      id: "graphify", state: "error", evidence: [{ kind: "binary", path }],
      diagnostics: [path ? "graph inspect failed" : "graphify binary resolve failed"],
      error: err?.message ?? String(err)
    }, "graphify");
  }
}

export function createGraphifyProbe(deps = {}) {
  return {
    id: "graphify",
    declaredEvents: Object.freeze([]),
    declaredActions: Object.freeze(["query", "path", "explain"]),
    async probe(context = {}) {
      return probeGraphify({ ...deps, ...context, env: context.env ?? deps.env ?? process.env });
    }
  };
}
