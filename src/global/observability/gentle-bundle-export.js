import { isAbsolute } from "node:path";
import { probeCommand as defaultProbeCommand } from "../cli-probe.js";
import { probeGentle as defaultProbeGentle } from "./gentle-probe.js";

const EXPORT_TIMEOUT_MS = 60_000;

/** Require negotiated absolute binary evidence — never fall back to PATH names. */
export function resolveNegotiatedGentleBinary(probe) {
  const path = (probe?.evidence ?? []).find((e) => e.kind === "binary")?.path ?? null;
  return typeof path === "string" && path && isAbsolute(path) ? path : null;
}

function fail(code, diagnostics, extra = {}) {
  return {
    ok: false, exitCode: 2, code,
    diagnostics: diagnostics.map(String),
    providerStatus: null, timedOut: false, ...extra
  };
}

/**
 * Transport-only export: invoke Gentle review-bundle-export.
 * Never reads/rewrites bundle bytes; never surfaces raw provider stderr.
 */
export async function exportGentleReviewBundle({
  lineage, outPath, cwd = process.cwd(), env = process.env,
  probeGentle = defaultProbeGentle, probeCommand = defaultProbeCommand
} = {}) {
  if (typeof lineage !== "string" || !lineage.trim()) {
    return fail("invalid_request", ["Missing lineage id."], { lineage: lineage ?? null, outPath: outPath ?? null });
  }
  if (typeof outPath !== "string" || !outPath.trim()) {
    return fail("invalid_request", ["Missing --out path."], { lineage, outPath: outPath ?? null });
  }

  const probe = await probeGentle({ cwd, env });
  if (probe.state !== "available") {
    const code = ["missing", "incompatible", "error"].includes(probe.state)
      ? `gentle_${probe.state}` : "gentle_error";
    return fail(code, probe.diagnostics?.length ? probe.diagnostics : [`Gentle probe state: ${probe.state}`], {
      lineage, outPath
    });
  }

  const binary = resolveNegotiatedGentleBinary(probe);
  if (!binary) {
    return fail("gentle_binary_unbound", [
      "Negotiated Gentle binary evidence missing or not absolute; refusing PATH fallback."
    ], { lineage, outPath });
  }

  const provider = probeCommand(binary, [
    "review-bundle-export", "--cwd", cwd, "--lineage", lineage, "--out", outPath
  ], { cwd, env, timeoutMs: EXPORT_TIMEOUT_MS });

  if (!provider.ok) {
    const diagnostics = ["provider_error"];
    if (provider.timedOut) diagnostics.push("timed_out");
    if (provider.status != null) diagnostics.push(`status=${provider.status}`);
    return fail("provider_error", diagnostics, {
      lineage, outPath,
      providerStatus: provider.status ?? null,
      timedOut: Boolean(provider.timedOut)
    });
  }

  return {
    ok: true, exitCode: 0, code: "exported", lineage, outPath,
    diagnostics: [], providerStatus: provider.status, timedOut: false, binary
  };
}
