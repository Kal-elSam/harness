import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdtemp, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hybridTier, simulateHybrid } from "../scripts/jev-shadow/simulate-hybrid.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "scripts", "jev-shadow", "simulate-hybrid.mjs");
const ROUTER_PATH = path.join(HERE, "..", "src", "global", "intelligence", "execution-router.js");
const execFileAsync = promisify(execFile);

const row = (overrides) => ({ id: "r", text: "Add a field", local: "light", jev: "light", confidence: 0.9, ...overrides });

test("hybrid policy: risk keyword floors to heavy, confident Jev decides, otherwise standard", () => {
  // Local risk keyword wins even over a confident Jev answer.
  assert.equal(hybridTier(row({ text: "Store the payment token", jev: "light", confidence: 0.99 }), 0.5), "heavy");
  // No risk keyword: Jev decides only at or above the threshold.
  assert.equal(hybridTier(row({ jev: "light", confidence: 0.5 }), 0.5), "light");
  assert.equal(hybridTier(row({ jev: "light", confidence: 0.49 }), 0.5), "standard");
  // A failed or confidence-less Jev answer falls back to standard, never a guess.
  assert.equal(hybridTier(row({ jev: null, confidence: null }), 0.5), "standard");
  assert.equal(hybridTier(row({ jev: "heavy", confidence: null }), 0.5), "standard");
});

const ROUTER_SHA = "a".repeat(64);

const report = {
  provenance: { routerSha256: ROUTER_SHA },
  clear: {
    rows: [
      { id: "c-light", text: "Fix a typo", expected: "light", local: "light", jev: "light", confidence: 0.95 },
      { id: "c-heavy-risk", text: "Rotate the production credential", expected: "heavy", local: "heavy", jev: "standard", confidence: 0.9 },
      { id: "c-heavy-silent", text: "Store the recovery code", expected: "heavy", local: "light", jev: "standard", confidence: 0.8 },
      { id: "c-standard-unsure", text: "Add a settings page", expected: "standard", local: "light", jev: "light", confidence: 0.3 },
    ],
  },
  ambiguous: { rows: [{ id: "a1", text: "Refactor it", local: "heavy", jev: "standard", confidence: 0.9 }] },
  contrast: {
    rows: [
      { id: "p1-light", pair: "p1", text: "Copy given pairs", expected: "light", local: "standard", jev: "light", confidence: 0.99 },
      { id: "p1-standard", pair: "p1", text: "Read tags then copy", expected: "standard", local: "standard", jev: "standard", confidence: 0.47 },
      { id: "p2-standard", pair: "p2", text: "Store display name", expected: "standard", local: "standard", jev: "standard", confidence: 0.77 },
      { id: "p2-heavy", pair: "p2", text: "Store recovery code", expected: "heavy", local: "standard", jev: "standard", confidence: 0.76 },
    ],
  },
};

test("simulation reports hits, separated pairs, and downgraded heavy cases per policy", () => {
  const result = simulateHybrid(report, { thresholds: [0.5], currentRouterSha256: ROUTER_SHA });
  const byName = Object.fromEntries(result.policies.map((policy) => [policy.name, policy]));
  assert.deepEqual(Object.keys(byName), ["local", "jev", "hybrid@0.5"]);

  const hybrid = byName["hybrid@0.5"];
  // c-light: jev light 0.95 ✓ · c-heavy-risk: floor heavy ✓ · c-heavy-silent: jev standard ✗
  // c-standard-unsure: 0.3 < 0.5 -> standard ✓
  assert.deepEqual(hybrid.clear, { correct: 3, total: 4 });
  // p1: light ✓ + standard (0.47 < 0.5 -> fallback standard) ✓ · p2: heavy case -> standard ✗
  assert.deepEqual(hybrid.contrast, { correct: 3, total: 4, pairsSeparated: 1, pairs: 2 });
  assert.deepEqual(hybrid.downgradedHeavy, ["c-heavy-silent", "p2-heavy"]);

  assert.deepEqual(byName.local.clear, { correct: 2, total: 4 });
  assert.deepEqual(byName.local.downgradedHeavy, ["c-heavy-silent", "p2-heavy"]);
  assert.deepEqual(byName.jev.downgradedHeavy, ["c-heavy-risk", "c-heavy-silent", "p2-heavy"]);
});

