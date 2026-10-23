/**
 * E3 — synthetic runner + validators. Offline only; no provider calls.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRoleAptitudeEvidenceStore } from "../src/global/intelligence/role-aptitude-evidence.js";
import { runSyntheticProbe } from "../src/global/intelligence/role-aptitude-runner.js";
import { getRoleAptitudeProbe } from "../src/global/intelligence/role-aptitude-probes.js";

const IDENTITY = { adapterId: "synthetic", modelId: "fixture-agent" };

function captureExecuteKeys(execute) {
  let seenKeys = null;
  const wrapped = async (ctx) => {
    seenKeys = Object.keys(ctx).sort();
    assert.equal("expected" in ctx, false);
    assert.equal("expectedSourcePath" in ctx, false);
    return execute(ctx);
  };
  wrapped.seenKeys = () => seenKeys;
  return wrapped;
}

const FIXED_COMPUTE_TOTAL = `/**
 * Sum numeric item values. Public API: computeTotal(items) → number.
 */
export function computeTotal(items) {
  return items.map((item) => item.value).reduce((sum, value) => sum + value, 0);
}
`;

const FIXED_INDEX_OF = `export function indexOf(haystack, needle) {
  for (let i = 0; i < haystack.length; i += 1) {
    if (haystack[i] === needle) return i;
  }
  return -1;
}
`;

const GOOD_CLAMP_TESTS = `import test from "node:test";
import assert from "node:assert/strict";
import { clamp } from "../src/clamp.js";

test("returns value inside range", () => {
  assert.equal(clamp(5, 0, 10), 5);
});

test("below min", () => {
  assert.equal(clamp(-1, 0, 10), 0);
});

test("above max", () => {
  assert.equal(clamp(11, 0, 10), 10);
});

