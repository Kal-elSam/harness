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

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const trackedOf = (r) => Object.fromEntries(
  r.files.filter((f) => f.afterHash).map((f) => [f.destinationPath, f.afterHash])
);

test("persona audit: installed asset, statePath gate, rollback noop and file-safe", async () => {
  const homeDir = mkdtempSync(join(process.cwd(), ".tmp-sdd-persona-"));
  const paths = harnessHomePaths(homeDir);
  try {
    const tracked = trackedOf((await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, persona: "teaching", yes: true, receiptId: "sdd-b"
    })).receipt);
    const v = (ids) => verifySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, personaAgentIds: ids, trackedFiles: tracked
    });
    assert.equal((await v(["codex"])).persona.status, SDD_PERSONA_HEALTH.CONFLICT);
    const installed = join(paths.root, "components/sdd-core/personas/teaching.md");
    mkdirSync(dirname(installed), { recursive: true });
    copyFileSync(join(packageRoot, "global-template/components/sdd-core/personas/teaching.md"), installed);
    assert.equal((await v(["codex"])).persona.status, SDD_PERSONA_HEALTH.SYNC_REQUIRED);
    mkdirSync(join(homeDir, ".codex"), { recursive: true });
    const section = buildSddCoreManagedSection(
      { componentsDir: join(paths.root, "components"), paths }, { id: "codex" }, null);
    writeFileSync(join(homeDir, ".codex/AGENTS.md"), `${section}\n`);
    assert.ok(section.includes(paths.statePath) && !section.includes("~/.harness/state.json"));
    assert.equal((await v(["codex"])).persona.personaActive, true);
    const pt = { before: [], after: ["codex"], admitted: ["codex"], rejected: [], personaChanged: true };
    await saveSddReceipt({
      id: "sdd-p", persona: "teaching", files: [], backups: [], ok: true, personaTransition: pt
    }, { homeDir });
    assert.ok((await rollbackSddReceipt({ receiptId: "sdd-p", homeDir, yes: true, personaAgentIds: ["codex"] }))
      .actions.some((a) => a.ok && !a.noop));
    assert.ok((await rollbackSddReceipt({ receiptId: "sdd-p", homeDir, yes: true, personaAgentIds: [] }))
      .actions.some((a) => a.noop));
    assert.equal((await rollbackSddReceipt({
      receiptId: "sdd-p", homeDir, yes: true, personaAgentIds: ["claude"]
    })).blocked, true);
    const path = resolveSddSkillPath("sdd-explore", "codex", homeDir);
    const afterHash = hashBuffer(readFileSync(path));
    writeFileSync(path, "mutated\n");
    await saveSddReceipt({
      id: "sdd-pf", persona: "teaching", backups: [], ok: true, personaTransition: pt,
      files: [{
        destinationPath: path, skillId: "sdd-explore", agentIds: ["codex"], action: "create",
        applied: true, afterHash, parentRealpath: realpathSync(dirname(path))
      }]
    }, { homeDir });
    assert.ok((await rollbackSddReceipt({
      receiptId: "sdd-pf", homeDir, yes: true, personaAgentIds: ["codex"]
    })).actions.some((a) => a.action === "persona" && !a.ok));
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
