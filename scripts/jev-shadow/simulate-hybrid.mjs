#!/usr/bin/env node
// Offline hybrid-policy simulator over an existing evaluate.mjs report.
// Makes NO network calls and changes NO routing — it only replays the tiers
// already recorded in a report under a candidate policy:
//
//   1. a local RISK keyword (execution-router RISK_KEYWORDS) floors to heavy;
//   2. otherwise Jev decides, but only at or above a confidence threshold;
//   3. otherwise (low confidence, failed or confidence-less answer) standard.
//
// Every threshold is reported side by side and none is selected: the
// thresholds would be tuned on the same cases they are measured on.
//
// The report's `local` tiers are historical, but the risk floor is recomputed
// with the CURRENT router. The report's routerSha256 must match the current
// router file, or the simulation refuses to run (--allow-router-mismatch
// proceeds and marks the result routerVerified: false).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyTask } from "../../src/global/intelligence/execution-router.js";
import { groupByPair } from "./evaluate.mjs";
import { ROUTER_PATH, sha256File } from "./provenance.mjs";

const DEFAULT_THRESHOLDS = [0.3, 0.4, 0.5, 0.55, 0.6, 0.7, 0.8];

/**
 * @param {{text: string, jev: string|null, confidence: number|null}} row
 * @param {number} threshold
 * @returns {"light"|"standard"|"heavy"}
 */
export function hybridTier(row, threshold) {
  if (classifyTask(row.text).riskScore > 0) return "heavy";
  if (row.jev && typeof row.confidence === "number" && row.confidence >= threshold) return row.jev;
  return "standard";
}

/**
 * @param {{clear: {rows: object[]}, contrast?: {rows: object[]}, provenance?: {routerSha256?: string}}} report
 * @param {{thresholds?: number[], currentRouterSha256: string, allowRouterMismatch?: boolean}} options
 */
export function simulateHybrid(report, { thresholds = DEFAULT_THRESHOLDS, currentRouterSha256, allowRouterMismatch = false } = {}) {
  const routerNote = routerMismatch(report, currentRouterSha256);
  if (routerNote && !allowRouterMismatch) {
    throw new Error(`${routerNote} Re-run the evaluation, or pass --allow-router-mismatch to simulate anyway (marked unverified).`);
  }
  // Same fairness rule as evaluate.mjs: a failed Jev answer (e.g. a 429) is
  // missing evidence, not a classification. Every policy is scored over the
  // same answered rows and the same complete pairs; failures are listed apart.
  const labeledClear = report.clear.rows.filter((row) => row.expected);
  const labeledContrast = (report.contrast?.rows ?? []).filter((row) => row.expected);
  const clearRows = labeledClear.filter((row) => row.jev !== null);
  const pairGroups = [...groupByPair(labeledContrast)];
  const completePairs = pairGroups.filter(([, pairRows]) => pairRows.every((row) => row.jev !== null));
  const contrastRows = completePairs.flatMap(([, pairRows]) => pairRows);
  const excluded = {
    jevFailureIds: [...labeledClear, ...labeledContrast].filter((row) => row.jev === null).map((row) => row.id),
    unscoredPairs: pairGroups.filter(([, pairRows]) => pairRows.some((row) => row.jev === null)).map(([pair]) => pair),
  };
  const policies = [
    { name: "local", tierOf: (row) => row.local },
    { name: "jev", tierOf: (row) => row.jev },
    ...thresholds.map((threshold) => ({ name: `hybrid@${threshold}`, tierOf: (row) => hybridTier(row, threshold) })),
  ];
  return {
    routerVerified: routerNote === null,
    ...(routerNote ? { routerNote } : {}),
    excluded,
    note: "Candidate policies side by side. This simulation does not select a threshold: choosing one on these same cases would overfit them.",
    policies: policies.map(({ name, tierOf }) => ({
      name,
      clear: score(clearRows, tierOf),
      contrast: { ...score(contrastRows, tierOf), ...pairSeparation(contrastRows, tierOf) },
      downgradedHeavy: [...clearRows, ...contrastRows]
        .filter((row) => row.expected === "heavy" && tierOf(row) !== "heavy")
        .map((row) => row.id),
    })),
  };
}

function routerMismatch(report, currentRouterSha256) {
  if (!currentRouterSha256) throw new Error("A current router hash is required to check the report's provenance.");
  const reportSha = report.provenance?.routerSha256;
  if (!reportSha) return "Report has no router provenance: its local tiers may come from a different router.";
  if (reportSha !== currentRouterSha256) {
    return `Report router ${reportSha.slice(0, 12)} differs from current router ${currentRouterSha256.slice(0, 12)}.`;
  }
  return null;
}

function score(rows, tierOf) {
  return { correct: rows.filter((row) => tierOf(row) === row.expected).length, total: rows.length };
}

// A pair is separated only when BOTH of its cases get their expected tier.
function pairSeparation(rows, tierOf) {
  const pairs = [...groupByPair(rows).values()];
  return {
    pairsSeparated: pairs.filter((pairRows) => pairRows.every((row) => tierOf(row) === row.expected)).length,
    pairs: pairs.length,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const reportPath = argv.find((arg) => !arg.startsWith("--"));
  if (!reportPath) throw new Error("Usage: simulate-hybrid.mjs <report.json> [--allow-router-mismatch]");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const simulation = simulateHybrid(report, {
    currentRouterSha256: await sha256File(ROUTER_PATH),
    allowRouterMismatch: argv.includes("--allow-router-mismatch"),
  });
  const result = {
    source: reportPath,
    generatedAt: report.generatedAt ?? null,
    provenance: report.provenance ?? null,
    ...simulation,
  };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
