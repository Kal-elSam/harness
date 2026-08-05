import { isAbsolute } from "node:path";
import {
  parseVersionFromOutput,
  probeCommand as defaultProbeCommand
} from "../cli-probe.js";
import { normalizeProbeResult } from "./probe-contract.js";

/** Surfaces recognized from `hermes --help` only — never executed by this probe. */
export const HERMES_DIAGNOSTIC_SURFACES = Object.freeze(["version", "doctor", "status"]);
export const HERMES_MANDATORY_SURFACES = Object.freeze(["version", "doctor"]);

const WHICH_TIMEOUT_MS = 3000;
const VERSION_TIMEOUT_MS = 8000;
const HELP_TIMEOUT_MS = 8000;
const MAX_PROBE_BYTES = 65_536;

function result(partial) {
  return normalizeProbeResult({
    id: "hermes", version: null, contractCompatible: null,
    diagnostics: [], evidence: [], error: null, ...partial
  }, "hermes");
}

function boundText(raw, maxBytes = MAX_PROBE_BYTES) {
  const text = String(raw ?? "");
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  return Buffer.from(text, "utf8").subarray(0, maxBytes).toString("utf8");
}

function whichAbsolutePath(command, env, run = defaultProbeCommand) {
  const which = run("which", [command], { env, timeoutMs: WHICH_TIMEOUT_MS });
  if (!which?.ok) return "";
  const path = String(which.stdout ?? "").trim().split(/\r?\n/)[0] ?? "";
  return isAbsolute(path) ? path : "";
}

/** Resolve absolute Hermes binary; never return a bare command name. */
export function resolveHermesBinaryPath(command = "hermes", env = process.env, {
  whichCommand,
  probeCommand = defaultProbeCommand
} = {}) {
  const resolver = typeof whichCommand === "function"
    ? whichCommand
    : (cmd, e) => whichAbsolutePath(cmd, e, probeCommand);
  const resolved = resolver(command, env) || null;
  return resolved && isAbsolute(resolved) ? resolved : null;
}

/** Presence means the CLI *declares* the surface — not that Kairo may run it. */
export function detectHermesDiagnosticSurfaces(helpText) {
  const text = boundText(helpText);
  const found = Object.create(null);
  for (const name of HERMES_DIAGNOSTIC_SURFACES) {
    found[name] = new RegExp(`(?:^|[\\s,{|/])${name}(?=[\\s,}|/-]|$)`, "m").test(text);
  }
  return Object.freeze(found);
}

function softError(label, kind, evidence, extra = {}) {
  return result({
    state: "error",
    diagnostics: [`hermes ${label} ${kind === "timeout" ? "timed out" : "failed"}`],
    error: kind === "timeout" ? "timeout" : kind === "exit" ? `exit ${extra.code}` : "spawn_error",
    evidence,
    ...extra.fields
  });
}

function spawnFailure(label, probeResult, evidence, extra = {}) {
  if (probeResult?.timedOut) return softError(label, "timeout", evidence, extra);
  if (probeResult?.error) return softError(label, "spawn", evidence, extra);
  if (probeResult?.status !== 0) {
    return softError(label, "exit", evidence, { ...extra, code: probeResult?.status ?? "unknown" });
  }
  return null;
}

/** which: preserve timeout/spawn_error; exit/empty → missing (not failure). */
function whichFailure(probeResult, evidence) {
  if (probeResult?.timedOut) return softError("which", "timeout", evidence);
  if (probeResult?.error) return softError("which", "spawn", evidence);
  return null;
}

function runProbe(probeCommand, cmd, args, opts) {
  try { return { ok: true, value: probeCommand(cmd, args, opts) }; }
  catch { return { ok: false }; }
}

export async function probeHermes({
  env = process.env,
  cwd = process.cwd(),
  whichCommand,
  probeCommand = defaultProbeCommand
} = {}) {
  const noBinary = [{ kind: "binary", path: null }];
  let path;

  if (typeof whichCommand === "function") {
    try { path = resolveHermesBinaryPath("hermes", env, { whichCommand, probeCommand }); }
    catch { return softError("which", "spawn", noBinary); }
  } else {
    const inv = runProbe(probeCommand, "which", ["hermes"], { env, timeoutMs: WHICH_TIMEOUT_MS });
    if (!inv.ok) return softError("which", "spawn", noBinary);
    const fail = whichFailure(inv.value, noBinary);
    if (fail) return fail;
    const candidate = String(inv.value?.stdout ?? "").trim().split(/\r?\n/)[0] ?? "";
    path = inv.value?.ok && isAbsolute(candidate) ? candidate : null;
  }

  if (!path) {
    return result({
      state: "missing",
      diagnostics: [
        "hermes absolute binary not resolved. Install Hermes Agent separately, then re-run the probe."
      ],
      evidence: noBinary
    });
  }

  const evidence = [{ kind: "binary", path }];
  const versionInv = runProbe(probeCommand, path, ["--version"], {
    cwd, env, timeoutMs: VERSION_TIMEOUT_MS
  });
  if (!versionInv.ok) return softError("--version", "spawn", evidence);
  const versionFail = spawnFailure("--version", versionInv.value, evidence);
  if (versionFail) return versionFail;
  const version = parseVersionFromOutput(boundText(versionInv.value.stdout));
  evidence.push({ kind: "version", version, ok: true });
  if (!version) {
    return result({
      state: "incompatible", contractCompatible: false, evidence,
      diagnostics: ["hermes --version did not yield a parseable version"]
    });
  }

  const helpInv = runProbe(probeCommand, path, ["--help"], {
    cwd, env, timeoutMs: HELP_TIMEOUT_MS
  });
  if (!helpInv.ok) return softError("--help", "spawn", evidence, { fields: { version } });
  const helpFail = spawnFailure("--help", helpInv.value, evidence, { fields: { version } });
  if (helpFail) return helpFail;

  const surfaces = detectHermesDiagnosticSurfaces(helpInv.value.stdout);
  // Capability availability only — surfaces were not executed.
  evidence.push({ kind: "diagnostic_surfaces", surfaces: { ...surfaces }, executed: false });

  const missingMandatory = HERMES_MANDATORY_SURFACES.filter((name) => !surfaces[name]);
  if (missingMandatory.length) {
    return result({
      state: "incompatible", version, contractCompatible: false, evidence,
      diagnostics: missingMandatory.map((name) => `missing mandatory surface in --help: ${name}`)
    });
  }

  return result({
    state: "available", version, contractCompatible: true, evidence,
    diagnostics: surfaces.status ? [] : ["optional surface absent in --help: status"]
  });
}

export function createHermesProbe(deps = {}) {
  return {
    id: "hermes",
    declaredEvents: Object.freeze([]),
    declaredActions: Object.freeze([]),
    async probe(context = {}) {
      return probeHermes({ ...deps, ...context, env: context.env ?? deps.env ?? process.env });
    }
  };
}
