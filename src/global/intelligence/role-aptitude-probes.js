// Versioned role-aptitude probe catalog (E2) + materialization helpers.
// Executable validation lives in role-aptitude-validators.js / runner (E3).
// Selection wiring is still out of scope (E4).

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROLE_APTITUDE_SUITE_ID = "role-aptitude/v1";
export const ROLE_APTITUDE_SUITE_VERSION = "1";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "../../..");
export const ROLE_APTITUDE_FIXTURES_ROOT = join(REPO_ROOT, "fixtures/role-aptitude/v1");

/**
 * @typedef {{
 *   role: string,
 *   probeId: string,
 *   probeVersion: string,
 *   prompt: string,
 *   fixtureId: string,
 *   editablePaths: string[],
 *   expectedArtifact: string,
 *   validatorId: string,
 *   validatorVersion: string,
 *   expectedFile: string,
 *   workspaceExtraDir?: string|null
 * }} RoleAptitudeProbe
 */

/** @type {RoleAptitudeProbe[]} */
const PROBES_V1 = [
  {
    role: "Explorer",
    probeId: "explorer.find-symbol-v1",
    probeVersion: "1",
    fixtureId: "shared-empty-total",
    expectedFile: "explorer.json",
    editablePaths: [],
    expectedArtifact: "findings.md",
    validatorId: "explorer.find-symbol-v1",
    validatorVersion: "1",
    prompt:
      "Locate where `computeTotal` is defined. Describe its real behavior for input `[]` " +
      "(include the exception if that is what happens). Cite file:line for every claim. Do not modify any files."
  },
  {
    role: "Architect",
    probeId: "architect.plan-fix-v1",
    // v2: output contract names the exact keepsPublicApi value it is graded on.
    probeVersion: "2",
    fixtureId: "shared-empty-total",
    expectedFile: "architect.json",
    editablePaths: [],
    expectedArtifact: "plan.md",
    validatorId: "architect.plan-fix-v1",
    validatorVersion: "1",
    prompt:
      "Write a concrete plan to fix the empty-array crash in `computeTotal` without changing the public API. " +
      "List file targets, ordered steps, acceptance criteria, and explicitly reject an API-breaking option. " +
      "Do not implement the fix."
  },
  {
    role: "Builder",
    probeId: "builder.apply-fix-v1",
    probeVersion: "1",
    fixtureId: "shared-empty-total",
    expectedFile: "builder.json",
    workspaceExtraDir: "builder-extra",
    editablePaths: ["src/compute-total.js"],
    expectedArtifact: "diff",
    validatorId: "builder.apply-fix-v1",
    validatorVersion: "1",
    prompt:
      "Follow PLAN.md. Implement the empty-array fix for `computeTotal` without changing the public API. " +
      "Edit only the planned production file. Leave tests and package.json untouched."
  },
  {
    role: "Debugger",
    probeId: "debugger.root-cause-v1",
    probeVersion: "2",
    fixtureId: "debugger-off-by-one",
    expectedFile: "debugger.json",
    editablePaths: ["src/index-of.js", "test/index-of.test.js"],
    expectedArtifact: "findings.md",
    validatorId: "debugger.root-cause-v1",
    validatorVersion: "2",
    prompt:
      "`indexOf` incorrectly treats a past-the-end `undefined` slot as a match when the needle is `undefined` " +
      "(see failing tests for `[]` and `[\"a\"]`). Name the real root cause with file:line, apply a minimal fix, " +
      "and keep or add a regression test that fails before the fix."
  },
  {
    role: "Tester",
    probeId: "tester.edge-coverage-v1",
    probeVersion: "1",
    fixtureId: "tester-edge-coverage",
    expectedFile: "tester.json",
    editablePaths: ["test/clamp.test.js"],
    expectedArtifact: "test/clamp.test.js",
    validatorId: "tester.edge-coverage-v1",
    validatorVersion: "1",
    prompt:
      "`clamp` is already correct. Add tests for below-min, above-max, and min===max edges. " +
      "Do not modify production sources."
  },
  {
    role: "Reviewer",
    probeId: "reviewer.findings-v1",
    probeVersion: "1",
    fixtureId: "reviewer-findings",
    expectedFile: "reviewer.json",
    editablePaths: [],
    expectedArtifact: "review.md",
    validatorId: "reviewer.findings-v1",
    validatorVersion: "1",
    prompt:
      "Review the change described in REVIEW_BRIEF.md and CHANGE.diff. Flag the planted product defect with file:line. " +
      "Do not treat trailing-punctuation style as a blocker. State approve or request-changes explicitly. Do not edit files."
  }
];

/**
 * @returns {RoleAptitudeProbe[]}
 */
export function listRoleAptitudeProbes() {
  return PROBES_V1.map((probe) => ({ ...probe, editablePaths: [...probe.editablePaths] }));
}

