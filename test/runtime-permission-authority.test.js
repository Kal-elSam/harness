import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli.js";
import {
  PERMISSION_MODES,
  PermissionAuthorityError,
  authorizeRunPermissions,
  normalizePermissions,
  validateDefaultPermissions
} from "../src/global/runtime/run-permissions.js";
import { validateRuntimeProfile } from "../src/global/runtime/run-profile.js";
import { startRun } from "../src/global/runtime/run-manager.js";
import { readRunState } from "../src/global/runtime/run-store.js";
import { withStubExecutables } from "./helpers/stub-executables.js";

function fakeSpawn() {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 7;
    child.kill = () => child.emit("close", 0);
    setImmediate(() => child.emit("close", 0));
    return child;
  };
}

test("normalize: all→force, dangerously-*→yolo, read-only safe, unknown fails", () => {
  assert.deepEqual(normalizePermissions(["all"]), ["force"]);
  assert.deepEqual(
    normalizePermissions(["dangerously-skip-permissions", "dangerously-bypass-approvals-and-sandbox"]),
    ["yolo"]
  );
  assert.deepEqual(normalizePermissions(["read-only"]), ["read-only"]);
  assert.throws(() => normalizePermissions(["sudo"]), PermissionAuthorityError);
});

test("yolo without consent is rejected", () => {
  assert.throws(
    () => authorizeRunPermissions({
      permissions: ["yolo"], agentId: "codex", allowUnsafePermissions: false, source: "cli"
    }),
    (e) => e instanceof PermissionAuthorityError && /allow-unsafe-permissions/i.test(e.message)
  );
});

test("force from profile defaultPermissions is rejected", () => {
  assert.throws(() => validateDefaultPermissions(["force"]), PermissionAuthorityError);
  assert.throws(
    () => validateRuntimeProfile({ defaultPermissions: ["yolo"] }),
    /defaultPermissions|unsafe|force|yolo/i
  );
  assert.doesNotThrow(() => validateRuntimeProfile({ defaultPermissions: [] }));
  assert.doesNotThrow(() => validateRuntimeProfile({ defaultPermissions: ["read-only"] }));
});

test("unknown permission and adapter-unsupported mode are rejected", () => {
  assert.throws(
    () => authorizeRunPermissions({
      permissions: ["mystery"], agentId: "cursor", allowUnsafePermissions: true, source: "cli"
    }),
    PermissionAuthorityError
  );
  assert.throws(
    () => authorizeRunPermissions({
      permissions: ["force"], agentId: "codex", allowUnsafePermissions: true, source: "cli"
    }),
    (e) => e instanceof PermissionAuthorityError && /codex|supported|incompatible/i.test(e.message)
  );
  assert.throws(
    () => authorizeRunPermissions({
      permissions: ["yolo"], agentId: "pi", allowUnsafePermissions: true, source: "cli"
    }),
    PermissionAuthorityError
  );
});

test("startRun cannot bypass the gate; consent records metadata without secrets", async () => {
  await withStubExecutables(["codex"], async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "kairo-perm-auth-"));
    await assert.rejects(
      () => startRun({
        homeDir, agentId: "codex", task: "x", cwd: homeDir, cliVersion: "0.11.0",
        permissions: ["yolo"], spawnImpl: fakeSpawn()
      }),
      PermissionAuthorityError
    );

    const { runId, completion } = await startRun({
      homeDir, agentId: "codex", task: "x", cwd: homeDir, cliVersion: "0.11.0",
      permissions: ["yolo"], allowUnsafePermissions: true, permissionSource: "cli",
      spawnImpl: fakeSpawn()
    });
    const final = await completion;
    const saved = await readRunState(homeDir, runId);
    assert.equal(final.state, "completed");
    assert.equal(saved.permissionAuthority.mode, PERMISSION_MODES.UNSAFE);
    assert.equal(saved.permissionAuthority.source, "cli");
    assert.equal(saved.permissionAuthority.consent, "allow-unsafe-permissions");
    assert.deepEqual(saved.permissions, ["yolo"]);
    const blob = JSON.stringify(saved);
    assert.doesNotMatch(blob, /"prompt"\s*:|"apiKey"\s*:|"secret"\s*:|"password"\s*:|"transcript"\s*:/);
    assert.equal(saved.captureTranscript, false);
  });
});

test("safe/normal consent adds no friction; CLI flag wires through", () => {
  const normal = authorizeRunPermissions({
    permissions: [], agentId: "cursor", allowUnsafePermissions: false, source: "cli"
  });
  assert.equal(normal.permissionAuthority.mode, PERMISSION_MODES.NORMAL);
  assert.equal(normal.permissionAuthority.consent, "none");

  const safe = authorizeRunPermissions({
    permissions: ["read-only"], agentId: "pi", allowUnsafePermissions: false, source: "cli"
  });
  assert.equal(safe.permissionAuthority.mode, PERMISSION_MODES.SAFE);
  assert.equal(safe.permissionAuthority.consent, "none");

  const parsed = parseArgs(["run", "--agent", "codex", "--task", "t", "--permissions", "yolo",
    "--allow-unsafe-permissions"]);
  assert.equal(parsed.options.allowUnsafePermissions, true);
  assert.deepEqual(parsed.options.permissions, ["yolo"]);
});
