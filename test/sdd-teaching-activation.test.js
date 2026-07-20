import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashBuffer } from "../src/hash.js";
import { applySddConfigure } from "../src/global/integrations/sdd-apply.js";
import { resolveSddSkillPath } from "../src/global/integrations/sdd-destinations.js";
import { SDD_PERSONA_HEALTH } from "../src/global/integrations/sdd-persona.js";
import { rollbackSddReceipt } from "../src/global/integrations/sdd-rollback.js";
import { verifySddConfigure } from "../src/global/integrations/sdd-verify.js";
import { buildSddCoreManagedSection } from "../src/global/components/sdd-core.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { saveSddReceipt } from "../src/global/integrations/sdd-receipts.js";
import { normalizeSddState, reconcileSddStateAfterRollback } from "../src/global/integrations/sdd-state.js";
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const trackedOf = (r) => Object.fromEntries(r.files.filter((f) => f.afterHash).map((f) => [f.destinationPath, f.afterHash]));
const pt = { before: [], after: ["codex"], admitted: ["codex"], rejected: [], personaChanged: true };
test("persona: empty ids, admit/off/refresh, health, absent delete, rollback", async () => {
  assert.ok([[], null].every((personaAgentIds) => normalizeSddState({
    persona: "teaching", personaAgentIds, agentIds: ["codex"], files: [] }).persona === "off"));
  const homeDir = mkdtempSync(join(process.cwd(), ".tmp-sdd-persona-"));
  const paths = harnessHomePaths(homeDir);
  try {
    let tracked = trackedOf((await applySddConfigure({
      requestedAgentIds: ["codex", "opencode", "claude"], homeDir, packageRoot, persona: "off", yes: true, receiptId: "sdd-b"
    })).receipt);
    writeFileSync(resolveSddSkillPath("sdd-init", "claude", homeDir), "user\n");
    delete tracked[resolveSddSkillPath("sdd-init", "claude", homeDir)];
    const taught = await applySddConfigure({
      requestedAgentIds: ["codex", "opencode", "claude"], homeDir, packageRoot,
      persona: "teaching", personaAgentIds: [], trackedFiles: tracked, yes: true, receiptId: "sdd-t"
    });
    assert.ok(taught.sessionRefreshRequired && taught.personaTransition.rejected.includes("claude")
      && taught.personaTransition.after.join() === "codex,opencode");
    const off = await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, persona: "off",
      personaAgentIds: ["codex", "opencode"], trackedFiles: tracked, yes: true, receiptId: "sdd-o"
    });
    assert.equal(off.sessionRefreshRequired && off.personaTransition.after.join() === "opencode", true);
    tracked = trackedOf((await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, persona: "teaching",
      personaAgentIds: [], trackedFiles: tracked, yes: true, receiptId: "sdd-v"
    })).receipt);
    const v = (ids) => verifySddConfigure({ requestedAgentIds: ["codex"], homeDir, packageRoot, personaAgentIds: ids, trackedFiles: tracked });
    assert.equal((await v(["codex"])).persona.status, SDD_PERSONA_HEALTH.CONFLICT);
    const installed = join(paths.root, "components/sdd-core/personas/teaching.md");
    mkdirSync(dirname(installed), { recursive: true }); copyFileSync(join(packageRoot, "global-template/components/sdd-core/personas/teaching.md"), installed);
    assert.equal((await v(["codex"])).persona.status, SDD_PERSONA_HEALTH.SYNC_REQUIRED);
    mkdirSync(join(homeDir, ".codex"), { recursive: true });
    const section = buildSddCoreManagedSection({ componentsDir: join(paths.root, "components"), paths }, { id: "codex" }, null);
    writeFileSync(join(homeDir, ".codex/AGENTS.md"), `${section}\n`);
    assert.ok(section.includes(paths.statePath) && (await v(["codex"])).persona.personaActive);
    const path = resolveSddSkillPath("sdd-explore", "codex", homeDir);
    assert.equal(reconcileSddStateAfterRollback({
      sdd: { persona: "off", personaAgentIds: [], agentIds: ["codex"], lastReceiptId: null, updatedAt: null,
        files: [{ destinationPath: path, relativePath: "SKILL.md", skillId: "sdd-explore", agentIds: ["codex"], hash: "x", skillHash: null, action: "create" }] }
    }, { receipt: { id: "r", files: [] }, actions: [{ path, action: "delete", ok: true, reason: "Already absent." }], now: () => "t" }).sdd.files.length, 0);
    await saveSddReceipt({ id: "sdd-p", persona: "teaching", files: [], backups: [], ok: true, personaTransition: pt }, { homeDir });
    assert.ok((await rollbackSddReceipt({ receiptId: "sdd-p", homeDir, yes: true, personaAgentIds: ["codex"] })).actions.some((a) => a.ok && !a.noop)
      && (await rollbackSddReceipt({ receiptId: "sdd-p", homeDir, yes: true, personaAgentIds: [] })).actions.some((a) => a.noop));
    const afterHash = hashBuffer(readFileSync(path));
    writeFileSync(path, "mutated\n");
    await saveSddReceipt({
      id: "sdd-pf", persona: "teaching", backups: [], ok: true, personaTransition: pt,
      files: [{ destinationPath: path, skillId: "sdd-explore", agentIds: ["codex"], action: "create", applied: true, afterHash, parentRealpath: realpathSync(dirname(path)) }]
    }, { homeDir });
    assert.ok((await rollbackSddReceipt({ receiptId: "sdd-pf", homeDir, yes: true, personaAgentIds: ["codex"] })).actions.some((a) => a.action === "persona" && !a.ok));
  } finally { rmSync(homeDir, { recursive: true, force: true }); }
});