/**
 * @param {string} probeId
 * @returns {RoleAptitudeProbe|null}
 */
export function getRoleAptitudeProbe(probeId) {
  const probe = PROBES_V1.find((entry) => entry.probeId === probeId);
  return probe ? { ...probe, editablePaths: [...probe.editablePaths] } : null;
}

function assertNoSymlinks(rootDir) {
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    const st = lstatSync(current);
    if (st.isSymbolicLink()) {
      throw new Error(`role-aptitude-probes: symlink not allowed in fixture: ${current}`);
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(current)) {
        stack.push(join(current, name));
      }
    }
  }
}

function loadExpected(fixtureRoot, expectedFile) {
  const path = join(fixtureRoot, "expected", expectedFile);
  if (!existsSync(path)) {
    throw new Error(`role-aptitude-probes: missing expected file ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function pathInside(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolved = resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + sep);
}

/**
 * Materialize an independent disposable workspace for one probe.
 * Copies only model-visible files; expected answers stay outside the workspace.
 * @param {string} probeId
 * @param {{ parentDir?: string }} [options]
 * @returns {{
 *   probe: RoleAptitudeProbe,
 *   workspaceRoot: string,
 *   expected: object,
 *   expectedSourcePath: string,
 *   dispose: () => void
 * }}
 */
export function materializeProbeWorkspace(probeId, options = {}) {
  const probe = getRoleAptitudeProbe(probeId);
  if (!probe) {
    throw new Error(`role-aptitude-probes: unknown probeId "${probeId}"`);
  }
  const fixtureRoot = join(ROLE_APTITUDE_FIXTURES_ROOT, probe.fixtureId);
  const workspaceTemplate = join(fixtureRoot, "workspace");
  if (!existsSync(workspaceTemplate) || !statSync(workspaceTemplate).isDirectory()) {
    throw new Error(`role-aptitude-probes: missing workspace for fixture ${probe.fixtureId}`);
  }
  assertNoSymlinks(fixtureRoot);

  const parent = options.parentDir ?? tmpdir();
  const workspaceRoot = mkdtempSync(join(parent, `role-aptitude-${probe.probeId}-`));
  cpSync(workspaceTemplate, workspaceRoot, { recursive: true, dereference: false });
  assertNoSymlinks(workspaceRoot);

  if (probe.workspaceExtraDir) {
    const extraRoot = join(fixtureRoot, probe.workspaceExtraDir);
    if (!existsSync(extraRoot)) {
      throw new Error(`role-aptitude-probes: missing workspaceExtraDir ${extraRoot}`);
    }
    assertNoSymlinks(extraRoot);
    cpSync(extraRoot, workspaceRoot, { recursive: true, dereference: false });
  }

  // Belt-and-suspenders: never leave an `expected/` tree inside the model workspace.
  const leakedExpected = join(workspaceRoot, "expected");
  if (existsSync(leakedExpected)) {
    rmSync(leakedExpected, { recursive: true, force: true });
  }

  const expectedSourcePath = join(fixtureRoot, "expected", probe.expectedFile);
  const expected = loadExpected(fixtureRoot, probe.expectedFile);

  return {
    probe,
    workspaceRoot,
    expected,
    expectedSourcePath,
    dispose() {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  };
}

/**
 * Whether a relative path is editable for this probe (role permissions).
 * @param {RoleAptitudeProbe} probe
 * @param {string} relativePath
 */
export function isEditablePath(probe, relativePath) {
  const normalized = relativePath.split("\\").join("/");
  return probe.editablePaths.includes(normalized);
}

/**
 * Resolve a path inside a materialized workspace; rejects escapes and symlinks.
 * @param {string} workspaceRoot
 * @param {string} relativePath
 */
export function resolveWorkspacePath(workspaceRoot, relativePath) {
  const target = resolve(workspaceRoot, relativePath);
  if (!pathInside(workspaceRoot, target)) {
    throw new Error(`role-aptitude-probes: path escapes workspace: ${relativePath}`);
  }
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    throw new Error(`role-aptitude-probes: symlink not allowed: ${relativePath}`);
  }
  return target;
}

/** @param {string} workspaceRoot @param {string} relativePath @param {string} contents */
export function writeWorkspaceFile(workspaceRoot, relativePath, contents) {
  const target = resolveWorkspacePath(workspaceRoot, relativePath);
  writeFileSync(target, contents, "utf8");
}

/** Collect probe files only; Git metadata is not a model artifact. */
export function listRelativeFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    for (const name of readdirSync(current)) {
      if (name === ".git") continue;
      const full = join(current, name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        throw new Error(`role-aptitude-probes: symlink not allowed: ${full}`);
      }
      if (st.isDirectory()) stack.push(full);
      else out.push(relative(rootDir, full).split("\\").join("/"));
    }
  }
  return out.sort();
}

export { ROLE_APTITUDE_SUITE_ID as suiteId };