test("min equals max", () => {
  assert.equal(clamp(5, 7, 7), 7);
});
`;

test("Explorer pass records validated evidence; execute never sees expected", async () => {
  const store = createRoleAptitudeEvidenceStore();
  const execute = captureExecuteKeys(async () => ({
    exitCode: 0,
    artifactMarkdown: "# findings",
    structured: {
      definitionPath: "src/compute-total.js",
      emptyArrayBehavior: "throws TypeError (Reduce of empty array with no initial value)",
      citations: [{ path: "src/compute-total.js", line: 6 }]
    }
  }));
  const artifactDir = mkdtempSync(join(tmpdir(), "role-aptitude-artifacts-"));
  const result = await runSyntheticProbe({
    probeId: "explorer.find-symbol-v1",
    identity: IDENTITY,
    store,
    execute,
    artifactDir
  });
  assert.equal(result.verdict, "pass");
  assert.ok(result.artifactPath && existsSync(result.artifactPath));
  assert.deepEqual(execute.seenKeys(), ["identity", "probe", "prompt", "workspaceRoot"]);
  const probe = getRoleAptitudeProbe("explorer.find-symbol-v1");
  assert.equal(store.getValidatedVerdict({
    ...IDENTITY,
    role: "Explorer",
    probeId: probe.probeId,
    probeVersion: probe.probeVersion
  })?.verdict, "pass");
});

test("exit 0 with wrong Explorer facts fails", async () => {
  const store = createRoleAptitudeEvidenceStore();
  const result = await runSyntheticProbe({
    probeId: "explorer.find-symbol-v1",
    identity: IDENTITY,
    store,
    execute: async () => ({
      exitCode: 0,
      structured: {
        definitionPath: "src/compute-total.js",
        emptyArrayBehavior: "returns 0",
        citations: [{ path: "src/compute-total.js", line: 1 }]
      }
    })
  });
  assert.equal(result.verdict, "fail");
  assert.ok(result.validation.reasons.some((r) => /emptyArrayBehavior|TypeError/i.test(r)));
});

test("Architect pass and forbidden write fail", async () => {
  const store = createRoleAptitudeEvidenceStore();
  const ok = await runSyntheticProbe({
    probeId: "architect.plan-fix-v1",
    identity: IDENTITY,
    store,
    execute: async () => ({
      structured: {
        planFiles: ["src/compute-total.js"],
        steps: ["Inspect reduce", "Add initial value 0"],
        acceptance: "computeTotal([]) returns 0",
        rejectsApiBreak: true,
        keepsPublicApi: "computeTotal"
      },
      artifactMarkdown: "# plan"
    })
  });
  assert.equal(ok.verdict, "pass");

  const bad = await runSyntheticProbe({
    probeId: "architect.plan-fix-v1",
    identity: { adapterId: "synthetic", modelId: "writer" },
    store,
    execute: async () => ({
      structured: {
        planFiles: ["src/compute-total.js"],
        steps: ["a", "b"],
        acceptance: "ok",
        rejectsApiBreak: true,
        keepsPublicApi: "computeTotal"
      },
      fileWrites: [{ path: "src/compute-total.js", contents: "// nope" }]
    })
  });
  assert.equal(bad.verdict, "fail");
  assert.match(bad.validation.reasons.join(" "), /forbidden/);
});

test("Builder pass via fileWrites; wrong fix with exit 0 fails", async () => {
  const store = createRoleAptitudeEvidenceStore();
  const pass = await runSyntheticProbe({
    probeId: "builder.apply-fix-v1",
    identity: IDENTITY,
    store,
    execute: async () => ({
      exitCode: 0,
      fileWrites: [{ path: "src/compute-total.js", contents: FIXED_COMPUTE_TOTAL }]
    })
  });
  assert.equal(pass.verdict, "pass");

  const fail = await runSyntheticProbe({
    probeId: "builder.apply-fix-v1",
    identity: { adapterId: "synthetic", modelId: "noop" },
    store,
    execute: async () => ({
      exitCode: 0,
      fileWrites: []
    })
  });
  assert.equal(fail.verdict, "fail");
});

test("Debugger v2 pass needs undefined root-cause; RED/GREEN enforced", async () => {
  const store = createRoleAptitudeEvidenceStore();
  const probe = getRoleAptitudeProbe("debugger.root-cause-v1");
  assert.equal(probe.probeVersion, "2");

  const pass = await runSyntheticProbe({
    probeId: "debugger.root-cause-v1",
    identity: IDENTITY,
    store,
    execute: async () => ({
      structured: {
        rootCausePath: "src/index-of.js",
        rootCauseLine: 8,
        rootCauseSummary: "loop uses <= so undefined needle matches past-the-end undefined",
        citations: [{ path: "src/index-of.js", line: 8 }]
      },
      fileWrites: [{ path: "src/index-of.js", contents: FIXED_INDEX_OF }],
      artifactMarkdown: "# root cause"
    })
  });
  assert.equal(pass.verdict, "pass");

  const wrongStory = await runSyntheticProbe({
    probeId: "debugger.root-cause-v1",
    identity: { adapterId: "synthetic", modelId: "last-el" },
    store,
    execute: async () => ({
      exitCode: 0,
      structured: {
        rootCausePath: "src/index-of.js",
        rootCauseLine: 8,
        rootCauseSummary: "misses the last element",
        citations: [{ path: "src/index-of.js", line: 8 }]
      },
      fileWrites: [{ path: "src/index-of.js", contents: FIXED_INDEX_OF }]
    })
  });
  assert.equal(wrongStory.verdict, "fail");
});

test("Tester pass detects edge mutations; production edit fails", async () => {
  const store = createRoleAptitudeEvidenceStore();
  const pass = await runSyntheticProbe({
    probeId: "tester.edge-coverage-v1",
    identity: IDENTITY,
    store,
    execute: async () => ({
      fileWrites: [{ path: "test/clamp.test.js", contents: GOOD_CLAMP_TESTS }]
    })
  });
  assert.equal(pass.verdict, "pass");

  const bad = await runSyntheticProbe({
    probeId: "tester.edge-coverage-v1",
    identity: { adapterId: "synthetic", modelId: "editor" },
    store,
    execute: async () => ({
      fileWrites: [
        { path: "test/clamp.test.js", contents: GOOD_CLAMP_TESTS },
        { path: "src/clamp.js", contents: "export function clamp() { return 0; }\n" }
      ]
    })
  });
  assert.equal(bad.verdict, "fail");
});

test("Reviewer pass flags planted defect; keyword-only approve fails", async () => {
  const store = createRoleAptitudeEvidenceStore();
  const pass = await runSyntheticProbe({
    probeId: "reviewer.findings-v1",
    identity: IDENTITY,
    store,
    execute: async () => ({
      artifactMarkdown: "looks fine overall but request-changes",
      structured: {
        plantedDefectPath: "src/greet.js",
        plantedDefectLine: 3,
        blocksOnNonIssue: false,
        decision: "request-changes",
        citations: [{ path: "src/greet.js", line: 3 }]
      }
    })
  });
  assert.equal(pass.verdict, "pass");

  const fail = await runSyntheticProbe({
    probeId: "reviewer.findings-v1",
    identity: { adapterId: "synthetic", modelId: "vague" },
    store,
    execute: async () => ({
      exitCode: 0,
      artifactMarkdown: "defect bug issue approve request-changes looks fine",
      structured: {
        plantedDefectPath: "src/greet.js",
        blocksOnNonIssue: true,
        decision: "approve",
        citations: []
      }
    })
  });
  assert.equal(fail.verdict, "fail");
});

test("timeout records error without clearing prior validated pass", async () => {
  const store = createRoleAptitudeEvidenceStore();
  const probe = getRoleAptitudeProbe("explorer.find-symbol-v1");
  const key = {
    ...IDENTITY,
    role: "Explorer",
    probeId: probe.probeId,
    probeVersion: probe.probeVersion
  };
  await runSyntheticProbe({
    probeId: "explorer.find-symbol-v1",
    identity: IDENTITY,
    store,
    execute: async () => ({
      structured: {
        definitionPath: "src/compute-total.js",
        emptyArrayBehavior: "throws TypeError (Reduce of empty array with no initial value)",
        citations: [{ path: "src/compute-total.js", line: 6 }]
      }
    })
  });
  assert.equal(store.getValidatedVerdict(key)?.verdict, "pass");

  const timed = await runSyntheticProbe({
    probeId: "explorer.find-symbol-v1",
    identity: IDENTITY,
    store,
    timeoutMs: 30,
    execute: async () => {
      await new Promise((r) => setTimeout(r, 200));
      return { structured: {} };
    }
  });
  assert.equal(timed.verdict, "error");
  assert.equal(store.getValidatedVerdict(key)?.verdict, "pass");
  assert.equal(store.getLastAttempt(key)?.verdict, "error");
});

test("malformed execution result fails closed", async () => {
  const store = createRoleAptitudeEvidenceStore();
  const result = await runSyntheticProbe({
    probeId: "explorer.find-symbol-v1",
    identity: IDENTITY,
    store,
    execute: async () => null
  });
  assert.equal(result.verdict, "fail");
  assert.match(result.validation.reasons.join(" "), /malformed/);
});
