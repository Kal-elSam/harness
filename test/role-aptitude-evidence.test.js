/**
 * E1 — owned role-aptitude evidence store + pending projection.
 * Offline only: no provider calls. Synthetic attempts only.
 */
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as evidence from "../src/global/intelligence/role-aptitude-evidence.js";
import { harnessHomePaths } from "../src/global/paths.js";
import assert from "node:assert/strict";
import {
  createRoleAptitudeEvidenceStore,
  evidenceKey,
  isProductionEnablingEvidence
} from "../src/global/intelligence/role-aptitude-evidence.js";

const BASE = {
  adapterId: "codex",
  modelId: "gpt-test",
  role: "Builder",
  probeId: "builder.apply-fix-v1",
  probeVersion: "1"
};

function attempt(overrides = {}) {
  return {
    ...BASE,
    verdict: "pass",
    startedAt: "2026-10-02T00:00:00.000Z",
    finishedAt: "2026-10-02T00:00:01.000Z",
    durationMs: 1000,
    cost: null,
    error: null,
    artifactRefs: ["diff.patch"],
    validatorId: "builder.apply-fix-v1",
    validatorVersion: "1",
    ...overrides
  };
}

test("evidenceKey is stable for adapter/model/account/role/probe/version", () => {
  assert.equal(
    evidenceKey(BASE),
    "codex::gpt-test::default::Builder::builder.apply-fix-v1::1"
  );
  assert.equal(
    evidenceKey({ ...BASE, accountKey: "acct-a" }),
    "codex::gpt-test::acct-a::Builder::builder.apply-fix-v1::1"
  );
});

test("pass sets validatedVerdict and lastAttempt", () => {
  const store = createRoleAptitudeEvidenceStore();
  const recorded = store.recordAttempt(attempt({ verdict: "pass" }));
  assert.equal(recorded.verdict, "pass");
  assert.equal(store.getValidatedVerdict(BASE)?.verdict, "pass");
  assert.equal(store.getLastAttempt(BASE)?.verdict, "pass");
});

test("later fail replaces validated pass", () => {
  const store = createRoleAptitudeEvidenceStore();
  store.recordAttempt(attempt({ verdict: "pass" }));
  store.recordAttempt(attempt({ verdict: "fail", finishedAt: "2026-10-02T00:01:00.000Z" }));
  assert.equal(store.getValidatedVerdict(BASE)?.verdict, "fail");
  assert.equal(store.getLastAttempt(BASE)?.verdict, "fail");
});

test("later error updates lastAttempt but keeps validated pass", () => {
  const store = createRoleAptitudeEvidenceStore();
  store.recordAttempt(attempt({ verdict: "pass" }));
  store.recordAttempt(attempt({
    verdict: "error",
    error: "transport timeout",
    finishedAt: "2026-10-02T00:02:00.000Z",
    artifactRefs: []
  }));
  assert.equal(store.getValidatedVerdict(BASE)?.verdict, "pass");
  assert.equal(store.getLastAttempt(BASE)?.verdict, "error");
  assert.equal(store.getLastAttempt(BASE)?.error, "transport timeout");
});

test("later pending updates lastAttempt but keeps validated fail", () => {
  const store = createRoleAptitudeEvidenceStore();
  store.recordAttempt(attempt({ verdict: "fail" }));
  store.recordAttempt(attempt({
    verdict: "pending",
    finishedAt: null,
    artifactRefs: []
  }));
  assert.equal(store.getValidatedVerdict(BASE)?.verdict, "fail");
  assert.equal(store.getLastAttempt(BASE)?.verdict, "pending");
});

test("evidence does not inherit across probe versions", () => {
  const store = createRoleAptitudeEvidenceStore();
  store.recordAttempt(attempt({ verdict: "pass", probeVersion: "1" }));
  const v2 = { ...BASE, probeVersion: "2" };
  assert.equal(store.getValidatedVerdict(v2), null);
  assert.equal(store.getLastAttempt(v2), null);
  store.recordAttempt(attempt({ verdict: "fail", probeVersion: "2" }));
  assert.equal(store.getValidatedVerdict(BASE)?.verdict, "pass");
  assert.equal(store.getValidatedVerdict(v2)?.verdict, "fail");
});