test("simulation never picks a winning threshold from the data it was measured on", () => {
  const result = simulateHybrid(report, { thresholds: [0.3, 0.5, 0.8], currentRouterSha256: ROUTER_SHA });
  assert.deepEqual(result.policies.map((policy) => policy.name), ["local", "jev", "hybrid@0.3", "hybrid@0.5", "hybrid@0.8"]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /"(best|winner|recommended|selected)/i);
  assert.match(result.note, /not select/i);
  // Ambiguous rows have no label and never enter any metric.
  assert.ok(!serialized.includes('"a1"'));
});

test("simulation refuses to mix a report's stored local tiers with a different current router", () => {
  const other = "b".repeat(64);
  assert.throws(() => simulateHybrid(report, { currentRouterSha256: other }), /router.*aaaaaaaaaaaa.*bbbbbbbbbbbb/i);
  const { provenance, ...legacy } = report;
  assert.throws(() => simulateHybrid(legacy, { currentRouterSha256: ROUTER_SHA }), /no router provenance/i);
  assert.throws(() => simulateHybrid(report, {}), /current router hash is required/i);

  // Explicit opt-in proceeds, but the result says so — never a silent mix.
  const mixed = simulateHybrid(legacy, { currentRouterSha256: ROUTER_SHA, allowRouterMismatch: true });
  assert.equal(mixed.routerVerified, false);
  assert.match(mixed.routerNote, /no router provenance/i);
  const verified = simulateHybrid(report, { currentRouterSha256: ROUTER_SHA });
  assert.equal(verified.routerVerified, true);
});

test("CLI checks the report's router hash against the real router file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jev-hybrid-"));
  const reportPath = path.join(dir, "report.json");
  const realSha = createHash("sha256").update(await readFile(ROUTER_PATH)).digest("hex");
  await writeFile(reportPath, JSON.stringify({ ...report, provenance: { routerSha256: realSha } }));
  const { stdout } = await execFileAsync("node", [CLI, reportPath]);
  const result = JSON.parse(stdout);
  assert.ok(result.policies.some((policy) => policy.name.startsWith("hybrid@")));
  assert.equal(result.source, reportPath);
  assert.equal(result.routerVerified, true);

  const legacyPath = path.join(dir, "legacy.json");
  const { provenance, ...legacy } = report;
  await writeFile(legacyPath, JSON.stringify(legacy));
  await assert.rejects(execFileAsync("node", [CLI, legacyPath]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /no router provenance/i);
    assert.match(error.stderr, /--allow-router-mismatch/);
    return true;
  });
  const { stdout: mixedOut } = await execFileAsync("node", [CLI, legacyPath, "--allow-router-mismatch"]);
  assert.equal(JSON.parse(mixedOut).routerVerified, false);
});

test("REGRESSION: a failed Jev row (e.g. 429) is missing evidence — excluded for every policy, pair unscored", () => {
  const withFailure = {
    ...report,
    clear: {
      rows: [
        ...report.clear.rows,
        { id: "c-failed", text: "Rotate the production credential", expected: "heavy", local: "heavy", jev: null, confidence: null },
      ],
    },
    contrast: {
      rows: report.contrast.rows.map((row) =>
        row.id === "p2-heavy" ? { ...row, text: "Store the payment token", local: "heavy", jev: null, confidence: null } : row
      ),
    },
  };
  const result = simulateHybrid(withFailure, { thresholds: [0.5], currentRouterSha256: ROUTER_SHA });
  for (const policy of result.policies) {
    // Same scored rows and the same complete pairs for local, jev, and hybrid.
    assert.equal(policy.clear.total, 4, policy.name);
    assert.deepEqual({ total: policy.contrast.total, pairs: policy.contrast.pairs }, { total: 2, pairs: 1 }, policy.name);
    assert.ok(!policy.downgradedHeavy.includes("c-failed"), policy.name);
    assert.ok(!policy.downgradedHeavy.includes("p2-heavy"), policy.name);
  }
  // Local would separate p2 via the risk keyword, but p2 is unscored for
  // everyone; on the only complete pair (p1) local answers standard twice.
  assert.equal(result.policies.find((policy) => policy.name === "local").contrast.pairsSeparated, 0);
  assert.deepEqual(result.excluded, { jevFailureIds: ["c-failed", "p2-heavy"], unscoredPairs: ["p2"] });
});
