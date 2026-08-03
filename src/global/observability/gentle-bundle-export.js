import { probeCommand as defaultProbeCommand } from "../cli-probe.js";
import { probeGentle as defaultProbeGentle } from "./gentle-probe.js";

const EXPORT_TIMEOUT_MS = 60_000;

function binaryFromProbe(probe) {
  const hit = (probe?.evidence ?? []).find((e) => e.kind === "binary" && e.path);
  return hit?.path ?? "gentle-ai";
}

function fail(code, diagnostics, extra = {}) {
  return {
    ok: false,
    exitCode: 2,
    code,
    diagnostics: diagnostics.map(String),
    providerStatus: null,
    providerStderr: null,
    ...extra
  };
}

/**
 * Transport-only export: invoke Gentle review-bundle-export.
 * Never reads, parses, or rewrites the bundle at --out.
 */
export async function exportGentleReviewBundle({
  lineage,
  outPath,
  cwd = process.cwd(),
  env = process.env,
  probeGentle = defaultProbeGentle,
  probeCommand = defaultProbeCommand
} = {}) {
  if (typeof lineage !== "string" || !lineage.trim()) {
    return fail("invalid_request", ["Missing lineage id."], { lineage: lineage ?? null, outPath: outPath ?? null });
  }
  if (typeof outPath !== "string" || !outPath.trim()) {
    return fail("invalid_request", ["Missing --out path."], { lineage, outPath: outPath ?? null });
  }

  const probe = await probeGentle({ cwd, env });
  if (probe.state !== "available") {
    const code = probe.state === "missing" || probe.state === "incompatible" || probe.state === "error"
      ? `gentle_${probe.state}`
      : "gentle_error";
    return fail(code, probe.diagnostics?.length ? probe.diagnostics : [`Gentle probe state: ${probe.state}`], {
      lineage,
      outPath,
      probe
    });
  }

  const binary = binaryFromProbe(probe);
  const args = [
    "review-bundle-export",
    "--cwd", cwd,
    "--lineage", lineage,
    "--out", outPath
  ];
  const provider = probeCommand(binary, args, { cwd, env, timeoutMs: EXPORT_TIMEOUT_MS });

  if (!provider.ok) {
    const detail = provider.stderr || provider.error || `exit ${provider.status}`;
    return fail("provider_error", [detail], {
      lineage,
      outPath,
      probe,
      providerStatus: provider.status,
      providerStderr: provider.stderr || null,
      timedOut: provider.timedOut ?? false
    });
  }

  return {
    ok: true,
    exitCode: 0,
    code: "exported",
    lineage,
    outPath,
    diagnostics: [],
    providerStatus: provider.status,
    providerStderr: null,
    probe
  };
}
