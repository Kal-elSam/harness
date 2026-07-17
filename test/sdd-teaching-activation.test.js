import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySddConfigure } from "../src/global/integrations/sdd-apply.js";
import { resolveSddSkillPath } from "../src/global/integrations/sdd-destinations.js";
import {
  classifyPersonaHealth, planPersonaTransition, SDD_PERSONA_HEALTH
} from "../src/global/integrations/sdd-persona.js";
import { rollbackSddReceipt } from "../src/global/integrations/sdd-rollback.js";
import { verifySddConfigure } from "../src/global/integrations/sdd-verify.js";
import { buildSddCoreManagedSection } from "../src/global/components/sdd-core.js";
import { saveSddReceipt } from "../src/global/integrations/sdd-receipts.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = (n) => mkdtempSync(join(process.cwd(), n));
const trackedOf = (r) => Object.fromEntries(
  r.files.filter((f) => f.afterHash).map((f) => [f.destinationPath, f.afterHash])
);

test("persona activation, targeted off, rollback, and verify health", async () => {
  const homeDir = tmp(".tmp-sdd-persona-");
  try {
    assert.equal(classifyPersonaHealth({}).status, SDD_PERSONA_HEALTH.OFF);
    assert.deepEqual(planPersonaTransition({
      requestedPersona: "teaching", selectedAgentIds: ["codex"],
      actions: [{ agentIds: ["codex"], action: "conflict" }]
    }).rejected, ["codex"]);
    const tracked = trackedOf((await applySddConfigure({
      requestedAgentIds: ["codex", "opencode", "claude"], homeDir, packageRoot,
      persona: "off", yes: true, receiptId: "sdd-base"
    })).receipt);
    const conflictPath = resolveSddSkillPath("sdd-init", "claude", homeDir);
    writeFileSync(conflictPath, "user owned\n");
    delete tracked[conflictPath];
    const taught = await applySddConfigure({
      requestedAgentIds: ["codex", "opencode", "claude"], homeDir, packageRoot,
      persona: "teaching", personaAgentIds: [], trackedFiles: tracked, yes: true, receiptId: "sdd-teach"
    });
    assert.deepEqual(taught.personaTransition.after, ["codex", "opencode"]);
    assert.equal(taught.writes === false && taught.sessionRefreshRequired, true);
    const off = await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, persona: "off",
      personaAgentIds: ["codex", "opencode"], trackedFiles: tracked, yes: true, receiptId: "sdd-poff"
    });
    assert.equal(off.sessionRefreshRequired && off.writes === false, true);
    assert.deepEqual(off.personaTransition.after, ["opencode"]);
    await saveSddReceipt({
      id: "sdd-persona-only", persona: "teaching",
      personaTransition: {
        before: [], after: ["codex"], admitted: ["codex"], rejected: [], personaChanged: true
      },
      files: [], backups: [], ok: true
    }, { homeDir });
    assert.ok((await rollbackSddReceipt({
      receiptId: "sdd-persona-only", homeDir, yes: true, personaAgentIds: ["codex"]
    })).actions.some((a) => a.action === "persona" && a.ok));
    assert.equal((await rollbackSddReceipt({
      receiptId: "sdd-persona-only", homeDir, yes: true, personaAgentIds: ["claude"]
    })).blocked, true);
    const t2 = trackedOf((await applySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, persona: "teaching",
      personaAgentIds: [], trackedFiles: tracked, yes: true, receiptId: "sdd-v"
    })).receipt);
    assert.equal((await verifySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, personaAgentIds: ["codex"], trackedFiles: t2
    })).persona.status, SDD_PERSONA_HEALTH.SYNC_REQUIRED);
    mkdirSync(dirname(join(homeDir, ".codex/AGENTS.md")), { recursive: true });
    writeFileSync(join(homeDir, ".codex/AGENTS.md"), `${buildSddCoreManagedSection(
      { componentsDir: join(homeDir, "components") }, { id: "codex" }, null
    )}\n`);
    assert.equal((await verifySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, personaAgentIds: ["codex"], trackedFiles: t2
    })).persona.personaActive, true);
    writeFileSync(resolveSddSkillPath("sdd-init", "codex", homeDir), "drift\n");
    assert.equal((await verifySddConfigure({
      requestedAgentIds: ["codex"], homeDir, packageRoot, personaAgentIds: ["codex"], trackedFiles: t2
    })).persona.status, SDD_PERSONA_HEALTH.CONFLICT);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
