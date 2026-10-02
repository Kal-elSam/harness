#!/usr/bin/env node
/**
 * Round 3 step 2 — sequential Claude entitlement probe latency measurement.
 * Limits (user-authorized): max 30 probes, concurrency 1, 2 full catalog passes.
 * Never Promise.all. Writes JSON evidence for ODD p50/p95.
 */
import { writeFileSync } from "node:fs";
import { readClaudeModels } from "../src/global/observability/claude-models.js";
import { probeClaudeModelEntitlement } from "../src/global/observability/claude-model-entitlement.js";

const MAX_PROBES = 30;
const PASSES = 2;
const outPath = process.argv[2] || "odd/evidence/claude-probe-latency-2026-10-02.json";

const catalog = readClaudeModels();
const modelIds = (catalog.models ?? []).map((m) => m.id).filter(Boolean);
if (modelIds.length === 0) {
  console.error("No Claude models in catalog — abort.");
  process.exit(1);
}

const startedAt = new Date().toISOString();
const samples = [];
let probeCount = 0;

console.log(`catalog=${modelIds.length} passes=${PASSES} max=${MAX_PROBES} concurrency=1`);
console.log(`models: ${modelIds.join(", ")}`);

for (let pass = 1; pass <= PASSES; pass += 1) {
  for (const modelId of modelIds) {
    if (probeCount >= MAX_PROBES) {
      console.log(`hit MAX_PROBES=${MAX_PROBES}; stopping`);
      break;
    }
    probeCount += 1;
    const t0 = Date.now();
    let result;
    try {
      result = await probeClaudeModelEntitlement({ modelId, timeoutMs: 30_000 });
    } catch (error) {
      result = {
        modelId,
        status: "unverified",
        reason: error?.message ?? String(error),
        probedAt: new Date().toISOString()
      };
    }
    const latencyMs = Date.now() - t0;
    const row = {
      pass,
      index: probeCount,
      modelId,
      latencyMs,
      status: result?.status ?? "unverified",
      limit: result?.limit ?? null,
      reason: result?.reason ?? null,
      probedAt: result?.probedAt ?? new Date().toISOString()
    };
    samples.push(row);
    console.log(
      `pass=${pass} #${probeCount} ${modelId} ${latencyMs}ms ${row.status}${row.limit ? `/${row.limit}` : ""}`
    );
  }
  if (probeCount >= MAX_PROBES) break;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function statsFor(rows) {
  const latencies = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    n: latencies.length,
    min: latencies[0] ?? null,
    max: latencies[latencies.length - 1] ?? null,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95)
  };
}

const byModel = {};
for (const id of modelIds) {
  byModel[id] = statsFor(samples.filter((s) => s.modelId === id));
}

const report = {
  startedAt,
  finishedAt: new Date().toISOString(),
  constraints: { maxProbes: MAX_PROBES, concurrency: 1, passes: PASSES, timeoutMs: 30_000 },
  catalogStatus: catalog.status ?? null,
  modelIds,
  probeCount,
  samples,
  overall: statsFor(samples),
  byModel
};

writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${outPath}`);
console.log("overall", report.overall);
console.log("byModel p50/p95:");
for (const [id, s] of Object.entries(byModel)) {
  console.log(`  ${id}: n=${s.n} p50=${s.p50} p95=${s.p95} max=${s.max}`);
}
