import { normalizeProbeResult } from "./probe-contract.js";
import { listObservabilityProbes } from "./probe-registry.js";

/** Parallel soft snapshot — never throws for individual probe failures. */
export async function buildObservabilitySnapshot(context = {}) {
  const registered = listObservabilityProbes();
  const settled = await Promise.allSettled(
    registered.map(async (probe) => normalizeProbeResult(await probe.probe(context), probe.id))
  );
  const probes = settled.map((entry, i) => {
    const id = registered[i].id;
    if (entry.status === "fulfilled") return entry.value;
    return normalizeProbeResult({
      id,
      state: "error",
      error: entry.reason?.message ?? String(entry.reason ?? "probe failed")
    }, id);
  });
  return {
    generatedAt: new Date().toISOString(),
    probes,
    byId: Object.fromEntries(probes.map((p) => [p.id, p]))
  };
}