test("history is append-only across attempts", () => {
  const store = createRoleAptitudeEvidenceStore();
  store.recordAttempt(attempt({ verdict: "pass" }));
  store.recordAttempt(attempt({ verdict: "error", error: "boom" }));
  store.recordAttempt(attempt({ verdict: "fail" }));
  const history = store.listHistory(BASE);
  assert.deepEqual(history.map((h) => h.verdict), ["pass", "error", "fail"]);
});

test("projectRoleEvidence: no attempts → pending copy, never incapacity language", () => {
  const store = createRoleAptitudeEvidenceStore();
  const projection = store.projectRoleEvidence(
    { adapterId: BASE.adapterId, modelId: BASE.modelId },
    BASE.role,
    BASE.probeId,
    BASE.probeVersion
  );
  assert.equal(projection.status, "pending");
  assert.match(projection.labelEs, /Sin evidencia propia aún|Pendiente/i);
  assert.doesNotMatch(projection.labelEs, /incapaz|no sirve|descartado por falta de habilidad/i);
  assert.equal(projection.validated, null);
  assert.equal(projection.lastAttempt, null);
});

test("projectRoleEvidence: validated pass with later error still shows pass for competition status", () => {
  const store = createRoleAptitudeEvidenceStore();
  store.recordAttempt(attempt({ verdict: "pass" }));
  store.recordAttempt(attempt({ verdict: "error", error: "crash" }));
  const projection = store.projectRoleEvidence(
    { adapterId: BASE.adapterId, modelId: BASE.modelId },
    BASE.role,
    BASE.probeId,
    BASE.probeVersion
  );
  assert.equal(projection.status, "pass");
  assert.match(projection.labelEs, /Evidencia propia: apto/i);
  assert.equal(projection.validated?.verdict, "pass");
  assert.equal(projection.lastAttempt?.verdict, "error");
});

test("projectRoleEvidence: validated fail copy does not claim permanent incapacity", () => {
  const store = createRoleAptitudeEvidenceStore();
  store.recordAttempt(attempt({ verdict: "fail" }));
  const projection = store.projectRoleEvidence(
    { adapterId: BASE.adapterId, modelId: BASE.modelId },
    BASE.role,
    BASE.probeId,
    BASE.probeVersion
  );
  assert.equal(projection.status, "fail");
  assert.match(projection.labelEs, /No superó la prueba/i);
  assert.doesNotMatch(projection.labelEs, /incapaz|permanentemente|modelo malo/i);
});

test("keys are isolated across models and roles", () => {
  const store = createRoleAptitudeEvidenceStore();
  store.recordAttempt(attempt({ verdict: "pass" }));
  const otherModel = { ...BASE, modelId: "gpt-other" };
  const otherRole = { ...BASE, role: "Test Runner", probeId: "tester.edge-coverage-v1" };
  store.recordAttempt(attempt({ ...otherModel, verdict: "fail" }));
  assert.equal(store.getValidatedVerdict(BASE)?.verdict, "pass");
  assert.equal(store.getValidatedVerdict(otherModel)?.verdict, "fail");
  assert.equal(store.getValidatedVerdict(otherRole), null);
});

