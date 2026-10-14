import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { evaluate, runEvaluation, checkClaims, makeClaims, writeDataset } from "../scripts/effort-eval/evaluate.mjs";

const fixture = [
  { id: "a", text: "a", language: "en", expected: "light", split: "dev", pair: "p" },
  { id: "b", text: "b", language: "en", expected: "heavy", split: "dev", pair: "p" },
  { id: "c", text: "c", language: "es", expected: "standard", split: "dev" },
  { id: "d", text: "d", language: "es", expected: "heavy", split: "test" },
  { id: "amb", text: "amb", language: "en" }
];
const hard = (text) => ({ a: "light", b: "standard", c: "standard", d: "heavy" })[text];
const options = { seed: 17, iterations: 200 };
async function scratch(fn) {
  const dir = mkdtempSync(join(tmpdir(), "effort-eval-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function paths(dir) {
  const datasetPath = join(dir, "cases.json");
  writeDataset({ clear: fixture, contrast: [], ambiguous: [] }, datasetPath);
  return { datasetPath, reportsDir: join(dir, "reports"), ledgerPath: join(dir, "ledger.json"), claimsPath: join(dir, "claims.json") };
}

test("public metrics: known accuracy, buckets, confusion, deterministic bootstrap and hard-label calibration", async () => {
  const r = await evaluate(fixture, { ...options, predictor: hard });
  assert.equal(r.n, 3);
  assert.equal(r.accuracy.overall.value, 2 / 3);
  assert.deepEqual(r.accuracy.perLanguage.en, { n: 2, value: 0.5 });
  assert.deepEqual(r.accuracy.perExpectedTier.heavy, { n: 1, value: 0 });
  assert.equal(r.confusionMatrix.heavy.standard, 1);
  assert.deepEqual(r.confidenceInterval, (await evaluate(fixture, { ...options, predictor: hard })).confidenceInterval);
  assert.ok(r.confidenceInterval.lower <= r.accuracy.overall.value);
  assert.ok(r.confidenceInterval.upper >= r.accuracy.overall.value);
  assert.equal(r.brier.value, null);
  assert.equal(r.ece.value, null);
  assert.equal(r.brier.reason, "predictor returns hard labels");
});

test("contrast separation requires different predictions in labelled direction, not exact labels", async () => {
  const r = await evaluate(fixture, { ...options, predictor: hard });
  assert.deepEqual(r.contrastSeparation, { n: 1, separated: 1, value: 1 });
  const reversed = await evaluate(fixture, { ...options, predictor: t => t === "a" ? "heavy" : "light" });
  assert.equal(reversed.contrastSeparation.value, 0);
  assert.equal((await evaluate(fixture, { ...options, predictor: () => "standard" })).contrastSeparation.value, 0);
});

test("probabilistic predictor has multiclass Brier and ten-bin top-label ECE", async () => {
  const r = await evaluate([{ ...fixture[0], pair: undefined }], { ...options, predictor: () => ({ probabilities: { light: 0.8, standard: 0.1, heavy: 0.1 } }) });
  assert.ok(Math.abs(r.brier.value - 0.06) < 1e-12);
  assert.ok(Math.abs(r.ece.value - 0.2) < 1e-12);
  await assert.rejects(evaluate(fixture, { predictor: () => ({ probabilities: { light: 2, heavy: -1, standard: 0 } }) }), /probabilities/);
});

test("test split requires explicit request and records every read before prediction", async () => scratch(async dir => {
  const p = paths(dir);
  await assert.rejects(runEvaluation({ ...p, split: "test", predictor: hard }), /explicit/);
  assert.equal(existsSync(p.ledgerPath), false);
  for (let i = 0; i < 2; i++) {
    const r = await runEvaluation({ ...p, split: "test", explicitTest: true, predictor: hard, commit: "abc", ...options });
    assert.equal(r.report.n, 1);
  }
  const ledger = JSON.parse(readFileSync(p.ledgerPath));
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].commit, "abc");
  assert.match(ledger[0].timestamp, /^\d{4}-/);
  assert.equal(ledger[0].reportPath, join(p.reportsDir, "test.json"));
  await assert.rejects(runEvaluation({ ...p, split: "test", explicitTest: true, predictor: () => { throw Error("failed predictor"); } }), /failed predictor/);
  assert.equal(JSON.parse(readFileSync(p.ledgerPath)).length, 3);
}));

