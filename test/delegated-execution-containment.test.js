/**
 * Contract: delegated execution containment (authorized writes) is not Bootstrap isolation.
 * Pins cwd/worktree binding + Codex workspace-write default without importing Bootstrap SBPL claims.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import codex from "../src/global/runtime/execution-adapters/codex.js";
import { authorizeRunPermissions, PermissionAuthorityError } from "../src/global/runtime/run-permissions.js";
import { assertWorktreeId, worktreePaths } from "../src/global/paths.js";

const here = dirname(fileURLToPath(import.meta.url));
const bootstrapDoc = readFileSync(join(here, "../docs/bootstrap-isolation.md"), "utf8");
const delegatedDoc = readFileSync(join(here, "../docs/delegated-execution-containment.md"), "utf8");
const orchestratorSrc = readFileSync(
  join(here, "../src/global/runtime/execution-worktree-orchestrator.js"),
  "utf8"
);

test("docs separate Bootstrap investigation confinement from delegated authorized-write containment", () => {
  assert.match(bootstrapDoc, /delegated-execution-containment\.md/);
  assert.match(bootstrapDoc, /Do not cite Bootstrap canaries/);
  assert.match(delegatedDoc, /bootstrap-isolation\.md/);
  assert.match(delegatedDoc, /Never reuse Bootstrap/);
  assert.match(delegatedDoc, /workspace-write/);
  assert.doesNotMatch(delegatedDoc, /isolation:\s*"verified"/);
});

test("Codex delegated default authorizes workspace writes — not Bootstrap sandbox-exec args", () => {
  const launch = codex.buildLaunch({ task: "Implement plan", cwd: "/repo/worktree", permissions: [] });
  assert.ok(launch.args.includes("--sandbox"));
  assert.ok(launch.args.includes("workspace-write"));
  assert.equal(launch.args.includes("sandbox-exec"), false);
  assert.equal(launch.args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
  assert.equal(launch.cwd, "/repo/worktree");
});

test("Codex yolo elevated writes stay consent-gated at permission authority, not Bootstrap", () => {
  assert.throws(
    () => authorizeRunPermissions({
      permissions: ["yolo"],
      agentId: "codex",
      allowUnsafePermissions: false,
      source: "cli"
    }),
    (error) => error instanceof PermissionAuthorityError && error.code === "unsafe_consent_required"
  );
  const authorized = authorizeRunPermissions({
    permissions: ["yolo"],
    agentId: "codex",
    allowUnsafePermissions: true,
    source: "cli"
  });
  assert.deepEqual(authorized.permissions, ["yolo"]);
  const launch = codex.buildLaunch({
    task: "Implement plan",
    cwd: "/repo/worktree",
    permissions: authorized.permissions
  });
  assert.ok(launch.args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.equal(launch.args.includes("workspace-write"), false);
});

test("execution worktree paths stay under harness worktreesDir (authorized write root)", () => {
  assert.throws(() => assertWorktreeId("../escape"), /Invalid worktree id/);
  const paths = worktreePaths("/tmp/home", "wt_role_1");
  assert.equal(paths.treePath, "/tmp/home/.harness/worktrees/wt_role_1/tree");
  assert.match(paths.treePath, /\.harness\/worktrees\/wt_role_1\/tree$/);
});

test("orchestrated delegated chain binds startRun cwd to worktree treePath, not Bootstrap snapshot", () => {
  assert.match(orchestratorSrc, /cwd:\s*initial\.treePath/);
  assert.doesNotMatch(orchestratorSrc, /runCodexSandboxedBootstrap|runCursorSandboxedBootstrap|sandbox-exec/);
  assert.doesNotMatch(orchestratorSrc, /snapshotRoot/);
});
