import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { classifyEffort } from "../../src/global/intelligence/execution-router.js";

export const TIERS = ["light", "standard", "heavy"];
export const DEFAULT_SEED = 20261014;
const ROOT = "scripts/effort-eval";
const bucket = rows => ({ n: rows.length, value: rows.length ? rows.filter(r => r.correct).length / rows.length : null });
const readJSON = path => JSON.parse(readFileSync(path, "utf8"));
function writeJSON(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
/** Authoring helper: write the locked manifest and byte index together.
 * Do not use this to rebuild the split after observing predictions.
 */
export function writeDataset(dataset, path) {
  const source = `${JSON.stringify(dataset, null, 2)}\n`;
  const index = { labelNote: dataset.description ?? "PROVISIONAL fixture labels", dev: [], test: [] };
  let cursor = 0;
  for (const group of Object.keys(dataset).filter(key => ["clear", "contrast", "ambiguous"].includes(key))) for (const c of dataset[group]) {
    const serialized = JSON.stringify(c, null, 2).split("\n").map((line, i) => i ? `    ${line}` : line).join("\n");
    const start = source.indexOf(serialized, cursor);
    if (start < 0) throw Error("cannot index case");
    cursor = start + serialized.length;
    if (!Object.hasOwn(c, "expected")) continue;
    if (!["dev", "test"].includes(c.split)) throw Error("labelled cases require a split");
    index[c.split].push({ offset: Buffer.byteLength(source.slice(0, start)), length: Buffer.byteLength(serialized), sha256: digest(serialized) });
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
  writeJSON(`${path}.index.json`, index);
}
function readSplit(path, split) {
  const index = readJSON(`${path}.index.json`);
  const fd = openSync(path, "r"), cases = [];
  try {
    for (const span of index[split]) {
      if (!Number.isSafeInteger(span.offset) || span.offset < 0 || !Number.isSafeInteger(span.length) || span.length < 1) throw Error("invalid dataset index span");
      const bytes = Buffer.alloc(span.length);
      let count = 0;
      while (count < bytes.length) {
        const n = readSync(fd, bytes, count, bytes.length - count, span.offset + count);
        if (!n) throw Error("dataset index is stale: truncated case");
        count += n;
      }
      if (digest(bytes) !== span.sha256) throw Error("dataset index is stale: case hash mismatch");
      const c = JSON.parse(bytes.toString("utf8"));
      if (c.split !== split || !Object.hasOwn(c, "expected")) throw Error("dataset index split mismatch");
      cases.push(c);
    }
  } finally { closeSync(fd); }
  return { cases, labelNote: index.labelNote };
}
function validateSplit(split, explicitTest) {
  if (!["dev", "test"].includes(split)) throw Error("split must be dev or test");
  if (split === "test" && !explicitTest) throw Error("test split requires an explicit request");
}
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bootstrap(rows, seed, iterations) {
  const rng = random(seed), samples = [];
  for (let i = 0; rows.length && i < iterations; i++) {
    let correct = 0;
    for (let j = 0; j < rows.length; j++) correct += Number(rows[Math.floor(rng() * rows.length)].correct);
    samples.push(correct / rows.length);
  }
  samples.sort((a, b) => a - b);
  return {
    lower: samples.length ? samples[Math.floor((samples.length - 1) * 0.025)] : null,
    upper: samples.length ? samples[Math.ceil((samples.length - 1) * 0.975)] : null,
    level: 0.95, seed, iterations, method: "record-level percentile bootstrap"
  };
}
function prediction(result) {
  if (typeof result === "string" && TIERS.includes(result)) return { predicted: result, probabilities: null };
  const probabilities = result?.probabilities;
  if (!probabilities || Object.keys(probabilities).length !== TIERS.length ||
      TIERS.some(t => !Number.isFinite(probabilities[t]) || probabilities[t] < 0 || probabilities[t] > 1) ||
      Math.abs(TIERS.reduce((sum, t) => sum + probabilities[t], 0) - 1) > 1e-9) {
    throw Error("predictor must return a tier or normalized probabilities for light, standard, heavy");
  }
  const predicted = TIERS.reduce((best, t) => probabilities[t] > probabilities[best] ? t : best);
  return { predicted, probabilities };
}
function calibration(rows) {
  if (!rows.length || rows.some(r => !r.probabilities)) {
    const reason = !rows.length ? "no scored records" : rows.every(r => !r.probabilities) ? "predictor returns hard labels" : "not every prediction returns probabilities";
    return { brier: { value: null, reason }, ece: { value: null, reason } };
  }
  const brier = rows.reduce((sum, r) => sum + TIERS.reduce((s, t) => s + (r.probabilities[t] - Number(t === r.expected)) ** 2, 0), 0) / rows.length;
  const bins = Array.from({ length: 10 }, () => []);
  for (const r of rows) bins[Math.min(9, Math.floor(r.probabilities[r.predicted] * 10))].push(r);
  const ece = bins.reduce((sum, bin) => {
    if (!bin.length) return sum;
    const confidence = bin.reduce((s, r) => s + r.probabilities[r.predicted], 0) / bin.length;
    return sum + bin.length / rows.length * Math.abs(bucket(bin).value - confidence);
  }, 0);
  return { brier: { value: brier, reason: null }, ece: { value: ece, reason: null, bins: 10 } };
}

/** Pure scoring API. Test selection still requires explicitTest; no file access. */
export async function evaluate(cases, { predictor = classifyEffort, split = "dev", explicitTest = false, seed = DEFAULT_SEED, iterations = 2000 } = {}) {
  validateSplit(split, explicitTest);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw Error("seed must be a uint32");
  if (!Number.isInteger(iterations) || iterations < 1) throw Error("iterations must be a positive integer");
  const rows = [];
  for (const c of cases) {
    if (!Object.hasOwn(c, "expected") || c.split !== split) continue;
    if (!TIERS.includes(c.expected)) throw Error(`invalid expected tier: ${c.id}`);
    const p = prediction(await predictor(c.text, c));
    rows.push({ ...c, ...p, correct: p.predicted === c.expected });
  }
  const confusionMatrix = Object.fromEntries(TIERS.map(t => [t, Object.fromEntries(TIERS.map(p => [p, 0]))]));
  for (const r of rows) confusionMatrix[r.expected][r.predicted]++;
  const pairs = new Map();
  for (const r of rows.filter(r => r.pair)) {
    const pair = pairs.get(r.pair) ?? [];
    pair.push(r); pairs.set(r.pair, pair);
  }
  let separated = 0;
  for (const pair of pairs.values()) {
    if (pair.length !== 2 || pair[0].expected === pair[1].expected) throw Error("contrast pairs require two different labelled tiers in one split");
    pair.sort((a, b) => TIERS.indexOf(a.expected) - TIERS.indexOf(b.expected));
    if (TIERS.indexOf(pair[0].predicted) < TIERS.indexOf(pair[1].predicted)) separated++;
  }
  return {
    split, n: rows.length,
    accuracy: {
      overall: bucket(rows),
      perLanguage: Object.fromEntries([...new Set(rows.map(r => r.language))].sort().map(language => [language, bucket(rows.filter(r => r.language === language))])),
      perExpectedTier: Object.fromEntries(TIERS.map(t => [t, bucket(rows.filter(r => r.expected === t))]))
    },
    confusionMatrix, confidenceInterval: bootstrap(rows, seed, iterations),
    contrastSeparation: { n: pairs.size, separated, value: pairs.size ? separated / pairs.size : null },
    ...calibration(rows), records: rows
  };
}

/** Includes every numeric report field, not only selected headline metrics. */
export function makeClaims(report, reportPath) {
  const claims = [];
  function visit(value, fieldPath) {
    if (typeof value === "number") claims.push({ value, reportPath, fieldPath, commit: report.commit });
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) visit(child, fieldPath ? `${fieldPath}.${key}` : key);
  }
  visit(report, "");
  return claims;
}
export function checkClaims(claims) {
  const errors = [], reports = new Map();
  for (const claim of claims) {
    try {
      if (!reports.has(claim.reportPath)) reports.set(claim.reportPath, readJSON(claim.reportPath));
      const report = reports.get(claim.reportPath);
      const actual = claim.fieldPath.split(".").reduce((value, key) => value?.[key], report);
      if (typeof actual !== "number" || actual !== claim.value || claim.commit !== report.commit) errors.push(claim.fieldPath);
    } catch (error) { errors.push(`${claim.fieldPath}: ${error.message}`); }
  }
  return { ok: errors.length === 0, errors };
}

/** Test-read ledger is written before opening the dataset, even if scoring fails.
 * The byte index lets dev read only dev records from the combined manifest.
 */
export async function runEvaluation({ datasetPath = `${ROOT}/cases.json`, reportsDir = `${ROOT}/reports`, ledgerPath = `${ROOT}/test-reads.json`, claimsPath = `${ROOT}/claims.json`, split = "dev", explicitTest = false, writeClaims = false, commit, ...options } = {}) {
  validateSplit(split, explicitTest);
  commit ??= execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const reportPath = `${reportsDir}/${split}.json`;
  if (split === "test") {
    const ledger = existsSync(ledgerPath) ? readJSON(ledgerPath) : [];
    ledger.push({ timestamp: new Date().toISOString(), commit, reportPath });
    writeJSON(ledgerPath, ledger);
  }
  const { cases, labelNote } = readSplit(datasetPath, split);
  const report = { commit, datasetPath, labelNote, ...await evaluate(cases, { ...options, split, explicitTest }) };
  writeJSON(reportPath, report);
  if (writeClaims) writeJSON(claimsPath, makeClaims(report, reportPath));
  return { report, reportPath };
}

export async function main(argv = process.argv.slice(2)) {
  const help = "Usage: node scripts/effort-eval/evaluate.mjs [--split dev|test] [--seed UINT32] [--iterations N] [--write-claims] [--check-claims] [--cases PATH] [--reports-dir PATH] [--ledger PATH] [--claims PATH]\nDefault: dev, seed 20261014, 2000 iterations. Explicit --split test logs every read. --check-claims only checks claims; it does not read the dataset.";
  const options = {};
  const flags = { "--split": "split", "--seed": "seed", "--iterations": "iterations", "--cases": "datasetPath", "--reports-dir": "reportsDir", "--ledger": "ledgerPath", "--claims": "claimsPath" };
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help") { console.log(help); return; }
    if (arg === "--write-claims") { options.writeClaims = true; continue; }
    if (arg === "--check-claims") { check = true; continue; }
    if (!flags[arg] || !argv[i + 1] || argv[i + 1].startsWith("--")) throw Error(`unknown or incomplete option: ${arg}`);
    const value = argv[++i];
    options[flags[arg]] = ["--seed", "--iterations"].includes(arg) ? Number(value) : value;
    if (arg === "--split") options.explicitTest = value === "test";
  }
  if (check) {
    const result = checkClaims(readJSON(options.claimsPath ?? `${ROOT}/claims.json`));
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const { report, reportPath } = await runEvaluation(options);
  console.log(JSON.stringify({ split: report.split, reportPath, n: report.n, accuracy: report.accuracy, confidenceInterval: report.confidenceInterval, contrastSeparation: report.contrastSeparation, brier: report.brier, ece: report.ece }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