test("returned records are copies — external mutation cannot alter history", () => {
  const store = createRoleAptitudeEvidenceStore();
  const input = attempt({ verdict: "pass", artifactRefs: ["a.patch"], cost: null });
  const recorded = store.recordAttempt(input);
  input.verdict = "fail";
  input.artifactRefs.push("mutated.patch");
  recorded.verdict = "error";
  recorded.artifactRefs.push("mutated-return.patch");
  recorded.cost = 99;

  const validated = store.getValidatedVerdict(BASE);
  const history = store.listHistory(BASE);
  assert.equal(validated?.verdict, "pass");
  assert.equal(validated?.cost, null);
  assert.deepEqual(validated?.artifactRefs, ["a.patch"]);
  assert.deepEqual(history.map((h) => h.verdict), ["pass"]);
  assert.deepEqual(history[0].artifactRefs, ["a.patch"]);

  validated.artifactRefs.push("after-get.patch");
  assert.deepEqual(store.getValidatedVerdict(BASE)?.artifactRefs, ["a.patch"]);
});

test("projectRoleEvidence: lone error (no validated) uses interrupted pending copy", () => {
  const store = createRoleAptitudeEvidenceStore();
  store.recordAttempt(attempt({ verdict: "error", error: "boom", artifactRefs: [] }));
  const projection = store.projectRoleEvidence(
    { adapterId: BASE.adapterId, modelId: BASE.modelId },
    BASE.role,
    BASE.probeId,
    BASE.probeVersion
  );
  assert.equal(projection.status, "error");
  assert.match(projection.labelEs, /Evaluación interrumpida/i);
  assert.equal(projection.validated, null);
  assert.equal(projection.lastAttempt?.verdict, "error");
});

test("operational pass enables production only with real-bridge executionKind", () => {
  assert.equal(
    isProductionEnablingEvidence(attempt({
      verdict: "pass",
      origin: "operational",
      executionKind: "test-double"
    })),
    false
  );
  assert.equal(
    isProductionEnablingEvidence(attempt({
      verdict: "pass",
      origin: "operational",
      executionKind: "operational-runner"
    })),
    false
  );
  assert.equal(
    isProductionEnablingEvidence(attempt({
      verdict: "pass",
      origin: "operational",
      executionKind: "real-bridge"
    })),
    true
  );
  const store = createRoleAptitudeEvidenceStore();
  store.recordAttempt(attempt({
    verdict: "pass",
    origin: "operational",
    executionKind: "test-double"
  }));
  assert.equal(store.getProductionEnablingPass(BASE), null);
  store.recordAttempt(attempt({
    verdict: "pass",
    origin: "operational",
    executionKind: "real-bridge"
  }));
  assert.equal(store.getProductionEnablingPass(BASE)?.executionKind, "real-bridge");
});

