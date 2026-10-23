// Role-aptitude validators (E3). Pure checks against fixture expected JSON +
// workspace state. Exit code 0 alone never passes. No provider calls.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { listRelativeFiles } from "./role-aptitude-probes.js";

/**
 * @typedef {{
 *   ok: boolean,
 *   verdict: "pass"|"fail",
 *   reasons: string[],
 *   diagnostics?: object
 * }} ValidationResult
 */

function fail(reasons, diagnostics = {}) {
  return { ok: false, verdict: "fail", reasons, diagnostics };
}

function pass(diagnostics = {}) {
  return { ok: true, verdict: "pass", reasons: [], diagnostics };
}

function citationCovers(citations, path, line = null) {
  if (!Array.isArray(citations)) return false;
  return citations.some((c) => {
    if (!c || c.path !== path) return false;
    if (line == null) return true;
    return Number(c.line) === Number(line);
  });
}

function readSource(workspaceRoot, rel) {
  return readFileSync(join(workspaceRoot, rel), "utf8");
}

function runNodeTest(workspaceRoot) {
  // Drop parent-runner context so a nested `node --test` actually executes the
  // disposable workspace suite instead of recursively skipping with exit 0.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--test"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    timeout: 15_000,
    env
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    signal: result.signal
  };
}

/** @param {object} structured @param {object} expected @param {string} workspaceRoot */
export function validateExplorer({ structured, expected, workspaceRoot, snapshotPaths }) {
  const reasons = [];
  if (snapshotPaths?.changed?.length) {
    reasons.push(`forbidden writes: ${snapshotPaths.changed.join(", ")}`);
  }
  if (structured?.definitionPath !== expected.definitionPath) {
    reasons.push(`definitionPath want ${expected.definitionPath} got ${structured?.definitionPath}`);
  }
  const src = readSource(workspaceRoot, expected.definitionPath);
  if (!src.includes("computeTotal")) reasons.push("definition file missing computeTotal");
  const behavior = String(structured?.emptyArrayBehavior ?? "");
  if (!/throw|TypeError|Reduce of empty array/i.test(behavior)) {
    reasons.push("emptyArrayBehavior must describe the real thrown TypeError");
  }
  if (!citationCovers(structured?.citations, expected.definitionPath)) {
    reasons.push("missing citation for definition path");
  }
  return reasons.length ? fail(reasons) : pass({ behavior });
}

/** @param {object} structured @param {object} expected */
export function validateArchitect({ structured, expected, snapshotPaths }) {
  const reasons = [];
  if (snapshotPaths?.changed?.length) {
    reasons.push(`forbidden writes: ${snapshotPaths.changed.join(", ")}`);
  }
  const planFiles = structured?.planFiles ?? [];
  for (const required of expected.mustPlanFiles ?? []) {
    if (!planFiles.includes(required)) reasons.push(`plan missing file ${required}`);
  }
  if (!Array.isArray(structured?.steps) || structured.steps.length < 2) {
    reasons.push("plan needs ordered steps (≥2)");
  }
  if (!String(structured?.acceptance ?? "").trim()) {
    reasons.push("plan missing acceptance criteria");
  }
  if (structured?.rejectsApiBreak !== true) {
    reasons.push("must explicitly reject an API-breaking option");
  }
  if (structured?.keepsPublicApi !== expected.mustKeepPublicApi) {
    reasons.push(`keepsPublicApi want ${expected.mustKeepPublicApi}`);
  }
  return reasons.length ? fail(reasons) : pass();
}

