import {
  isExecutableAvailable,
  parseVersionFromOutput,
  probeCommand as defaultProbeCommand
} from "../cli-probe.js";
import { normalizeProbeResult } from "./probe-contract.js";

export const SUPPORTED_PROTOCOL = Object.freeze({ major: 2, minor: 0 });
export const SUPPORTED_SCHEMA = "gentle-ai.review-integration.capabilities/v2";
export const SUPPORTED_CONTRACT = "gentle-ai.review-integration/v2";
export const SUPPORTED_MANDATORY_FEATURES = Object.freeze([
  "compact_v2_authority", "exact_receipt_replay", "five_delivery_gates",
  "immutable_snapshot", "legacy_v1_target_scoped_read_only",
  "repository_independent_capabilities", "restart_safe_projection",
  "sdd_receipt_binding", "target_scoped_status", "uniform_failure_envelope"
]);

const SUPPORT_SET = new Set(SUPPORTED_MANDATORY_FEATURES);

function result(partial) {
  return normalizeProbeResult({
    id: "gentle", version: null, contractCompatible: null,
    diagnostics: [], evidence: [], error: null, ...partial
  }, "gentle");
}

/** Package version is evidence only — never the compatibility gate. */
export function evaluateGentleCapabilities(payload) {
  const diagnostics = [];
  const evidence = [{ kind: "capabilities", schema: payload?.schema ?? null }];
  const version = payload?.package?.version ?? null;
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return result({
      state: "error", version, evidence, error: "invalid capabilities payload",
      diagnostics: ["Capabilities payload is not an object."]
    });
  }
  if (payload.schema !== SUPPORTED_SCHEMA) {
    diagnostics.push(`schema mismatch: got ${String(payload.schema)}`);
  }
  if (payload.contract !== SUPPORTED_CONTRACT) {
    diagnostics.push(`contract mismatch: got ${String(payload.contract)}`);
  }
  if (payload.protocol?.major !== SUPPORTED_PROTOCOL.major) {
    diagnostics.push(`protocol.major mismatch: got ${String(payload.protocol?.major)}`);
  }
  if (payload.protocol?.minor !== SUPPORTED_PROTOCOL.minor) {
    diagnostics.push(`protocol.minor mismatch: got ${String(payload.protocol?.minor)}`);
  }
  const mandatory = payload.features?.mandatory;
  if (!Array.isArray(mandatory)) {
    diagnostics.push("features.mandatory must be an array.");
  } else {
    const seen = new Set();
    for (const feature of mandatory) {
      const name = feature?.name;
      seen.add(name);
      if (typeof name !== "string" || !SUPPORT_SET.has(name)) {
        diagnostics.push(`unknown mandatory feature: ${String(name)}`);
      } else if (feature.supported !== true) {
        diagnostics.push(`mandatory feature not supported: ${name}`);
      }
    }
    for (const required of SUPPORTED_MANDATORY_FEATURES) {
      if (!seen.has(required)) diagnostics.push(`missing mandatory feature: ${required}`);
    }
  }
  if (diagnostics.length) {
    return result({ state: "incompatible", version, contractCompatible: false, diagnostics, evidence });
  }
  return result({ state: "available", version, contractCompatible: true, evidence });
}

export async function probeGentle({
  env = process.env,
  cwd = process.cwd(),
  whichCommand = (cmd, e) => (isExecutableAvailable(cmd, { env: e }) ? cmd : ""),
  probeCommand = defaultProbeCommand
} = {}) {
  const path = whichCommand("gentle-ai", env) || null;
  if (!path) {
    return result({
      state: "missing",
      diagnostics: ["gentle-ai not found in PATH. Install Gentle AI separately, then re-run the probe."],
      evidence: [{ kind: "binary", path: null }]
    });
  }
  const evidence = [{ kind: "binary", path }];
  const versionResult = probeCommand(path, ["--version"], { cwd, env, timeoutMs: 5000 });
  const version = parseVersionFromOutput(`${versionResult.stdout}\n${versionResult.stderr}`);
  evidence.push({ kind: "version", version, ok: versionResult.ok });

  const capsResult = probeCommand(
    path,
    ["review", "capabilities", "--contract", SUPPORTED_CONTRACT],
    { cwd, env, timeoutMs: 8000 }
  );
  evidence.push({ kind: "capabilities", ok: capsResult.ok, status: capsResult.status });
  if (!capsResult.ok && !String(capsResult.stdout ?? "").trim()) {
    return result({
      state: "error", version, evidence,
      diagnostics: [capsResult.stderr || capsResult.error || "gentle-ai review capabilities failed"],
      error: capsResult.error ?? `exit ${capsResult.status}`
    });
  }
  let payload;
  try {
    payload = JSON.parse(String(capsResult.stdout ?? "").trim());
  } catch (err) {
    return result({
      state: "error", version, evidence, error: err?.message ?? String(err),
      diagnostics: ["Failed to parse capabilities JSON."]
    });
  }
  const evaluated = evaluateGentleCapabilities(payload);
  return result({
    ...evaluated,
    version: evaluated.version ?? version,
    evidence: [...evidence, ...(evaluated.evidence ?? [])]
  });
}

export function createGentleProbe(deps = {}) {
  return {
    id: "gentle",
    declaredEvents: Object.freeze([]),
    declaredActions: Object.freeze([]),
    async probe(context = {}) {
      return probeGentle({ ...deps, ...context, env: context.env ?? deps.env ?? process.env });
    }
  };
}
