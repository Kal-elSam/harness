/**
 * E1 — owned role-aptitude evidence store + pending projection.
 * Offline only: no provider calls. Synthetic attempts only.
 */
import test from "node:test";
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
  const otherRole = { ...BASE, role: "Tester", probeId: "tester.edge-coverage-v1" };
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
