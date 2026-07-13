import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTROL_PLANE_CTA,
  CONTROL_PLANE_HEALTH,
  buildControlPlaneSnapshot,
  resolveControlPlaneCta,
  resolveControlPlaneHealth
} from "../src/global/control-plane-snapshot.js";
import { installGlobalHarness } from "../src/global/global-installer.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageName = "@kal-elsam/kairo-runtime";
const cliVersion = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8")
).version;

test("resolveControlPlaneHealth maps overall states without using intelligence", () => {
  assert.equal(resolveControlPlaneHealth({ state: null, overall: "missing", counts: {} }), CONTROL_PLANE_HEALTH.NOT_CONFIGURED);
  assert.equal(resolveControlPlaneHealth({ state: {}, overall: "drift", counts: {} }), CONTROL_PLANE_HEALTH.ACTION_REQUIRED);
  assert.equal(resolveControlPlaneHealth({ state: {}, overall: "failed", counts: {} }), CONTROL_PLANE_HEALTH.CHECK_FAILED);
  assert.equal(resolveControlPlaneHealth({
    state: {},
    overall: "ok",
    counts: { warning: 2 }
  }), CONTROL_PLANE_HEALTH.HEALTHY_WITH_NOTES);
  assert.equal(resolveControlPlaneHealth({
    state: {},
    overall: "ok",
    counts: { warning: 0 }
  }), CONTROL_PLANE_HEALTH.HEALTHY);
});

test("resolveControlPlaneCta prioritizes setup and repair before idle/runs", () => {
  assert.equal(resolveControlPlaneCta({
    health: CONTROL_PLANE_HEALTH.NOT_CONFIGURED
  }).kind, CONTROL_PLANE_CTA.SETUP);

  assert.equal(resolveControlPlaneCta({
    health: CONTROL_PLANE_HEALTH.ACTION_REQUIRED
  }).kind, CONTROL_PLANE_CTA.REPAIR);

  assert.equal(resolveControlPlaneCta({
    health: CONTROL_PLANE_HEALTH.CHECK_FAILED
  }).kind, CONTROL_PLANE_CTA.VERIFY);

  assert.equal(resolveControlPlaneCta({
    health: CONTROL_PLANE_HEALTH.HEALTHY
  }).kind, CONTROL_PLANE_CTA.IDLE);
});

test("buildControlPlaneSnapshot is read-only and reports NOT_CONFIGURED without state", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-snapshot-"));
  const before = await snapshotFilesystem(homeDir);

  const snapshot = await buildControlPlaneSnapshot({
    homeDir,
    workspaceRoot: homeDir,
    packageName,
    packageRoot,
    cliVersion,
    includeDiff: true,
    includeExplain: false,
    includeRuntime: false
  });

  const after = await snapshotFilesystem(homeDir);
  assert.deepEqual(after, before, "read-only scan must not create or mutate files");
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.health, CONTROL_PLANE_HEALTH.NOT_CONFIGURED);
  assert.equal(snapshot.cta.kind, CONTROL_PLANE_CTA.SETUP);
  assert.equal(snapshot.envelope.overall, "missing");
});

test("buildControlPlaneSnapshot is healthy after install and still write-free on rescan", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-snapshot-ok-"));
  await installGlobalHarness({
    homeDir,
    packageRoot,
    packageName,
    cliVersion,
    adapters: ["cursor"],
    dryRun: false,
    yes: true
  });

  const before = await snapshotFilesystem(homeDir);
  const snapshot = await buildControlPlaneSnapshot({
    homeDir,
    workspaceRoot: homeDir,
    packageName,
    packageRoot,
    cliVersion,
    includeDiff: true,
    includeExplain: true,
    includeRuntime: false
  });
  const after = await snapshotFilesystem(homeDir);

  assert.deepEqual(after, before);
  assert.ok([
    CONTROL_PLANE_HEALTH.HEALTHY,
    CONTROL_PLANE_HEALTH.HEALTHY_WITH_NOTES
  ].includes(snapshot.health));
  assert.ok(snapshot.coverage.detectedAgents >= 0);
  assert.ok(snapshot.backups.count >= 0);
  assert.equal(snapshot.diff?.installed, true);
  assert.ok(snapshot.explain);
  assert.equal(snapshot.cta.kind === CONTROL_PLANE_CTA.IDLE
    || snapshot.cta.kind === CONTROL_PLANE_CTA.REVIEW, true);
});

test("buildControlPlaneSnapshot marks ACTION_REQUIRED when managed content drifts", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-snapshot-drift-"));
  await installGlobalHarness({
    homeDir,
    packageRoot,
    packageName,
    cliVersion,
    adapters: ["cursor"],
    dryRun: false,
    yes: true
  });

  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(homeDir, ".harness", "components", "sdd-core", "workflow.md"), "tampered");

  const before = await snapshotFilesystem(homeDir);
  const snapshot = await buildControlPlaneSnapshot({
    homeDir,
    workspaceRoot: homeDir,
    packageName,
    packageRoot,
    cliVersion,
    includeDiff: true,
    includeExplain: false,
    includeRuntime: false
  });
  const after = await snapshotFilesystem(homeDir);

  assert.deepEqual(after, before);
  assert.equal(snapshot.health, CONTROL_PLANE_HEALTH.ACTION_REQUIRED);
  assert.equal(snapshot.cta.kind, CONTROL_PLANE_CTA.REPAIR);
  assert.equal(snapshot.status.overall, "drift");
});

async function snapshotFilesystem(root) {
  const entries = [];
  async function walk(dir) {
    const names = await readdir(dir).catch(() => []);
    for (const name of names.sort()) {
      const full = join(dir, name);
      const info = await stat(full);
      if (info.isDirectory()) {
        entries.push(`${full}/`);
        await walk(full);
      } else {
        const body = await readFile(full, "utf8").catch(() => "");
        entries.push(`${full}:${info.size}:${body.length}`);
      }
    }
  }
  await walk(root);
  return entries;
}
