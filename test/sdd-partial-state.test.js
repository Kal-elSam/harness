import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runComponentsConfigure, runComponentsRollback
} from "../src/global/component-integration-cli.js";
import { applySddConfigure } from "../src/global/integrations/sdd-apply.js";
import { SDD_FILE_OUTCOMES } from "../src/global/integrations/sdd-evidence.js";
import { resolveSddSkillPath } from "../src/global/integrations/sdd-destinations.js";
import { saveSddReceipt } from "../src/global/integrations/sdd-receipts.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { readGlobalState, writeGlobalState } from "../src/global/state.js";
import {
  hasSuccessfulSddRollbackMutations, recordSddMaterialization,
  reconcileSddStateAfterRollback, shouldTrackSddReceiptFile
} from "../src/global/integrations/sdd-state.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = (n) => mkdtempSync(join(process.cwd(), n));

const applied = (path, skillId, agents, hash, extra = {}) => ({
  destinationPath: path, skillId, agentIds: agents, action: "create",
  applied: true, afterHash: hash, outcome: SDD_FILE_OUTCOMES.APPLIED, ...extra
});

test("partial apply evidence; state tracks only applied/verified noop", async () => {
  const homeDir = tmp(".tmp-sdd-partial-");
  try {
    const blocked = join(homeDir, ".agents", "skills", "sdd-explore");
    mkdirSync(dirname(blocked), { recursive: true });
    writeFileSync(blocked, "not-a-directory");

    const partial = await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, yes: true, receiptId: "sdd-partial-1"
    });
    assert.equal(partial.receipt.partial, true);
    assert.ok(partial.receipt.files.some((f) => f.outcome === SDD_FILE_OUTCOMES.APPLIED));
    assert.ok(partial.receipt.files.some((f) => f.outcome === SDD_FILE_OUTCOMES.FAILED));
    assert.ok(partial.receipt.files.some((f) => f.outcome === SDD_FILE_OUTCOMES.SKIPPED));

    const tracked = recordSddMaterialization({}, { receipt: partial.receipt, now: () => "t0" });
    assert.ok(tracked.sdd.files.length > 0);
    assert.ok(!tracked.sdd.files.some((f) => f.destinationPath === resolveSddSkillPath("sdd-explore", "codex", homeDir)));
    assert.equal(shouldTrackSddReceiptFile({ outcome: SDD_FILE_OUTCOMES.FAILED, afterHash: "x" }), false);
    assert.equal(shouldTrackSddReceiptFile({ outcome: SDD_FILE_OUTCOMES.SKIPPED }), false);
    assert.equal(shouldTrackSddReceiptFile({ outcome: SDD_FILE_OUTCOMES.CONFLICT }), false);
    assert.equal(shouldTrackSddReceiptFile({ action: "create", afterHash: "legacy" }), false);
    assert.equal(shouldTrackSddReceiptFile({
      outcome: SDD_FILE_OUTCOMES.NOOP, afterHash: "abc", canonicalHash: "xyz"
    }), false);
    assert.equal(shouldTrackSddReceiptFile({
      outcome: SDD_FILE_OUTCOMES.NOOP, afterHash: "abc", canonicalHash: "abc"
    }), true);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("partial rollback reconciles successful actions and refreshes metadata", () => {
  const receipt = {
    id: "sdd-rb", persona: "teaching", agentIds: ["codex", "claude"],
    files: [
      applied("/h/a/SKILL.md", "sdd-init", ["codex"], "new-a"),
      applied("/h/b/SKILL.md", "sdd-spec", ["claude"], "new-b", {
        action: "update", beforeHash: "old-b"
      }),
      applied("/h/c/SKILL.md", "sdd-tasks", ["codex"], "new-c")
    ],
    backups: [{ path: "/h/b/SKILL.md", beforeHash: "old-b" }]
  };
  const prior = recordSddMaterialization({}, { receipt, now: () => "t0" });
  assert.equal(prior.sdd.persona, "teaching");
  assert.deepEqual(prior.sdd.agentIds, ["claude", "codex"]);

  const actions = [
    { path: "/h/a/SKILL.md", action: "delete", ok: true },
    { path: "/h/b/SKILL.md", action: "restore", ok: true },
    { path: "/h/c/SKILL.md", action: "delete", ok: false, reason: "hash mismatch" },
    { path: "/missing", action: "delete", ok: true },
    { path: "/absent-restore", action: "restore", ok: true }
  ];
  assert.equal(hasSuccessfulSddRollbackMutations(actions), true);
  assert.equal(hasSuccessfulSddRollbackMutations([
    { path: "/h/c/SKILL.md", action: "delete", ok: false }
  ]), false);

  const next = reconcileSddStateAfterRollback(prior, { receipt, actions, now: () => "t1" });
  assert.deepEqual(next.sdd.files, [
    { destinationPath: "/h/b/SKILL.md", skillId: "sdd-spec", agentIds: ["claude"], hash: "old-b", action: "update" },
    { destinationPath: "/h/c/SKILL.md", skillId: "sdd-tasks", agentIds: ["codex"], hash: "new-c", action: "create" }
  ]);
  assert.deepEqual(next.sdd.agentIds, ["claude", "codex"]);
  assert.equal(next.sdd.persona, "teaching");

  const again = reconcileSddStateAfterRollback(next, { receipt, actions, now: () => "t1" });
  assert.deepEqual(again.sdd, next.sdd);

  const empty = reconcileSddStateAfterRollback(next, {
    receipt,
    actions: [
      { path: "/h/b/SKILL.md", action: "delete", ok: true },
      { path: "/h/c/SKILL.md", action: "delete", ok: true }
    ],
    now: () => "t2"
  });
  assert.deepEqual(empty.sdd.files, []);
  assert.deepEqual(empty.sdd.agentIds, []);
  assert.equal(empty.sdd.persona, "off");
});

test("materialization agentIds come from admitted files; conflicts alone clear persona", () => {
  const partialAgents = recordSddMaterialization({}, {
    receipt: {
      id: "sdd-partial-agents", persona: "teaching", agentIds: ["codex", "claude"],
      files: [
        applied("/h/codex/SKILL.md", "sdd-init", ["codex"], "hash-a"),
        {
          destinationPath: "/h/claude/SKILL.md", skillId: "sdd-init", agentIds: ["claude"],
          action: "create", applied: false, outcome: SDD_FILE_OUTCOMES.FAILED, error: "boom"
        }
      ]
    },
    now: () => "t0"
  });
  assert.deepEqual(partialAgents.sdd.files.map((f) => f.destinationPath), ["/h/codex/SKILL.md"]);
  assert.deepEqual(partialAgents.sdd.agentIds, ["codex"]);
  assert.equal(partialAgents.sdd.persona, "teaching");

  const onlyConflicts = recordSddMaterialization({}, {
    receipt: {
      id: "sdd-conflicts", persona: "teaching", agentIds: ["codex", "claude"],
      files: [
        {
          destinationPath: "/h/a/SKILL.md", skillId: "sdd-init", agentIds: ["codex"],
          action: "conflict", outcome: SDD_FILE_OUTCOMES.CONFLICT
        },
        {
          destinationPath: "/h/b/SKILL.md", skillId: "sdd-spec", agentIds: ["claude"],
          action: "conflict", outcome: SDD_FILE_OUTCOMES.CONFLICT
        }
      ]
    },
    now: () => "t1"
  });
  assert.deepEqual(onlyConflicts.sdd.files, []);
  assert.deepEqual(onlyConflicts.sdd.agentIds, []);
  assert.equal(onlyConflicts.sdd.persona, "off");
});

test("CLI handlers persist partial configure and reconcile failed rollback mutations", async () => {
  const homeDir = tmp(".tmp-sdd-cli-h-");
  const prevHome = process.env.HARNESS_HOME;
  const prevExit = process.exitCode;
  process.env.HARNESS_HOME = homeDir;
  try {
    const paths = harnessHomePaths(homeDir);
    mkdirSync(dirname(paths.statePath), { recursive: true });
    await writeGlobalState(paths.statePath, { version: 1, components: [{ id: "sdd-core" }] });

    const receipt = {
      id: "sdd-cli-partial", persona: "teaching", agentIds: ["codex", "claude"],
      ok: false, partial: true,
      files: [
        applied("/h/a/SKILL.md", "sdd-init", ["codex"], "hash-a"),
        {
          destinationPath: "/h/fail/SKILL.md", skillId: "sdd-explore", agentIds: ["claude"],
          action: "create", applied: false, outcome: SDD_FILE_OUTCOMES.FAILED, error: "boom"
        }
      ]
    };

    await runComponentsConfigure({
      componentId: "sdd-core", yes: true, json: true,
      provider: { apply: async () => ({ receipt, dryRun: false, cancelled: false }) }
    });
    let state = await readGlobalState(paths.statePath);
    assert.deepEqual(state.sdd.files.map((f) => f.destinationPath), ["/h/a/SKILL.md"]);
    assert.deepEqual(state.sdd.agentIds, ["codex"]);
    assert.equal(state.sdd.persona, "teaching");

    await saveSddReceipt(receipt, { homeDir });
    await runComponentsRollback({
      componentId: "sdd-core", receiptId: receipt.id, yes: true, json: true,
      provider: {
        rollback: async () => ({
          ok: false, dryRun: false, cancelled: false, blocked: false, receiptId: receipt.id,
          actions: [
            { path: "/h/a/SKILL.md", action: "delete", ok: true },
            { path: "/h/other/SKILL.md", action: "restore", ok: false, reason: "missing backup" }
          ]
        })
      }
    });
    state = await readGlobalState(paths.statePath);
    assert.deepEqual(state.sdd.files, []);
    assert.deepEqual(state.sdd.agentIds, []);
    assert.equal(state.sdd.persona, "off");
  } finally {
    process.exitCode = prevExit;
    if (prevHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = prevHome;
    rmSync(homeDir, { recursive: true, force: true });
  }
});
