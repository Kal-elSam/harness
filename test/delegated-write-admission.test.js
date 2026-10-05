/**
 * Strict verified-write floor is opt-in; source_declared ≠ verified_effective.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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
import { RUN_STATES } from "../src/global/runtime/run-types.js";
import { withStubExecutables } from "./helpers/stub-executables.js";

function fakeSpawn(lines = []) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 42;
    child.kill = () => child.emit("close", 0);
    setImmediate(() => {
      for (const line of lines) child.stdout.emit("data", `${line}\n`);
      child.emit("close", 0);
    });
    return child;
  };
}

test("matrix: Codex is source_declared only — not verified_effective; others unverified or read-only", () => {
  const matrix = listDelegatedWriteAdmissionMatrix();
  assert.deepEqual(
    matrix.map((e) => e.adapterId).sort(),
    ["claude", "codex", "cursor", "opencode", "pi"]
  );
  assert.equal(DELEGATED_WRITE_ADMISSION.codex.status, WRITE_CONTAINMENT_STATUS.SOURCE_DECLARED);
  assert.equal(DELEGATED_WRITE_ADMISSION.codex.verifiedEffective, false);
  assert.notEqual(
    DELEGATED_WRITE_ADMISSION.codex.status,
    WRITE_CONTAINMENT_STATUS.VERIFIED_EFFECTIVE
  );
  for (const id of ["claude", "cursor", "opencode"]) {
    assert.equal(getDelegatedWriteAdmission(id).status, WRITE_CONTAINMENT_STATUS.UNVERIFIED);
    assert.equal(getDelegatedWriteAdmission(id).verifiedEffective, false);
  }
  assert.equal(DELEGATED_WRITE_ADMISSION.pi.status, WRITE_CONTAINMENT_STATUS.READ_ONLY_ONLY);
});

test("strict floor: source_declared Codex does not launch without verified_effective evidence", () => {
  assert.throws(
    () => assertDelegatedWriteAdmission("codex", { cwd: "/tmp/wt/tree", permissions: [] }),
    (error) => error instanceof DelegatedWriteAdmissionError
      && error.code === "delegated_write_admission_denied"
      && error.details?.verifiedEffective === false
  );
});

test("strict floor: force/yolo bypass is rejected even when consent would otherwise allow it", () => {
  assert.throws(
    () => assertDelegatedWriteAdmission("codex", {
      cwd: "/tmp/wt/tree",
      permissions: ["yolo"]
    }),
    (error) => error instanceof DelegatedWriteAdmissionError
      && error.code === "delegated_write_bypass_forbidden"
  );
  assert.throws(
    () => assertDelegatedWriteAdmission("claude", {
      cwd: "/tmp/project",
      permissions: ["force"]
    }),
    (error) => error.code === "delegated_write_bypass_forbidden"
  );
});

test("strict floor: unverified adapters do not launch", () => {
  for (const id of ["claude", "cursor", "opencode", "opencode-go", "pi"]) {
    assert.throws(
      () => assertDelegatedWriteAdmission(id, { cwd: "/tmp/project", permissions: [] }),
      DelegatedWriteAdmissionError
    );
  }
});

test("ordinary startRun without requireVerifiedWriteContainment still launches Claude", async () => {
  await withStubExecutables(["claude"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-admit-ordinary-claude-"));
    const { completion } = await startRun({
      homeDir,
      agentId: "claude",
      task: "Implement",
      cwd: homeDir,
      cliVersion: "0.2.1",
      requireVerifiedWriteContainment: false,
      resolveAdapterImpl: () => ({
        id: "claude",
        label: "Claude",
        availability: () => ({ available: true, launchable: true, reason: null }),
        preflight: async () => ({ ok: true }),
        buildLaunch: () => ({ command: "claude", args: ["-p", "Implement"], cwd: homeDir }),
        parseEventLine: () => null,
        capabilities: {}
      }),
      spawnImpl: fakeSpawn([])
    });
    assert.equal((await completion).state, RUN_STATES.COMPLETED);
  });
});

test("startRun with requireVerifiedWriteContainment refuses Codex source_declared and does not spawn", async () => {
  await withStubExecutables(["codex"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-admit-strict-codex-"));
    await assert.rejects(
      () => startRun({
        homeDir,
        agentId: "codex",
        task: "Implement",
        cwd: homeDir,
        cliVersion: "0.2.1",
        requireVerifiedWriteContainment: true,
        allowUnsafePermissions: true,
        permissions: ["yolo"],
        spawnImpl: () => {
          throw new Error("spawn must not run under strict floor");
        }
      }),
      (error) => error instanceof DelegatedWriteAdmissionError
        && (error.code === "delegated_write_bypass_forbidden"
          || error.code === "delegated_write_admission_denied")
    );
  });
});

test("startRun with requireVerifiedWriteContainment refuses unverified OpenCode", async () => {
  await withStubExecutables(["opencode"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-admit-strict-opencode-"));
    await assert.rejects(
      () => startRun({
        homeDir,
        agentId: "opencode-go",
        task: "task",
        cwd: homeDir,
        cliVersion: "0.2.1",
        requireVerifiedWriteContainment: true,
        spawnImpl: () => {
          throw new Error("spawn must not run");
        }
      }),
      (error) => error instanceof DelegatedWriteAdmissionError
        && error.code === "delegated_write_admission_denied"
    );
  });
});
