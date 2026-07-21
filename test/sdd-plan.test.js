import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashBuffer } from "../src/hash.js";
import { classifySddSkillFile, SDD_PLAN_ACTIONS } from "../src/global/integrations/sdd-evidence.js";
import {
  SDD_SKILL_IDS,
  groupSddSkillDestinations,
  resolveCanonicalSddSkillPath,
  resolveSddAgentSelection,
  resolveSddSkillPath
} from "../src/global/integrations/sdd-destinations.js";
import { planSddConfigure } from "../src/global/integrations/sdd-plan.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("shared destinations coalesce consumers and stay deterministic", () => {
  assert.equal(SDD_SKILL_IDS.length, 9);
  assert.deepEqual(
    resolveSddAgentSelection({ detectedIds: ["codex", "pi", "cursor", "claude"] }),
    ["cursor", "codex", "claude", "pi"]
  );
  assert.throws(() => resolveSddAgentSelection({ requestedIds: ["gemini"] }), /not managed/);

  const homeDir = "/tmp/sdd-home";
  const groups = groupSddSkillDestinations(["claude", "opencode", "codex", "cursor", "pi"], homeDir);
  assert.deepEqual(groups.map((group) => ({ kind: group.kind, agentIds: group.agentIds })), [
    { kind: "shared", agentIds: ["cursor", "codex", "opencode", "pi"] },
    { kind: "claude", agentIds: ["claude"] }
  ]);
  assert.equal(
    resolveSddSkillPath("sdd-init", "pi", homeDir),
    join(homeDir, ".agents", "skills", "sdd-init", "SKILL.md")
  );
  assert.equal(
    resolveSddSkillPath("sdd-init", "claude", homeDir),
    join(homeDir, ".claude", "skills", "sdd-init", "SKILL.md")
  );
});

test("evidence classifies create, noop, update, and conflict without overwrite", () => {
  assert.equal(classifySddSkillFile({ exists: false, canonicalHash: "a" }).action, SDD_PLAN_ACTIONS.CREATE);
  assert.equal(
    classifySddSkillFile({ exists: true, canonicalHash: "a", diskHash: "a", trackedHash: null }).action,
    SDD_PLAN_ACTIONS.CONFLICT
  );
  assert.equal(
    classifySddSkillFile({ exists: true, canonicalHash: "a", diskHash: "b", trackedHash: "a" }).action,
    SDD_PLAN_ACTIONS.CONFLICT
  );
  assert.equal(
    classifySddSkillFile({ exists: true, canonicalHash: "a", diskHash: "a", trackedHash: "a" }).action,
    SDD_PLAN_ACTIONS.NOOP
  );
  assert.equal(
    classifySddSkillFile({ exists: true, canonicalHash: "b", diskHash: "a", trackedHash: "a" }).action,
    SDD_PLAN_ACTIONS.UPDATE
  );
});

