/**
 * Production reader for the user-owned receipt-driven development (RDD) switch.
 *
 * It runs exactly `gentle-ai review mode status --cwd <root> --json`, which is
 * read-only (the subcommand shares its flags with enable/disable, but `status`
 * never writes). The allow-list below is deliberately that single argv shape:
 * every other `review mode` verb or flag is refused before any process runs, so
 * Kairo can never toggle the mode.
 *
 * Semantics of the result `mode`:
 * - `on`: the user-owned switch permits review. Candidate consent is separate;
 *   this never approves a task and a project receipt is never task approval.
 * - `off`: the user disabled receipt-driven development (see `source`).
 * - `unknown`: anything we could not establish (binary missing, timeout, non-zero
 *   exit, unparseable output, schema mismatch, unrecognized `effective`). It
 *   NEVER means permission and NEVER means `on`; no behavior is enabled by it.
 *
 * Only the `--json` form is parsed. The human text form is not an interface.
 */
import { isAbsolute } from "node:path";
import { runGentleCommand } from "../control-plane/gentle-adapters.js";
import { resolveGentleBinaryPath } from "../observability/gentle-probe.js";

export const RDD_MODE_TIMEOUT_MS = 8_000;
export const RDD_MODE_SCHEMA = "gentle-ai.review-mode/v1";
export const RDD_MODE_STATUS_SCHEMA = "gentle-ai.rdd-mode-status/v1";

const TIMEOUT = /timeout|timed out|etimedout/i;
const SCOPE_VALUE = new Set(["on", "off"]);
const MODES = new Set(["on", "off"]);

const validRoot = (root) => typeof root === "string" && isAbsolute(root) && !root.startsWith("-");

export const rddModeArgv = (projectRoot) => ["review", "mode", "status", "--cwd", projectRoot, "--json"];

/** True only for the exact read-only `review mode status --cwd <abs> --json` shape. */
export function isReadOnlyGentleArgv(argv) {
  if (!Array.isArray(argv) || argv.length !== 6) return false;
  const [a, b, c, d, root, json] = argv;
  return a === "review" && b === "mode" && c === "status" && d === "--cwd" && json === "--json" && validRoot(root);
}

/**
 * Wraps a command runner so it only executes the read-only shapes this module
 * knows: the exact mode-status argv, or `review status ...` without a mutating
 * verb (the existing bootstrap). Anything else is refused without a call.
 */
export function createGuardedRunner(runCommand) {
  return (argv, options) => {
    const statusShape = Array.isArray(argv) && argv[0] === "review" && argv[1] === "status";
    if (!isReadOnlyGentleArgv(argv) && !statusShape) {
      return { ok: false, error: "gentle_incompatible", payload: null };
    }
    return runCommand(argv, options);
  };
}

export function mapRunError(code) {
  if (typeof code !== "string" || !code) return "gentle_reader_failed";
  if (/^gentle_(nonzero_status|parse_failed|incompatible)$/.test(code)) return code;
  if (TIMEOUT.test(code)) return "gentle_timeout";
  return "gentle_spawn_failed";
}

const scope = (value) => (typeof value === "string" && SCOPE_VALUE.has(value) ? value : null);

/** Strict parse by schema; unrecognized `effective` is `unknown`, never `on`. */
export function parseRddModeStatus(payload) {
  const isObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
  if (!isObject(payload) || payload.schema !== RDD_MODE_SCHEMA || payload.operation !== "status"
    || !isObject(payload.status) || payload.status.schema !== RDD_MODE_STATUS_SCHEMA) {
    return { ok: false, error: "gentle_incompatible" };
  }
  const s = payload.status;
  const source = typeof s.source === "string" && /^[a-z][a-z-]{0,31}$/.test(s.source) ? s.source : null;
  return {
    ok: true,
    mode: typeof s.effective === "string" && MODES.has(s.effective) ? s.effective : "unknown",
    source,
    global: scope(s.global),
    cloneLocal: scope(s.clone_local)
  };
}

const failure = (error) => ({ mode: "unknown", source: null, global: null, cloneLocal: null, error });

/**
 * @param {{
 *   runCommand?: Function, env?: object, timeoutMs?: number, spawn?: Function,
 *   binaryPath?: string, resolveBinary?: Function
 * }} [deps] injection seam; tests stay offline.
 * @returns {(input: {projectRoot: string, binaryPath?: string}) => Promise<object>}
 */
export function createRddModeReader(deps = {}) {
  const run = createGuardedRunner(deps.runCommand ?? runGentleCommand);
  const env = deps.env ?? process.env;
  const timeoutMs = deps.timeoutMs ?? RDD_MODE_TIMEOUT_MS;
  const resolveBinary = deps.resolveBinary ?? ((e) => resolveGentleBinaryPath("gentle-ai", e));

  return async function readRddMode({ projectRoot, binaryPath } = {}) {
    try {
      if (!validRoot(projectRoot)) return failure("gentle_incompatible");
      const binary = binaryPath ?? deps.binaryPath ?? resolveBinary(env);
      if (typeof binary !== "string" || !isAbsolute(binary)) return failure("gentle_binary_missing");
      const result = run(rddModeArgv(projectRoot), {
        cwd: projectRoot, env, timeoutMs, spawn: deps.spawn, command: binary, strict: true
      });
      if (!result?.ok) return failure(mapRunError(result?.error));
      const parsed = parseRddModeStatus(result.payload);
      if (!parsed.ok) return failure(parsed.error);
      return { mode: parsed.mode, source: parsed.source, global: parsed.global, cloneLocal: parsed.cloneLocal, error: null };
    } catch {
      return failure("gentle_reader_failed");
    }
  };
}
