import { isAbsolute } from "node:path";
import {
  isExecutableAvailable,
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

function defaultWhichAbsolute(command, env) {
  if (!isExecutableAvailable(command, { env })) return "";
  const which = defaultProbeCommand("which", [command], { env, timeoutMs: WHICH_TIMEOUT_MS });
  const path = String(which.stdout ?? "").trim().split(/\r?\n/)[0] ?? "";
  return isAbsolute(path) ? path : "";
}

/** Resolve absolute Hermes binary; never return a bare command name. */
export function resolveHermesBinaryPath(command = "hermes", env = process.env, {
  whichCommand = defaultWhichAbsolute
} = {}) {
  const resolved = whichCommand(command, env) || null;
  return resolved && isAbsolute(resolved) ? resolved : null;
}

/**
 * Detect diagnostic capability names in help text.
 * Presence means the CLI *declares* the surface — not that Kairo may run it.
 */
export function detectHermesDiagnosticSurfaces(helpText) {
  const text = boundText(helpText);
  const found = Object.create(null);
  for (const name of HERMES_DIAGNOSTIC_SURFACES) {
    const re = new RegExp(`(?:^|[\\s,{|/])${name}(?=[\\s,}|/-]|$)`, "m");
    found[name] = re.test(text);
  }
  return Object.freeze(found);
}

function spawnFailure(label, probeResult) {
  if (probeResult?.timedOut) {
    return { state: "error", diagnostics: [`hermes ${label} timed out`], error: "timeout" };
  }
  if (probeResult?.error) {
    return {
      state: "error",
      diagnostics: [`hermes ${label} failed`],
      error: "spawn_error"
    };
  }
  if (probeResult?.status !== 0) {
    return {
      state: "error",
      diagnostics: [`hermes ${label} failed`],
      error: `exit ${probeResult?.status ?? "unknown"}`
    };
  }
  return null;
}

export async function probeHermes({
  env = process.env,
  cwd = process.cwd(),
  whichCommand = defaultWhichAbsolute,
  probeCommand = defaultProbeCommand
} = {}) {
  const path = resolveHermesBinaryPath("hermes", env, { whichCommand });
  if (!path) {
    return result({
      state: "missing",
      diagnostics: [
        "hermes absolute binary not resolved. Install Hermes Agent separately, then re-run the probe."
      ],
      evidence: [{ kind: "binary", path: null }]
    });
  }

  const evidence = [{ kind: "binary", path }];

  const versionResult = probeCommand(path, ["--version"], {
    cwd, env, timeoutMs: VERSION_TIMEOUT_MS
  });
  const versionFail = spawnFailure("--version", versionResult);
  if (versionFail) {
    return result({ ...versionFail, evidence });
  }
  const version = parseVersionFromOutput(boundText(versionResult.stdout));
  evidence.push({ kind: "version", version, ok: true });
  if (!version) {
    return result({
      state: "incompatible",
      contractCompatible: false,
      evidence,
      diagnostics: ["hermes --version did not yield a parseable version"]
    });
  }

  const helpResult = probeCommand(path, ["--help"], {
    cwd, env, timeoutMs: HELP_TIMEOUT_MS
  });
  const helpFail = spawnFailure("--help", helpResult);
  if (helpFail) {
    return result({ ...helpFail, version, evidence });
  }

  const surfaces = detectHermesDiagnosticSurfaces(helpResult.stdout);
  evidence.push({
    kind: "diagnostic_surfaces",
    surfaces: { ...surfaces },
    /** Capability availability only — surfaces were not executed. */
    executed: false
  });

  const missingMandatory = HERMES_MANDATORY_SURFACES.filter((name) => !surfaces[name]);
  if (missingMandatory.length) {
    return result({
      state: "incompatible",
      version,
      contractCompatible: false,
      evidence,
      diagnostics: missingMandatory.map((name) => `missing mandatory surface in --help: ${name}`)
    });
  }

  return result({
    state: "available",
    version,
    contractCompatible: true,
    evidence,
    diagnostics: surfaces.status
      ? []
      : ["optional surface absent in --help: status"]
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
