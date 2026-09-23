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
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyTask } from "../../src/global/intelligence/execution-router.js";
import { groupByPair } from "./evaluate.mjs";

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
 * @param {{clear: {rows: object[]}, contrast?: {rows: object[]}}} report
 * @param {{thresholds?: number[]}} [options]
 */
export function simulateHybrid(report, { thresholds = DEFAULT_THRESHOLDS } = {}) {
  const clearRows = report.clear.rows.filter((row) => row.expected);
  const contrastRows = (report.contrast?.rows ?? []).filter((row) => row.expected);
  const policies = [
    { name: "local", tierOf: (row) => row.local },
    { name: "jev", tierOf: (row) => row.jev },
    ...thresholds.map((threshold) => ({ name: `hybrid@${threshold}`, tierOf: (row) => hybridTier(row, threshold) })),
  ];
  return {
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
  const reportPath = process.argv[2];
  if (!reportPath) throw new Error("Usage: simulate-hybrid.mjs <report.json>");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const result = { source: reportPath, generatedAt: report.generatedAt ?? null, ...simulateHybrid(report) };
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