async function persistentFixture(t) {
  const homeDir = await mkdtemp(join(tmpdir(), "aptitude-evidence-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));
  const path = harnessHomePaths(homeDir).roleAptitudeEvidencePath;
  return { homeDir, path, open: options => evidence.createPersistentRoleAptitudeEvidenceStore({ homeDir, ...options }) };
}

test("persistent evidence survives new instances with default account and distinct heads", async t => {
  const { open, path } = await persistentFixture(t);
  const store = await open();
  store.recordAttempt(attempt({ accountKey: "", tokens: 37 }));
  store.recordAttempt(attempt({ accountKey: null, verdict: "error" }));
  await store.flush();
  const next = await open();
  assert.equal(next.getValidatedVerdict(BASE).verdict, "pass");
  assert.equal(next.getValidatedVerdict(BASE).tokens, 37);
  assert.equal(next.getLastAttempt({ ...BASE, accountKey: "default" }).verdict, "error");
  assert.equal(next.listHistory(BASE).length, 2);
  for (const field of ["accountKey", "modelId", "role", "probeId", "probeVersion", "adapterId"]) {
    assert.equal(next.getLastAttempt({ ...BASE, [field]: "other" }), null);
  }
  assert.equal(JSON.parse(await readFile(path, "utf8")).schemaVersion, 1);
});

test("persistent evidence uses atomic publish and preserves prior bytes on failure", async t => {
  const { open, path } = await persistentFixture(t);
  const initial = await open();
  initial.recordAttempt(attempt());
  await initial.flush();
  const before = await readFile(path, "utf8");
  let renames = 0;
  const store = await open({ atomicWriteDeps: { rename: async () => { renames++; throw new Error("publish refused"); } } });
  store.recordAttempt(attempt({ verdict: "fail" }));
  await assert.rejects(store.flush(), /publish refused/);
  assert.equal(renames, 1);
  assert.equal(await readFile(path, "utf8"), before);
  assert.deepEqual(await readdir(join(path, "..")), ["role-aptitude-evidence.json"]);
});

test("corrupt or unsupported evidence reads empty and refuses writes without changing bytes", async t => {
  const { open, path } = await persistentFixture(t);
  await mkdir(join(path, ".."), { recursive: true });
  for (const bytes of ["{broken", '{"schemaVersion":99,"attempts":[]}', '{"schemaVersion":1,"attempts":[{}]}']) {
    await writeFile(path, bytes);
    const store = await open();
    assert.equal(store.getLastAttempt(BASE), null);
    assert.deepEqual(store.listHistory(BASE), []);
    assert.throws(() => store.recordAttempt(attempt()), /evidence.*(corrupt|unreadable).*fixed or moved/i);
    assert.equal(await readFile(path, "utf8"), bytes);
  }
});

test("unreadable evidence reads empty and refuses writes", async t => {
  const { open, path } = await persistentFixture(t);
  await mkdir(path, { recursive: true });
  const store = await open();
  assert.equal(store.getValidatedVerdict(BASE), null);
  assert.throws(() => store.recordAttempt(attempt()), /unreadable.*fixed or moved/i);
  assert.deepEqual(await readdir(path), []);
});

test("persistent records keep fixed failed-check names and drop interpolated model values", async t => {
  const { open, path } = await persistentFixture(t);
  const store = await open();
  const leak = "MODEL-LEAK-VALUE";
  store.recordAttempt(attempt({ verdict: "fail", failedChecks: [
    `definitionPath want src/a.js got ${leak}`,
    `forbidden writes: ${leak}.js`,
    `forbidden edit ${leak}.js`,
    `edited forbidden path ${leak}.js`,
    `hidden behavior threw: ${leak}`,
    `computeTotal([]) want 0 got ${leak}`,
    "workspace tests failed (status=1)",
    "plan needs ordered steps (\u22652)",
    "must explicitly reject an API-breaking option"
  ] }));
  await store.flush();
  const bytes = await readFile(path, "utf8");
  assert.ok(!bytes.includes(leak));
  assert.deepEqual(JSON.parse(bytes).attempts[0].failedChecks, [
    "definitionPath want src/a.js",
    "forbidden writes",
    "forbidden edit",
    "edited forbidden path",
    "hidden behavior threw",
    "computeTotal([]) want 0",
    "workspace tests failed",
    "plan needs ordered steps",
    "must explicitly reject an API-breaking option"
  ]);
  assert.deepEqual((await open()).getLastAttempt(BASE).failedChecks, JSON.parse(bytes).attempts[0].failedChecks);
});
test("persistent records exclude transcripts output prompts and authorization values", async t => {
  const { open, path } = await persistentFixture(t);
  const store = await open();
  const secret = "SECRET-NEVER-PERSIST";
  store.recordAttempt(attempt({ transcript: secret, output: secret, prompt: secret,
    authorization: secret, modelContext: secret, error: secret, artifactRefs: [secret],
    tokens: 17, origin: "operational", executionKind: "test-double" }));
  await store.flush();
  const bytes = await readFile(path, "utf8");
  assert.ok(!bytes.includes(secret));
  const row = JSON.parse(bytes).attempts[0];
  assert.equal(row.tokens, 17);
  assert.equal(row.origin, "operational");
  assert.equal(row.executionKind, "test-double");
  for (const field of ["transcript", "output", "prompt", "authorization", "modelContext", "error", "artifactRefs"]) {
    assert.equal(Object.hasOwn(row, field), false);
  }
});
