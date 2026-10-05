/**
 * Admission matrix + fail-closed launch rules for delegated authorized writes.
 * Complements docs/delegated-execution-containment.md (path model).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DELEGATED_WRITE_ADMISSION,
  WRITE_CONTAINMENT_STATUS,
  assertDelegatedWriteAdmission,
  getDelegatedWriteAdmission,
  listDelegatedWriteAdmissionMatrix,
  DelegatedWriteAdmissionError
} from "../src/global/runtime/delegated-write-admission.js";
import { startRun } from "../src/global/runtime/run-manager.js";
import { withStubExecutables } from "./helpers/stub-executables.js";

test("admission matrix: only Codex is source_declared eligible; others unverified or read-only", () => {
  const matrix = listDelegatedWriteAdmissionMatrix();
  assert.deepEqual(
    matrix.map((e) => e.adapterId).sort(),
    ["claude", "codex", "cursor", "opencode", "pi"]
  );
  assert.equal(DELEGATED_WRITE_ADMISSION.codex.status, WRITE_CONTAINMENT_STATUS.SOURCE_DECLARED);
  assert.equal(DELEGATED_WRITE_ADMISSION.codex.mayLaunchAuthorizedWrite, true);
  assert.equal(DELEGATED_WRITE_ADMISSION.codex.verifiedEffective, false);
  for (const id of ["claude", "cursor", "opencode"]) {
    assert.equal(getDelegatedWriteAdmission(id).status, WRITE_CONTAINMENT_STATUS.UNVERIFIED);
    assert.equal(getDelegatedWriteAdmission(id).mayLaunchAuthorizedWrite, false);
  }
  assert.equal(DELEGATED_WRITE_ADMISSION.pi.status, WRITE_CONTAINMENT_STATUS.READ_ONLY_ONLY);
});

test("unverified adapters do not pass assertDelegatedWriteAdmission", () => {
  for (const id of ["claude", "cursor", "opencode", "opencode-go"]) {
    assert.throws(
      () => assertDelegatedWriteAdmission(id, { cwd: "/tmp/project", permissions: [] }),
      (error) => error instanceof DelegatedWriteAdmissionError
        && error.code === "delegated_write_admission_denied"
    );
  }
});

test("Codex source_declared launches only with cwd; empty cwd fails closed", () => {
  assert.throws(
    () => assertDelegatedWriteAdmission("codex", { cwd: "", permissions: [] }),
    (error) => error instanceof DelegatedWriteAdmissionError
      && error.code === "delegated_write_admission_cwd_required"
  );
  const ok = assertDelegatedWriteAdmission("codex", { cwd: "/tmp/wt/tree", permissions: [] });
  assert.equal(ok.launchKind, "authorized_write");
  assert.equal(ok.verifiedEffective, false);
  assert.equal(ok.status, WRITE_CONTAINMENT_STATUS.SOURCE_DECLARED);
});

test("Pi read-only may launch; Pi without read-only is denied for writes", () => {
  const readOnly = assertDelegatedWriteAdmission("pi", {
    cwd: "/tmp/project",
    permissions: ["read-only"]
  });
  assert.equal(readOnly.launchKind, "read_only");
  assert.throws(
    () => assertDelegatedWriteAdmission("pi", { cwd: "/tmp/project", permissions: [] }),
    DelegatedWriteAdmissionError
  );
});

test("startRun refuses unverified Claude before spawn (no WorkResult fabricated)", async () => {
  await withStubExecutables(["claude"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-admit-claude-"));
    await assert.rejects(
      () => startRun({
        homeDir,
        agentId: "claude",
        task: "Implement",
        cwd: homeDir,
        cliVersion: "0.2.1",
        spawnImpl: () => {
          throw new Error("spawn must not run");
        }
      }),
      (error) => error instanceof DelegatedWriteAdmissionError
        && error.code === "delegated_write_admission_denied"
    );
  });
});

test("startRun refuses unverified OpenCode before spawn", async () => {
  await withStubExecutables(["opencode"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-admit-opencode-"));
    await assert.rejects(
      () => startRun({
        homeDir,
        agentId: "opencode-go",
        task: "task",
        cwd: homeDir,
        cliVersion: "0.2.1",
        spawnImpl: () => {
          throw new Error("spawn must not run");
        }
      }),
      DelegatedWriteAdmissionError
    );
  });
});
