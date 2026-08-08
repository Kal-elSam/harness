import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashBuffer } from "../src/hash.js";
import { parseArgs } from "../src/cli.js";
import { buildSddIntegrationChecks } from "../src/global/component-integration-cli.js";
import { applySddConfigure } from "../src/global/integrations/sdd-apply.js";
import {
  classifySddSkillFile,
  classifySddVerifyHealth,
  SDD_HEALTH,
  SDD_PLAN_ACTIONS
} from "../src/global/integrations/sdd-evidence.js";
import { resolveCanonicalSddSkillPath, resolveSddSkillPath } from "../src/global/integrations/sdd-destinations.js";
import { planSddConfigure } from "../src/global/integrations/sdd-plan.js";
import {
  adoptedHashesFromState,
  defaultSddState,
  normalizeSddState,
  recordSddAdoptions
} from "../src/global/integrations/sdd-state.js";
import { verifySddConfigure } from "../src/global/integrations/sdd-verify.js";
import { buildSddSkillResolutions } from "../src/global/integrations/sdd-resolutions.js";
import { createUnifiedDiff } from "../src/global/components-resolve-cli.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = (name) => mkdtempSync(join(process.cwd(), name));

test("classifySddVerifyHealth respects adoptedHash match and mismatch", () => {
  assert.equal(classifySddVerifyHealth({
    exists: true, canonicalHash: "canon", diskHash: "disk", trackedHash: null, adoptedHash: "disk"
  }).status, SDD_HEALTH.ADOPTED);
  assert.equal(classifySddVerifyHealth({
    exists: true, canonicalHash: "canon", diskHash: "disk", trackedHash: null, adoptedHash: "other"
  }).status, SDD_HEALTH.CONFLICT);
  assert.equal(classifySddSkillFile({
    exists: true, canonicalHash: "canon", diskHash: "disk", trackedHash: null, adoptedHash: "disk"
  }).action, SDD_PLAN_ACTIONS.NOOP);
});

test("normalizeSddState preserves and sanitizes adopted entries", () => {
  assert.deepEqual(defaultSddState().adopted, []);
  const normalized = normalizeSddState({
    adopted: [
      { destinationPath: "/tmp/a", hash: "abc", skillId: "sdd-init", agentIds: ["claude"] },
      { destinationPath: "", hash: "bad" },
      null
    ]
  });
  assert.equal(normalized.adopted.length, 1);
  assert.equal(normalized.adopted[0].destinationPath, "/tmp/a");
  assert.equal(adoptedHashesFromState(normalized)["/tmp/a"], "abc");
});

test("buildSddIntegrationChecks emits resolutions for conflicts", () => {
  const checks = buildSddIntegrationChecks({
    status: SDD_HEALTH.CONFLICT,
    summary: { configured: 27, adopted: 0, missing: 0, drifted: 0, conflict: 9 },
    findings: [{
      status: SDD_HEALTH.CONFLICT,
      skillId: "sdd-apply",
      agentIds: ["claude"],
      destinationPath: "/tmp/x"
    }],
    persona: { status: "off" }
  });
  const skills = checks[0];
  assert.equal(skills.status, "warning");
  assert.ok(Array.isArray(skills.resolutions));
  assert.ok(skills.resolutions.some((r) => r.id === "sdd-adopt" && /adopt/.test(r.command) && /--yes/.test(r.command)));
  assert.ok(skills.resolutions.some((r) => r.id === "sdd-overwrite" && /overwrite-conflicts/.test(r.command) && /--yes/.test(r.command)));
  assert.ok(skills.resolutions.some((r) => r.id === "sdd-diff" && r.safety === "read-only"));
  assert.match(skills.detail, /adopted=0/);
});

test("buildSddSkillResolutions scopes --agents from findings", () => {
  const resolutions = buildSddSkillResolutions({
    summary: { conflict: 2, drifted: 0 },
    findings: [
      { status: SDD_HEALTH.CONFLICT, agentIds: ["claude"] },
      { status: SDD_HEALTH.CONFLICT, agentIds: ["codex", "claude"] }
    ]
  });
  const adopt = resolutions.find((r) => r.id === "sdd-adopt");
  assert.match(adopt.command, /--agents claude,codex/);
});

test("CLI parses adopt, diff, and overwrite-conflicts", () => {
  const adopt = parseArgs(["components", "adopt", "sdd-core", "--agents", "claude", "--dry-run"]);
  assert.equal(adopt.options.componentsAction, "adopt");
  assert.equal(adopt.options.componentId, "sdd-core");
  assert.deepEqual(adopt.options.adapters, ["claude"]);
  assert.equal(parseArgs(["components", "diff", "sdd-core"]).options.componentsAction, "diff");
  assert.equal(
    parseArgs(["components", "configure", "sdd-core", "--overwrite-conflicts", "--dry-run"])
      .options.overwriteConflicts,
    true
  );
});

test("createUnifiedDiff marks changed lines", () => {
  const text = createUnifiedDiff("a", "b", "one\ntwo\n", "one\nTWO\n");
  assert.match(text, /^-two$/m);
  assert.match(text, /^\+TWO$/m);
});

test("adoptedFiles make verify healthy; overwriteConflicts replaces untracked", async () => {
  const homeDir = home(".tmp-sdd-resolve-");
  try {
    const path = resolveSddSkillPath("sdd-init", "claude", homeDir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "user owned gentleman skill\n");
    const diskHash = hashBuffer(readFileSync(path));

    const conflicted = await verifySddConfigure({
      requestedAgentIds: ["claude"], homeDir, packageRoot, trackedFiles: {}
    });
    assert.equal(conflicted.status, SDD_HEALTH.CONFLICT);
    assert.ok(conflicted.summary.conflict > 0);

    const adopted = await verifySddConfigure({
      requestedAgentIds: ["claude"],
      homeDir,
      packageRoot,
      trackedFiles: {},
      adoptedFiles: { [path]: diskHash }
    });
    assert.equal(adopted.findings.find((f) => f.destinationPath === path).status, SDD_HEALTH.ADOPTED);
    assert.equal(adopted.summary.conflict, 0);
    assert.ok((adopted.summary.adopted ?? 0) >= 1);

    const planned = await planSddConfigure({
      requestedAgentIds: ["claude"],
      homeDir,
      packageRoot,
      trackedFiles: {},
      overwriteConflicts: true
    });
    const action = planned.actions.find((entry) => entry.destinationPath === path);
    assert.equal(action.action, SDD_PLAN_ACTIONS.UPDATE);
    assert.equal(action.overwrote, true);

    const overwritten = await applySddConfigure({
      requestedAgentIds: ["claude"],
      homeDir,
      packageRoot,
      yes: true,
      overwriteConflicts: true,
      receiptId: "sdd-overwrite-test"
    });
    assert.equal(overwritten.applied, true);
    const canonical = readFileSync(resolveCanonicalSddSkillPath("sdd-init", packageRoot));
    assert.equal(hashBuffer(readFileSync(path)), hashBuffer(canonical));
    assert.ok(overwritten.receipt.backups.length > 0);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test("recordSddAdoptions merges into state", () => {
  const next = recordSddAdoptions({}, {
    adoptions: [{
      destinationPath: "/x",
      hash: "h1",
      skillId: "sdd-init",
      agentIds: ["claude"],
      adoptedAt: "2026-01-01T00:00:00.000Z"
    }],
    now: () => "2026-01-01T00:00:00.000Z"
  });
  assert.equal(next.sdd.adopted.length, 1);
  assert.equal(next.sdd.adopted[0].hash, "h1");
});
