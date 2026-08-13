import { isAbsolute } from "node:path";
import {
  isExecutableAvailable,
  parseVersionFromOutput,
  probeCommand as defaultProbeCommand
} from "../cli-probe.js";
import { normalizeProbeResult } from "./probe-contract.js";

export const SUPPORTED_PROTOCOL = Object.freeze({ major: 2, minor: 0 });
export const SUPPORTED_PROTOCOL_MINORS = Object.freeze([0, 1]);
export const SUPPORTED_SCHEMA = "gentle-ai.review-integration.capabilities/v2";
export const SUPPORTED_SCHEMA_V21 = "gentle-ai.review-integration.capabilities/v2.1";
export const SUPPORTED_CAPABILITY_SCHEMAS = Object.freeze([
  SUPPORTED_SCHEMA,
  SUPPORTED_SCHEMA_V21
]);
export const SUPPORTED_CONTRACT = "gentle-ai.review-integration/v2";
export const ADDITIVE_MINOR_POLICY = "optional-fields-only";
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

function defaultWhichAbsolute(command, env) {
  if (!isExecutableAvailable(command, { env })) return "";
  const which = defaultProbeCommand("which", [command], { env, timeoutMs: 3000 });
  const path = String(which.stdout ?? "").trim().split(/\r?\n/)[0] ?? "";
  return isAbsolute(path) ? path : "";
}

/** Resolve absolute Gentle binary; never return a bare command name. */
export function resolveGentleBinaryPath(command = "gentle-ai", env = process.env, {
  whichCommand = defaultWhichAbsolute
} = {}) {
  const resolved = whichCommand(command, env) || null;
  return resolved && isAbsolute(resolved) ? resolved : null;
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
  if (!SUPPORTED_CAPABILITY_SCHEMAS.includes(payload.schema)) {
    diagnostics.push(`schema mismatch: got ${String(payload.schema)}`);
  }
  if (payload.contract !== SUPPORTED_CONTRACT) {
    diagnostics.push(`contract mismatch: got ${String(payload.contract)}`);
  }
  if (payload.protocol?.major !== SUPPORTED_PROTOCOL.major) {
    diagnostics.push(`protocol.major mismatch: got ${String(payload.protocol?.major)}`);
  }
  if (!SUPPORTED_PROTOCOL_MINORS.includes(payload.protocol?.minor)) {
    diagnostics.push(`protocol.minor mismatch: got ${String(payload.protocol?.minor)}`);
  }
  const additivePolicy = payload.compatibility?.additive_minor_policy;
  if (additivePolicy != null && additivePolicy !== ADDITIVE_MINOR_POLICY) {
    diagnostics.push(`additive_minor_policy mismatch: got ${String(additivePolicy)}`);
  }
  if (typeof payload.bootstrap?.command === "string" && payload.bootstrap.command) {
    evidence.push({
      kind: "bootstrap",
      command: payload.bootstrap.command,
      required_feature: payload.bootstrap.required_feature ?? null
    });
  }
  const requiredFeature = payload.bootstrap?.required_feature;
  if (typeof requiredFeature === "string" && requiredFeature) {
    const named = [
      ...(Array.isArray(payload.features?.mandatory) ? payload.features.mandatory : []),
      ...(Array.isArray(payload.features?.optional) ? payload.features.optional : [])
    ];
    if (!named.some((feature) => feature?.name === requiredFeature && feature.supported === true)) {
      diagnostics.push(`bootstrap required_feature not supported: ${requiredFeature}`);
    }
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
  whichCommand = defaultWhichAbsolute,
  probeCommand = defaultProbeCommand
} = {}) {
  const path = resolveGentleBinaryPath("gentle-ai", env, { whichCommand });
  if (!path) {
    return result({
      state: "missing",
      diagnostics: [
        "gentle-ai absolute binary not resolved. Install Gentle AI separately, then re-run the probe."
      ],
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
  // Failed exit / timeout never promotes stdout into a negotiated capability.
  if (capsResult.timedOut || capsResult.status !== 0) {
    return result({
      state: "error", version, evidence,
      diagnostics: [
        capsResult.timedOut
          ? "gentle-ai review capabilities timed out"
          : "gentle-ai review capabilities failed"
      ],
      error: capsResult.error ?? (capsResult.timedOut ? "timeout" : `exit ${capsResult.status}`)
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
