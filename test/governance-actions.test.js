import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { installGlobalHarness } from "../src/global/global-installer.js";
import {
  applyGovernanceRollback,
  applyGovernanceSync,
  fingerprintGovernancePreview,
  previewGovernanceRollback,
  previewGovernanceSync
} from "../src/global/governance-actions.js";
import { needsManagedRepair } from "../src/global/governance-repair.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { readHistoryEvents } from "../src/global/history.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = {
  packageRoot,
  packageName: "@kal-elsam/kairo-runtime",
  cliVersion: "0.5.0-dev"
};

async function home() {
  const homeDir = await mkdtemp(join(tmpdir(), "gov-act-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });
  return homeDir;
}

test("needsManagedRepair includes integration warnings", () => {
  assert.equal(needsManagedRepair({
    overall: "ok",
    counts: { missing: 0, stale: 0 },
    checks: [{ componentId: "sdd-core", category: "integration", status: "warning" }]
  }), true);
  assert.equal(needsManagedRepair({
    overall: "ok",
    counts: { missing: 0, stale: 0 },
    checks: []
  }), false);
});

test("previewGovernanceSync is read-only and fingerprints; cancel twin is byte-identical", async () => {
  const homeDir = await home();
  try {
    await installGlobalHarness({ ...base, homeDir });
    const workflow = join(harnessHomePaths(homeDir).root, "components/sdd-core/workflow.md");
    await rm(workflow, { force: true });

    const stateBefore = await readFile(harnessHomePaths(homeDir).statePath);
    const a = await previewGovernanceSync({ ...base, homeDir });
    const b = await previewGovernanceSync({ ...base, homeDir });
    assert.equal(a.wrote, false);
    assert.equal(a.hasChanges, true);
    assert.equal(a.fingerprint, b.fingerprint);
    assert.equal(a.fingerprint, fingerprintGovernancePreview({
      kind: a.kind,
      action: a.action,
      setupRequired: a.setupRequired,
      hasChanges: a.hasChanges,
      changes: a.changes,
      integrations: a.integrations,
      checksBefore: a.checksBefore,
      overall: a.overall
    }));
    assert.equal(existsSync(harnessHomePaths(homeDir).historyPath), false);
    assert.deepEqual(await readFile(harnessHomePaths(homeDir).statePath), stateBefore);
    assert.equal(existsSync(workflow), false);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("stale preview is rejected before writes; confirmed apply repairs and records history", async () => {
  const homeDir = await home();
  try {
    await installGlobalHarness({ ...base, homeDir });
    const workflow = join(harnessHomePaths(homeDir).root, "components/sdd-core/workflow.md");
    await rm(workflow, { force: true });

    const preview = await previewGovernanceSync({ ...base, homeDir });
    await writeFile(workflow, "partial-user-repair\n", "utf8");

    const stale = await applyGovernanceSync({ preview, ...base, homeDir });
    assert.equal(stale.ok, false);
    assert.equal(stale.reason, "stale-preview");
    assert.equal(stale.wrote, false);
    assert.equal(existsSync(harnessHomePaths(homeDir).historyPath), false);

    const fresh = await previewGovernanceSync({ ...base, homeDir });
    const applied = await applyGovernanceSync({ preview: fresh, ...base, homeDir });
    assert.equal(applied.ok, true);
    assert.equal(applied.wrote, true);
    assert.equal(applied.receipt.action, "repaired");
    assert.ok(Array.isArray(applied.receipt.backups));
    assert.ok(applied.receipt.checksBefore);
    assert.ok(applied.receipt.checksAfter);
    const history = await readHistoryEvents(homeDir, { command: "sync" });
    assert.ok(history.events.some((event) => event.action === "repaired"));
    assert.equal(await readFile(workflow, "utf8"), await readFile(
      join(packageRoot, "global-template/components/sdd-core/workflow.md"),
      "utf8"
    ));
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("rollback preview/cancel/apply revalidates fingerprint and records safety backup", async () => {
  const homeDir = await home();
  try {
    await writeFile(join(homeDir, ".cursor/AGENTS.md"), "# user owned\n", "utf8");
    await installGlobalHarness({ ...base, homeDir });
    const paths = harnessHomePaths(homeDir);
    const snapshots = await readdir(paths.backupsDir);
    assert.ok(snapshots.length > 0);
    const snapshot = snapshots.sort().at(-1);

    const preview = await previewGovernanceRollback({ homeDir, snapshot });
    assert.equal(preview.wrote, false);
    assert.equal(preview.kind, "rollback");
    assert.ok(preview.fingerprint);

    const cancelTwin = await previewGovernanceRollback({ homeDir, snapshot });
    assert.equal(preview.fingerprint, cancelTwin.fingerprint);

    const cursor = join(homeDir, ".cursor/AGENTS.md");
    const before = await readFile(cursor, "utf8");
    await writeFile(cursor, `${before}\n# drift\n`, "utf8");

    const applied = await applyGovernanceRollback({
      preview,
      homeDir,
      cliVersion: base.cliVersion
    });
    assert.equal(applied.ok, true);
    assert.equal(applied.wrote, true);
    assert.equal(applied.receipt.action, "rollback");
    assert.ok(applied.receipt.safetyBackup);
    const history = await readHistoryEvents(homeDir, { command: "rollback" });
    assert.ok(history.events.some((event) => event.action === "applied"));
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
