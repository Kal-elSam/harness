/**
 * Append-only record of the delegation circuit for one task:
 * delegated -> result_observed -> review_authorized -> comments_recorded
 * -> correction_recorded.
 *
 * Stored beside the task's existing execution link (`transitions.jsonl`).
 * Records carry only ids, a kind from a fixed enum, a timestamp and an
 * opaque evidence pointer (`<scheme>:<id>`): no secrets, no absolute paths.
 * Appending is idempotent per (kind, runId), never rewrites the file, and
 * never launches anything. The pending NEXT step is derived on read and is
 * never executed by this module.
 */
import { appendFile, lstat, readFile } from "node:fs/promises";
import { prepareTaskDirectory, taskPaths } from "../architect/architect-store.js";

export const TRANSITION_SCHEMA = "kairo.transition/v1";
export const TRANSITION_KINDS = Object.freeze([
  "delegated", "result_observed", "review_authorized", "comments_recorded", "correction_recorded"
]);
/** Kinds a caller may assert explicitly; the first two are only observed by the service. */
export const EXTERNAL_TRANSITION_KINDS = Object.freeze(TRANSITION_KINDS.slice(2));

const RUN_ID = /^run_[a-z0-9_]+$/;
const EVIDENCE = /^[a-z][a-z_]{0,31}:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SECRET = /token|secret|password|authorization|bearer|api[_-]?key/i;

function typed(code, message) {
  return Object.assign(new Error(message), { code });
}

export function deriveNextTransition(entries) {
  const seen = new Set(entries.map((entry) => entry.kind));
  return TRANSITION_KINDS.find((kind) => !seen.has(kind)) ?? null;
}

const corrupt = () => ({ state: "corrupt", error: "transitions_corrupt", entries: [], next: null });

function validEntry(entry, taskId) {
  return entry && entry.schema === TRANSITION_SCHEMA && entry.taskId === taskId
    && TRANSITION_KINDS.includes(entry.kind) && RUN_ID.test(entry.runId ?? "")
    && typeof entry.at === "string" && EVIDENCE.test(entry.evidence ?? "");
}

/**
 * With `{ runId }` the WHOLE file is still validated first (corruption anywhere,
 * including other runs' lines, fails closed); only then are entries filtered to
 * that run and `next` derived from that run's own progress. Without the option
 * the historical mixed view is returned unchanged.
 */
export async function readTransitions(projectRoot, taskId, { runId } = {}) {
  try {
    const { transitionsPath } = taskPaths(projectRoot, taskId);
    const stat = await lstat(transitionsPath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat) return { state: "ok", error: null, entries: [], next: deriveNextTransition([]) };
    if (stat.isSymbolicLink() || !stat.isFile()) return corrupt();
    const entries = [];
    const keys = new Set();
    for (const line of (await readFile(transitionsPath, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line);
      if (!validEntry(entry, taskId)) return corrupt();
      const key = `${entry.kind}:${entry.runId}`;
      if (keys.has(key)) continue;
      keys.add(key);
      entries.push(entry);
    }
    const scoped = runId == null ? entries : entries.filter((entry) => entry.runId === runId);
    return { state: "ok", error: null, entries: scoped, next: deriveNextTransition(scoped) };
  } catch {
    return corrupt();
  }
}

export async function appendTransition(projectRoot, taskId, { runId, kind, evidence, at = new Date().toISOString() }) {
  if (!TRANSITION_KINDS.includes(kind)) throw typed("TRANSITION_KIND_INVALID", `Unknown transition kind "${kind}".`);
  if (!RUN_ID.test(runId ?? "")) throw typed("TRANSITION_RUN_INVALID", "A valid run id is required.");
  if (typeof evidence !== "string" || !EVIDENCE.test(evidence) || SECRET.test(evidence)) {
    throw typed("TRANSITION_EVIDENCE_INVALID", "Evidence must be an opaque <scheme>:<id> pointer.");
  }
  const current = await readTransitions(projectRoot, taskId);
  if (current.state === "corrupt") throw typed("TRANSITION_CORRUPT", "Transition record is corrupt; refusing to append.");
  if (current.entries.some((entry) => entry.kind === kind && entry.runId === runId)) {
    return { recorded: false, entry: current.entries.find((entry) => entry.kind === kind && entry.runId === runId) };
  }
  const previous = TRANSITION_KINDS[TRANSITION_KINDS.indexOf(kind) - 1];
  if (previous && !current.entries.some((entry) => entry.kind === previous && entry.runId === runId)) {
    throw typed("TRANSITION_OUT_OF_ORDER", `"${kind}" requires "${previous}" to be recorded first for this run.`);
  }
  const entry = { schema: TRANSITION_SCHEMA, taskId, runId, kind, at, evidence };
  const paths = await prepareTaskDirectory(projectRoot, taskId);
  await appendFile(paths.transitionsPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o644, flag: "a" });
  return { recorded: true, entry };
}

/** Default store; the service accepts `deps.transitionStore` with the same shape. */
export const fileTransitionStore = Object.freeze({ read: readTransitions, append: appendTransition });