/** Builder: hidden behavior checks + API + editable paths already enforced by runner. */
export async function validateBuilder({ workspaceRoot, expected, snapshotPaths }) {
  const reasons = [];
  for (const path of snapshotPaths?.changed ?? []) {
    if (!(expected.allowedEditPaths ?? []).includes(path)) {
      reasons.push(`forbidden edit ${path}`);
    }
  }
  for (const path of expected.forbiddenEditPaths ?? []) {
    if ((snapshotPaths?.changed ?? []).includes(path)) {
      reasons.push(`edited forbidden path ${path}`);
    }
  }
  const src = readSource(workspaceRoot, "src/compute-total.js");
  if (!src.includes(`export function ${expected.publicApiExport}`)) {
    reasons.push(`public API export ${expected.publicApiExport} missing`);
  }
  const modUrl = pathToFileURL(join(workspaceRoot, "src/compute-total.js")).href;
  const mod = await import(`${modUrl}?t=${Date.now()}`);
  try {
    assertHiddenBuilderBehavior(mod.computeTotal, reasons);
  } catch (err) {
    reasons.push(`hidden behavior threw: ${err.message}`);
  }
  const tests = runNodeTest(workspaceRoot);
  if (tests.status !== 0) {
    reasons.push(`workspace tests failed (status=${tests.status})`);
  }
  return reasons.length ? fail(reasons, { testStatus: tests.status }) : pass();
}

function assertHiddenBuilderBehavior(computeTotal, reasons) {
  if (typeof computeTotal !== "function") {
    reasons.push("computeTotal is not a function");
    return;
  }
  try {
    const empty = computeTotal([]);
    if (empty !== 0) reasons.push(`computeTotal([]) want 0 got ${empty}`);
  } catch (err) {
    reasons.push(`computeTotal([]) still throws: ${err.message}`);
  }
  if (computeTotal([{ value: 2 }, { value: 3 }]) !== 5) {
    reasons.push("computeTotal non-empty sum regress");
  }
}

/** Debugger: structured root cause + RED on original production + GREEN on fix. */
export async function validateDebugger({
  structured,
  expected,
  workspaceRoot,
  snapshotPaths,
  originalProduction
}) {
  const reasons = [];
  for (const path of snapshotPaths?.changed ?? []) {
    if (!(expected.allowedEditPaths ?? []).includes(path)) {
      reasons.push(`forbidden edit ${path}`);
    }
  }
  if (structured?.rootCausePath !== expected.rootCausePath) {
    reasons.push(`rootCausePath want ${expected.rootCausePath}`);
  }
  if (!citationCovers(structured?.citations, expected.rootCausePath, structured?.rootCauseLine)) {
    reasons.push("root cause citation missing file:line");
  }
  const fixed = readSource(workspaceRoot, expected.rootCausePath);
  if (!fixed.includes(expected.fixPattern)) {
    reasons.push(`fix must use ${expected.fixPattern}`);
  }
  if (fixed.includes(expected.rootCausePattern)) {
    reasons.push("buggy loop pattern still present");
  }
  if (!String(structured?.rootCauseSummary ?? "").toLowerCase().includes("undefined")) {
    reasons.push("rootCauseSummary must mention undefined past-the-end match");
  }

  if (!originalProduction) {
    reasons.push("missing original production snapshot for RED check");
  } else {
    const red = await runDebuggerRed(originalProduction, expected);
    if (!red.failedAsExpected) {
      reasons.push("RED expected: original production should fail undefined regressions");
    }
  }

  const green = runNodeTest(workspaceRoot);
  if (green.status !== 0) reasons.push("GREEN: fixed workspace tests must pass");

  return reasons.length ? fail(reasons) : pass();
}

