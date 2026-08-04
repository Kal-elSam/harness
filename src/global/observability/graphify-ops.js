import { printJson } from "../json-output.js";
import { commandHeader } from "../brand/index.js";
import { probeCommand as defaultProbeCommand } from "../cli-probe.js";
import {
  assertGraphInsideWorkspace, inspectGraphArtifact, resolveGitHeadSha, resolveGraphifyBinaryPath
} from "./graphify-probe.js";

const OPS_TIMEOUT_MS = 15_000;
const MAX_STDOUT_BYTES = 256_000;
const DEFAULT_QUERY_BUDGET = 2000;
const MAX_QUERY_BUDGET = 8000;
const OPS = new Set(["query", "path", "explain"]);

function fail(code, diagnostics, extra = {}) {
  return {
    ok: false, exitCode: 2, code, text: null, truncated: false, timedOut: false,
    providerStatus: null, diagnostics: diagnostics.map(String),
    op: null, graphPath: null, graphStatus: null, binary: null, ...extra
  };
}
function clampBudget(raw) {
  if (raw == null || raw === "") return DEFAULT_QUERY_BUDGET;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= MAX_QUERY_BUDGET ? n : null;
}
export async function runGraphifyOp({
  op, args = [], graphPath, cwd = process.cwd(), workspaceRoot = cwd,
  env = process.env, budget = DEFAULT_QUERY_BUDGET, whichCommand,
  probeCommand = defaultProbeCommand, inspectGraph = inspectGraphArtifact,
  containPath = assertGraphInsideWorkspace, headSha = null,
  resolveHead = resolveGitHeadSha,
  timeoutMs = OPS_TIMEOUT_MS, maxStdoutBytes = MAX_STDOUT_BYTES
} = {}) {
  if (!OPS.has(op)) return fail("invalid_request", [`Unknown graphify op "${op}".`], { op, graphPath });
  if (typeof graphPath !== "string" || !graphPath.trim()) {
    return fail("invalid_request", ["Missing --graph path."], { op, graphPath: graphPath ?? null });
  }
  let queryBudget = DEFAULT_QUERY_BUDGET;
  if (op === "query") {
    queryBudget = clampBudget(budget);
    if (queryBudget == null) {
      return fail("invalid_request", [`Invalid --budget (integer 1..${MAX_QUERY_BUDGET}).`], { op, graphPath });
    }
  }
  const binary = resolveGraphifyBinaryPath("graphify", env, whichCommand ? { whichCommand } : {});
  if (!binary) return fail("graphify_missing", ["graphify absolute binary not resolved."], { op, graphPath });

  const contained = containPath(workspaceRoot, graphPath, { cwd });
  if (!contained.ok) {
    return fail(contained.code ?? "graph_path_outside_workspace", [
      contained.code === "graph_path_outside_workspace"
        ? "Resolved --graph is outside the workspace; refusing spawn."
        : (contained.error ?? "Failed to resolve --graph path.")
    ], { op, graphPath: contained.path, binary });
  }

  const head = (typeof headSha === "string" && headSha.trim())
    ? headSha.trim()
    : resolveHead(cwd);
  const artifact = inspectGraph(contained.path, { cwd, headSha: head });
  if (artifact.status === "missing" || artifact.status === "malformed" || artifact.status === "error") {
    const code = artifact.status === "error" ? "graphify_error" : "graph_unavailable";
    return fail(code, artifact.diagnostics?.length ? artifact.diagnostics : [`graph ${artifact.status}`], {
      op, graphPath: artifact.path, graphStatus: artifact.status, binary
    });
  }

  const argv = op === "query"
    ? ["query", ...args.map(String), "--budget", String(queryBudget), "--graph", artifact.path]
    : [op, ...args.map(String), "--graph", artifact.path];
  let provider;
  try { provider = probeCommand(binary, argv, { cwd, env, timeoutMs }); }
  catch {
    return fail("provider_error", ["provider_error", "spawn_interrupted"], {
      op, graphPath: artifact.path, graphStatus: artifact.status, binary
    });
  }

  const timedOut = Boolean(provider?.timedOut);
  const status = provider?.status ?? null;
  const raw = String(provider?.stdout ?? "");
  const truncated = Buffer.byteLength(raw, "utf8") > maxStdoutBytes;
  const text = truncated ? Buffer.from(raw, "utf8").subarray(0, maxStdoutBytes).toString("utf8") : raw;
  const diagnostics = [...(artifact.diagnostics ?? [])];
  if (truncated) diagnostics.push("stdout_truncated");
  const ok = provider?.ok === true && status === 0 && timedOut !== true;
  if (!ok) {
    const d = ["provider_error", ...diagnostics, ...(timedOut ? ["timed_out"] : []), status != null ? `status=${status}` : "status_unknown"];
    return fail(timedOut ? "timed_out" : "provider_error", d, {
      op, graphPath: artifact.path, graphStatus: artifact.status, binary,
      text: text || null, truncated, providerStatus: status, timedOut
    });
  }
  return {
    ok: true, exitCode: 0, code: "ok", op, graphPath: artifact.path, graphStatus: artifact.status,
    text, truncated, diagnostics, providerStatus: status, timedOut: false, binary
  };
}

export async function runGraphifyCli(options, _pkg, deps = {}) {
  try {
    if (!options.graphifyAction || !options.graphPath) {
      throw new Error("Missing graphify action or --graph. Use: kairo graphify <query|path|explain> ... --graph <path>");
    }
    const result = await (deps.runGraphifyOp ?? runGraphifyOp)({
      op: options.graphifyAction, args: options.graphifyArgs ?? [],
      graphPath: options.graphPath, cwd: options.cwd ?? process.cwd(),
      workspaceRoot: options.cwd ?? process.cwd(), budget: options.graphifyBudget,
      headSha: options.headSha ?? deps.headSha ?? null,
      resolveHead: deps.resolveHead
    });
    process.exitCode = result.exitCode;
    if (options.json) {
      printJson({
        ok: result.ok, exitCode: result.exitCode, code: result.code, op: result.op,
        graphPath: result.graphPath, graphStatus: result.graphStatus, text: result.text,
        truncated: result.truncated, diagnostics: result.diagnostics,
        providerStatus: result.providerStatus, timedOut: result.timedOut
      });
    } else if (result.ok) console.log(`${commandHeader(`graphify ${options.graphifyAction}`)}\n${result.text ?? ""}`);
    else {
      console.error(`graphify ${options.graphifyAction} failed (${result.code}).`);
      for (const line of result.diagnostics ?? []) console.error(`  ${line}`);
    }
    return result;
  } catch (error) {
    const message = String(error?.message ?? error);
    if (options.json) printJson({ ok: false, exitCode: 2, error: message, code: error?.code ?? null });
    else console.error(message);
    process.exitCode = 2;
    return { exitCode: 2, error };
  }
}
