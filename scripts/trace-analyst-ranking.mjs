#!/usr/bin/env node
// Explains the analyst picker ranking for a CONTROLLED catalog (no provider
// calls, no probes). Benchmarks come from the local Artificial Analysis cache
// the real product also reads (read-only): `--aa <file>` overrides
// ~/.harness/model-intelligence.json. Nothing is invented: a model id with no
// AA match is reported unscored.
//
//   node scripts/trace-analyst-ranking.mjs [--aa file] [--json]

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONTROLLED_TRACE_CATALOG, formatAnalystTrace, traceAnalystRanking } from "../src/global/conversation/analyst-ranking-trace.js";

const args = process.argv.slice(2);
const aaIndex = args.indexOf("--aa");
const aaPath = aaIndex >= 0 ? args[aaIndex + 1] : join(homedir(), ".harness", "model-intelligence.json");
const aaModels = JSON.parse(readFileSync(aaPath, "utf8")).models;

const trace = traceAnalystRanking({ ...CONTROLLED_TRACE_CATALOG, aaModels });
if (args.includes("--json")) console.log(JSON.stringify(trace.rows, null, 2));
else console.log(formatAnalystTrace(trace));
