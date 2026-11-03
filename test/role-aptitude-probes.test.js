/**
 * E2 — versioned probes + disposable fixtures. Offline only; no runners/validators.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  ROLE_APTITUDE_FIXTURES_ROOT,
  ROLE_APTITUDE_SUITE_ID,
  ROLE_APTITUDE_SUITE_VERSION,
  getRoleAptitudeProbe,
  isEditablePath,
  listRelativeFiles,
  listRoleAptitudeProbes,
  materializeProbeWorkspace,
  resolveWorkspacePath
} from "../src/global/intelligence/role-aptitude-probes.js";

const ROLES = ["Explorer", "Architect", "Builder", "Debugger (fix)", "Test Runner", "Reviewer", "Test Designer", "Debugger (diagnosis)"];

test("suite lists eight distinct role probes with unique ids", () => {
  const probes = listRoleAptitudeProbes();
  assert.equal(ROLE_APTITUDE_SUITE_ID, "role-aptitude/v1");
  assert.equal(ROLE_APTITUDE_SUITE_VERSION, "1");
  assert.equal(probes.length, 8);
  const ids = probes.map((p) => p.probeId);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(probes.map((p) => p.role).sort(), [...ROLES].sort());
  for (const probe of probes) {
    assert.ok(probe.probeVersion);
    assert.ok(probe.validatorVersion);
    assert.equal(probe.validatorId, probe.probeId);
    assert.ok(probe.prompt.length > 20);
    assert.ok(probe.expectedArtifact);
  }
  const architectProbe = probes.find((p) => p.role === "Architect");
  assert.equal(architectProbe.probeVersion, "2");
  const debuggerProbe = probes.find((p) => p.role === "Debugger (fix)");
  assert.equal(debuggerProbe.probeVersion, "2");
  assert.equal(debuggerProbe.validatorVersion, "2");
  assert.match(debuggerProbe.prompt, /undefined/i);
  assert.doesNotMatch(debuggerProbe.prompt, /failing last-element case/i);
});

test("each probe fixture workspace and expected file exist on disk", () => {
  for (const probe of listRoleAptitudeProbes()) {
    const workspace = join(ROLE_APTITUDE_FIXTURES_ROOT, probe.fixtureId, "workspace");
    const expected = join(ROLE_APTITUDE_FIXTURES_ROOT, probe.fixtureId, "expected", probe.expectedFile);
    assert.ok(existsSync(workspace), `missing ${workspace}`);
    assert.ok(existsSync(expected), `missing ${expected}`);
    if (probe.workspaceExtraDir) {
      assert.ok(existsSync(join(ROLE_APTITUDE_FIXTURES_ROOT, probe.fixtureId, probe.workspaceExtraDir)));
    }
  }
});

test("Explorer prompt asks for real [] behavior including exceptions, not a fake return", () => {
  const explorer = getRoleAptitudeProbe("explorer.find-symbol-v1");
  assert.match(explorer.prompt, /\[\]/);
  assert.match(explorer.prompt, /exception|behavior/i);
  assert.doesNotMatch(explorer.prompt, /returns 0 for \[\]/);
  const { expected, dispose } = materializeProbeWorkspace("explorer.find-symbol-v1");
  try {
    assert.match(expected.emptyArrayBehavior, /throws|TypeError|exception/i);
  } finally {
    dispose();
  }
});

test("role editable paths match probe permissions", () => {
  const byRole = Object.fromEntries(listRoleAptitudeProbes().map((p) => [p.role, p]));
  assert.deepEqual(byRole.Explorer.editablePaths, []);
  assert.deepEqual(byRole.Architect.editablePaths, []);
  assert.deepEqual(byRole.Reviewer.editablePaths, []);
  assert.ok(isEditablePath(byRole.Builder, "src/compute-total.js"));
  assert.equal(isEditablePath(byRole.Builder, "test/compute-total.test.js"), false);
  assert.ok(isEditablePath(byRole["Debugger (fix)"], "src/index-of.js"));
  assert.ok(isEditablePath(byRole["Test Runner"], "test/clamp.test.js"));
  assert.equal(isEditablePath(byRole["Test Runner"], "src/clamp.js"), false);
});

test("materialize copies are isolated; mutating one does not change the template", () => {
  const first = materializeProbeWorkspace("builder.apply-fix-v1");
  const second = materializeProbeWorkspace("builder.apply-fix-v1");
  try {
    assert.notEqual(first.workspaceRoot, second.workspaceRoot);
    const rel = "src/compute-total.js";
    const templatePath = join(ROLE_APTITUDE_FIXTURES_ROOT, "shared-empty-total", "workspace", rel);
    const before = readFileSync(templatePath, "utf8");
    writeFileSync(join(first.workspaceRoot, rel), `${before}\n// mutated-copy\n`, "utf8");
    assert.equal(readFileSync(templatePath, "utf8"), before);
    assert.equal(readFileSync(join(second.workspaceRoot, rel), "utf8"), before);
    assert.match(readFileSync(join(first.workspaceRoot, rel), "utf8"), /mutated-copy/);
  } finally {
    first.dispose();
    second.dispose();
  }
});

test("expected answers are not present inside the model workspace", () => {
  for (const probe of listRoleAptitudeProbes()) {
    const { workspaceRoot, expectedSourcePath, dispose } = materializeProbeWorkspace(probe.probeId);
    try {
      const files = listRelativeFiles(workspaceRoot);
      assert.equal(files.some((f) => f === "expected" || f.startsWith("expected/")), false);
      assert.equal(files.some((f) => f.endsWith(".json") && f.includes("expected")), false);
      assert.ok(existsSync(expectedSourcePath));
      assert.equal(expectedSourcePath.includes(`${workspaceRoot}`), false);
      // Builder gets PLAN.md via overlay; Explorer must not.
      if (probe.role === "Explorer") {
        assert.equal(files.includes("PLAN.md"), false);
      }
      if (probe.role === "Builder") {
        assert.ok(files.includes("PLAN.md"));
      }
    } finally {
      dispose();
    }
  }
});

test("resolveWorkspacePath rejects path escape", () => {
  const { workspaceRoot, dispose } = materializeProbeWorkspace("tester.edge-coverage-v1");
  try {
    assert.throws(() => resolveWorkspacePath(workspaceRoot, "../secret.txt"), /escapes workspace/);
  } finally {
    dispose();
  }
});

test("getRoleAptitudeProbe returns null for unknown ids", () => {
  assert.equal(getRoleAptitudeProbe("no.such.probe"), null);
});

test("listRelativeFiles excludes git metadata without hiding ordinary probe files", t => {
  const workspace = materializeProbeWorkspace("builder.apply-fix-v1");
  t.after(workspace.dispose);
  const before = listRelativeFiles(workspace.workspaceRoot);
  mkdirSync(join(workspace.workspaceRoot, ".git", "objects"), { recursive: true });
  writeFileSync(join(workspace.workspaceRoot, ".git", "objects", "binary"), Buffer.from([0, 255]));
  writeFileSync(join(workspace.workspaceRoot, ".gitignore"), "ignored.txt\n");
  assert.deepEqual(listRelativeFiles(workspace.workspaceRoot), [...before, ".gitignore"].sort());
});