test("planSddConfigure is dry-run only and deduplicates shared writes", async () => {
  const homeDir = mkdtempSync(join(process.cwd(), ".tmp-sdd-plan-"));
  try {
    const plan = await planSddConfigure({
      requestedAgentIds: ["codex", "opencode", "cursor", "claude"],
      homeDir,
      packageRoot,
      persona: "off"
    });

    assert.equal(plan.executes, false);
    assert.equal(plan.writes, false);
    assert.equal(plan.personaActive, false);
    assert.equal(plan.actions.length, 36);
    assert.equal(plan.summary.create, 36);
    assert.equal(plan.summary.conflict, 0);

    const initActions = plan.actions.filter((entry) => entry.skillId === "sdd-init");
    assert.equal(initActions.length, 4);
    assert.deepEqual(initActions[0].agentIds, ["cursor", "codex", "opencode"]);
    assert.equal(initActions[0].relativePath, "SKILL.md");
    assert.ok(initActions[0].skillHash);
    assert.ok(initActions.some((entry) => entry.relativePath === "references/contract.md"));
    assert.ok(initActions[0].destinationPath.endsWith(join(".agents", "skills", "sdd-init", "SKILL.md")));
    assert.ok(initActions.every((entry) => entry.writes === false));
    const ordered = plan.actions.map((e) => `${e.skillId}|${e.relativePath}|${e.destinationPath}`);
    assert.deepEqual(ordered, [...ordered].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));

    const withPi = await planSddConfigure({
      requestedAgentIds: ["codex", "pi", "cursor"],
      homeDir,
      packageRoot,
      persona: "off"
    });
    const piInit = withPi.actions.filter((entry) => entry.skillId === "sdd-init" && entry.relativePath === "SKILL.md");
    assert.equal(piInit.length, 1);
    assert.deepEqual(piInit[0].agentIds, ["cursor", "codex", "pi"]);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("plan preserves untracked and user-modified destinations as conflicts", async () => {
  const homeDir = mkdtempSync(join(process.cwd(), ".tmp-sdd-conflict-"));
  try {
    const canonical = readFileSync(resolveCanonicalSddSkillPath("sdd-spec", packageRoot));
    const canonicalHash = hashBuffer(canonical);
    const sharedPath = join(homeDir, ".agents", "skills", "sdd-spec", "SKILL.md");
    const claudePath = join(homeDir, ".claude", "skills", "sdd-spec", "SKILL.md");
    mkdirSync(dirname(sharedPath), { recursive: true });
    mkdirSync(dirname(claudePath), { recursive: true });
    writeFileSync(sharedPath, "user owned untracked\n");
    writeFileSync(claudePath, canonical);

    const plan = await planSddConfigure({
      requestedAgentIds: ["codex", "claude"],
      homeDir,
      packageRoot,
      trackedFiles: {
        [claudePath]: "stale-tracked-hash"
      }
    });

    const shared = plan.actions.find((entry) => entry.destinationPath === sharedPath);
    const claude = plan.actions.find((entry) => entry.destinationPath === claudePath);
    assert.equal(shared.action, SDD_PLAN_ACTIONS.CONFLICT);
    assert.match(shared.reason, /untracked/i);
    assert.equal(claude.action, SDD_PLAN_ACTIONS.CONFLICT);
    assert.match(claude.reason, /User-modified/i);
    assert.equal(plan.conflicts.length, 2);
    assert.notEqual(claude.canonicalHash, "stale-tracked-hash");
    assert.equal(hashBuffer(readFileSync(sharedPath)), hashBuffer(Buffer.from("user owned untracked\n")));
    assert.equal(hashBuffer(readFileSync(claudePath)), canonicalHash);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("identical tracked bytes become noop and managed drift becomes update", async () => {
  const homeDir = mkdtempSync(join(process.cwd(), ".tmp-sdd-noop-"));
  try {
    const skillId = "sdd-apply";
    const canonical = readFileSync(resolveCanonicalSddSkillPath(skillId, packageRoot));
    const canonicalHash = hashBuffer(canonical);
    const destinationPath = join(homeDir, ".agents", "skills", skillId, "SKILL.md");
    mkdirSync(dirname(destinationPath), { recursive: true });
    writeFileSync(destinationPath, canonical);

    const noopPlan = await planSddConfigure({
      requestedAgentIds: ["codex"],
      homeDir,
      packageRoot,
      trackedFiles: { [destinationPath]: canonicalHash }
    });
    assert.equal(
      noopPlan.actions.find((e) => e.skillId === skillId && e.relativePath === "SKILL.md").action,
      SDD_PLAN_ACTIONS.NOOP
    );

    writeFileSync(destinationPath, "# stale managed copy\n");
    const updatePlan = await planSddConfigure({
      requestedAgentIds: ["codex"],
      homeDir,
      packageRoot,
      trackedFiles: { [destinationPath]: hashBuffer(Buffer.from("# stale managed copy\n")) }
    });
    assert.equal(
      updatePlan.actions.find((e) => e.skillId === skillId && e.relativePath === "SKILL.md").action,
      SDD_PLAN_ACTIONS.UPDATE
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