async function runDebuggerRed(originalProductionSource, expected) {
  const dir = mkdtempSync(join(tmpdir(), "role-aptitude-debugger-red-"));
  try {
    writeFileSync(join(dir, "index-of.mjs"), originalProductionSource, "utf8");
    const url = pathToFileURL(join(dir, "index-of.mjs")).href;
    const mod = await import(`${url}?t=${Date.now()}`);
    let failedAsExpected = false;
    for (const cse of expected.regressionCases ?? []) {
      const needle = cse.needleIsUndefined ? undefined : cse.needle;
      const got = mod.indexOf(cse.haystack, needle);
      if (got !== cse.expected) failedAsExpected = true;
    }
    return { failedAsExpected };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Tester: suite green + each edge mutation must be detected by their tests.
 */
export function validateTester({ workspaceRoot, expected, snapshotPaths }) {
  const reasons = [];
  for (const path of snapshotPaths?.changed ?? []) {
    if (!(expected.allowedEditPaths ?? []).includes(path)) {
      reasons.push(`forbidden edit ${path}`);
    }
  }
  for (const path of expected.forbiddenEditPaths ?? []) {
    if ((snapshotPaths?.changed ?? []).includes(path)) {
      reasons.push(`edited forbidden path ${path}`);
    }
  }
  const green = runNodeTest(workspaceRoot);
  if (green.status !== 0) reasons.push("tester suite must be green on correct production");

  const productionPath = join(workspaceRoot, "src/clamp.js");
  const original = readFileSync(productionPath, "utf8");
  const mutations = [
    {
      name: "below min",
      patch: original.replace("if (n < min) return min;", "if (n < min) return n;")
    },
    {
      name: "above max",
      patch: original.replace("if (n > max) return max;", "if (n > max) return n;")
    },
    {
      name: "min equals max",
      patch: original.replace(
        "export function clamp(n, min, max) {\n  if (n < min) return min;\n  if (n > max) return max;\n  return n;\n}",
        "export function clamp(n, min, max) {\n  if (min === max) return n;\n  if (n < min) return min;\n  if (n > max) return max;\n  return n;\n}"
      )
    }
  ];

  for (const mutation of mutations) {
    writeFileSync(productionPath, mutation.patch, "utf8");
    const result = runNodeTest(workspaceRoot);
    if (result.status === 0) {
      reasons.push(`tests did not detect mutation: ${mutation.name}`);
    }
  }
  writeFileSync(productionPath, original, "utf8");

  return reasons.length ? fail(reasons) : pass();
}

/** @param {object} structured @param {object} expected */
export function validateReviewer({ structured, expected, snapshotPaths }) {
  const reasons = [];
  if (snapshotPaths?.changed?.length) {
    reasons.push(`forbidden writes: ${snapshotPaths.changed.join(", ")}`);
  }
  if (structured?.plantedDefectPath !== expected.plantedDefectPath) {
    reasons.push(`plantedDefectPath want ${expected.plantedDefectPath}`);
  }
  if (!citationCovers(structured?.citations, expected.plantedDefectPath, structured?.plantedDefectLine)) {
    reasons.push("planted defect needs file:line citation");
  }
  if (structured?.blocksOnNonIssue === true) {
    reasons.push("must not block on trailing-punctuation non-issue");
  }
  if (structured?.decision !== "request-changes" && structured?.decision !== "approve") {
    reasons.push("decision must be approve or request-changes");
  }
  // Planted defect is a product bug — correct decision is request-changes.
  if (structured?.decision !== "request-changes") {
    reasons.push("planted product defect requires request-changes");
  }
  return reasons.length ? fail(reasons) : pass();
}

/**
 * @param {{
 *   probe: object,
 *   expected: object,
 *   workspaceRoot: string,
 *   structured: object|null,
 *   snapshotPaths: { changed: string[] },
 *   originalProduction?: string|null
 * }} args
 * @returns {Promise<ValidationResult>}
 */
export async function validateProbeAttempt(args) {
  const { probe } = args;
  switch (probe.role) {
    case "Explorer":
      return validateExplorer(args);
    case "Architect":
      return validateArchitect(args);
    case "Builder":
      return validateBuilder(args);
    case "Debugger":
      return validateDebugger(args);
    case "Tester":
      return validateTester(args);
    case "Reviewer":
      return validateReviewer(args);
    default:
      return fail([`no validator for role ${probe.role}`]);
  }
}

export { listRelativeFiles, runNodeTest };