test("CLI defaults to dev, writes traceable claims; explicit synthetic test records a read", () => scratch(dir => {
  const p = paths(dir);
  const args = ["scripts/effort-eval/evaluate.mjs", "--cases", p.datasetPath, "--reports-dir", p.reportsDir, "--ledger", p.ledgerPath, "--claims", p.claimsPath, "--iterations", "100", "--write-claims"];
  const dev = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(dev.status, 0, dev.stderr);
  assert.equal(JSON.parse(dev.stdout).split, "dev");
  assert.equal(existsSync(p.ledgerPath), false);
  assert.equal(JSON.parse(readFileSync(join(p.reportsDir, "dev.json"))).n, 3);
  const heldOut = spawnSync(process.execPath, [...args, "--split", "test"], { encoding: "utf8" });
  assert.equal(heldOut.status, 0, heldOut.stderr);
  assert.equal(JSON.parse(readFileSync(p.ledgerPath)).length, 1);
  const invalid = spawnSync(process.execPath, [...args, "--split", "all"], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
}));

test("claims resolve every numeric report field and detect altered values or commit", async () => scratch(async dir => {
  const p = paths(dir);
  const { report, reportPath } = await runEvaluation({ ...p, predictor: hard, writeClaims: true, ...options });
  const claims = JSON.parse(readFileSync(p.claimsPath));
  assert.deepEqual(claims, makeClaims(report, reportPath));
  assert.equal(checkClaims(claims).ok, true);
  assert.ok(claims.some(c => c.fieldPath === "accuracy.overall.value"));
  claims[0].value += 1;
  assert.equal(checkClaims(claims).ok, false);
  claims[0].value -= 1;
  claims[0].commit = "wrong";
  assert.equal(checkClaims(claims).ok, false);
}));

test("dev loads only indexed dev bytes, never parses held-out records", async () => scratch(async dir => {
  const p = paths(dir);
  const text = readFileSync(p.datasetPath, "utf8");
  writeFileSync(p.datasetPath, text.replace('"text": "d"', '"text": xxx'));
  const { report } = await runEvaluation({ ...p, predictor: hard, ...options });
  assert.equal(report.n, 3);
  assert.equal(existsSync(p.ledgerPath), false);
  await assert.rejects(runEvaluation({ ...p, split: "test", explicitTest: true, predictor: hard }), /index|JSON/);
  assert.equal(JSON.parse(readFileSync(p.ledgerPath)).length, 1);
}));

test("dataset authoring supports original clear/ambiguous/contrast property order", async () => scratch(async dir => {
  const p = paths(dir);
  writeDataset({ clear: fixture.slice(2, 4), ambiguous: [fixture[4]], contrast: fixture.slice(0, 2) }, p.datasetPath);
  assert.equal((await runEvaluation({ ...p, predictor: hard, ...options })).report.n, 3);
}));

test("locked dataset retains 18 clear, 8 contrast, five unlabeled, unique IDs and stratified splits", () => {
  const d = JSON.parse(readFileSync(new URL("../scripts/effort-eval/cases.json", import.meta.url)));
  assert.match(d.description, /PROVISIONAL/);
  assert.equal(d.clear.length, 18);
  assert.equal(d.contrast.length, 8);
  assert.equal(d.ambiguous.length, 5);
  const all = [...d.clear, ...d.contrast, ...d.ambiguous];
  assert.equal(new Set(all.map(c => c.id)).size, all.length);
  assert.ok(d.ambiguous.every(c => !Object.hasOwn(c, "expected")));
  const pairs = new Map();
  for (const c of [...d.clear, ...d.contrast]) {
    assert.ok(["dev", "test"].includes(c.split));
    if (c.pair) { const p = pairs.get(c.pair) ?? []; p.push(c); pairs.set(c.pair, p); }
  }
  for (const p of pairs.values()) { assert.equal(p.length, 2); assert.equal(p[0].split, p[1].split); }
  for (const language of ["en", "es"]) for (const expected of ["light", "standard", "heavy"]) {
    assert.deepEqual(new Set(d.clear.filter(c => c.language === language && c.expected === expected).map(c => c.split)), new Set(["dev", "test"]));
  }
});
