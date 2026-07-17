import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashBuffer } from "../src/hash.js";
import { applySddConfigure } from "../src/global/integrations/sdd-apply.js";
import { resolveCanonicalSddSkillPath, resolveSddSkillPath } from "../src/global/integrations/sdd-destinations.js";
import { listSddReceipts, loadSddReceipt, sddIntegrationsDir } from "../src/global/integrations/sdd-receipts.js";
import { recordSddMaterialization } from "../src/global/integrations/sdd-state.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = (name) => mkdtempSync(join(process.cwd(), name));

test("dry-run apply performs no writes or receipts", async () => {
  const homeDir = home(".tmp-sdd-apply-dry-");
  try {
    const result = await applySddConfigure({ requestedAgentIds: ["codex"], homeDir, packageRoot, dryRun: true });
    assert.equal(result.applied, false);
    assert.equal(result.writes, false);
    assert.equal(result.receipt, null);
    assert.equal(existsSync(sddIntegrationsDir(homeDir)), false);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("apply materializes once per shared root, keeps receipt, and second pass is noop", async () => {
  const homeDir = home(".tmp-sdd-apply-write-");
  try {
    const first = await applySddConfigure({
      requestedAgentIds: ["codex", "opencode", "cursor", "claude"],
      homeDir, packageRoot, yes: true, receiptId: "sdd-first"
    });
    assert.equal(first.applied && first.writes && first.sessionRefreshRequired, true);
    assert.equal(first.receipt.files.filter((entry) => entry.applied).length, 18);
    const canonical = readFileSync(resolveCanonicalSddSkillPath("sdd-init", packageRoot));
    assert.equal(hashBuffer(readFileSync(resolveSddSkillPath("sdd-init", "codex", homeDir))), hashBuffer(canonical));
    assert.equal(hashBuffer(readFileSync(resolveSddSkillPath("sdd-init", "claude", homeDir))), hashBuffer(canonical));
    assert.deepEqual(await listSddReceipts({ homeDir }), ["sdd-first"]);
    assert.equal((await loadSddReceipt("sdd-first", { homeDir })).ok, true);
    const tracked = Object.fromEntries(
      first.receipt.files.filter((e) => e.afterHash).map((e) => [e.destinationPath, e.afterHash])
    );
    const second = await applySddConfigure({
      requestedAgentIds: ["codex", "opencode", "cursor", "claude"],
      homeDir, packageRoot, yes: true, receiptId: "sdd-second", trackedFiles: tracked
    });
    assert.equal(second.writes, false);
    assert.equal(second.summary.noop, 18);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("apply preserves untracked files, demands consent, and rechecks UPDATE TOCTOU", async () => {
  const homeDir = home(".tmp-sdd-apply-guard-");
  try {
    const userPath = resolveSddSkillPath("sdd-spec", "codex", homeDir);
    mkdirSync(dirname(userPath), { recursive: true });
    writeFileSync(userPath, "user owned untracked\n");
    await assert.rejects(
      () => applySddConfigure({ requestedAgentIds: ["codex"], homeDir, packageRoot, interactive: false }),
      /requires --yes/
    );
    const conflicted = await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, yes: true, receiptId: "sdd-guard"
    });
    assert.equal(readFileSync(userPath, "utf8"), "user owned untracked\n");
    assert.equal(conflicted.receipt.files.find((e) => e.destinationPath === userPath).action, "conflict");

    const updatePath = resolveSddSkillPath("sdd-apply", "codex", homeDir);
    mkdirSync(dirname(updatePath), { recursive: true });
    writeFileSync(updatePath, "edited after plan\n");
    const trackedHash = hashBuffer(Buffer.from("stale tracked\n"));
    const canonicalHash = hashBuffer(readFileSync(resolveCanonicalSddSkillPath("sdd-apply", packageRoot)));
    const toctou = await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, yes: true, receiptId: "sdd-toctou",
      plan: async () => ({
        provider: "sdd-core", componentId: "sdd-core", dryRun: true, executes: false, writes: false,
        persona: "off", personaActive: false, agentIds: ["codex"], conflicts: [],
        summary: { create: 0, noop: 0, update: 1, conflict: 0 }, sessionRefreshRequired: false,
        actions: [{
          skillId: "sdd-apply", destinationPath: updatePath, agentIds: ["codex"], kind: "shared",
          action: "update", reason: "drift", canonicalHash, diskHash: trackedHash, trackedHash,
          writes: false, executes: false
        }]
      })
    });
    assert.equal(readFileSync(updatePath, "utf8"), "edited after plan\n");
    assert.equal(toctou.receipt.files[0].action, "conflict");
    assert.equal(toctou.receipt.files[0].applied, false);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("recordSddMaterialization writes deterministic v4 SDD block and drops conflicts", () => {
  const receipt = {
    id: "sdd-record", persona: "teaching", agentIds: ["codex", "claude"],
    files: [
      { destinationPath: "/h/.claude/skills/sdd-init/SKILL.md", skillId: "sdd-init", agentIds: ["claude"], action: "create", afterHash: "hash-b", outcome: "applied" },
      { destinationPath: "/h/.agents/skills/sdd-init/SKILL.md", skillId: "sdd-init", agentIds: ["codex"], action: "create", afterHash: "hash-a", outcome: "applied" },
      { destinationPath: "/h/.agents/skills/sdd-spec/SKILL.md", skillId: "sdd-spec", agentIds: ["codex"], action: "conflict", afterHash: null, outcome: "conflict" }
    ]
  };
  const next = recordSddMaterialization({ sdd: undefined }, { receipt, now: () => "2026-07-16T00:00:00.000Z" });
  assert.equal(next.sdd.persona, "teaching");
  assert.deepEqual(next.sdd.agentIds, ["claude", "codex"]);
  assert.deepEqual(next.sdd.files.map((e) => e.destinationPath), [
    "/h/.agents/skills/sdd-init/SKILL.md", "/h/.claude/skills/sdd-init/SKILL.md"
  ]);
  assert.equal(next.sdd.lastReceiptId, "sdd-record");
});
