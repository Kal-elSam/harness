import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applySddConfigure } from "../src/global/integrations/sdd-apply.js";
import {
  groupSddSkillDestinations,
  resolveSddSkillPath
} from "../src/global/integrations/sdd-destinations.js";
import { SDD_PERSONA_HEALTH } from "../src/global/integrations/sdd-persona.js";
import { rollbackSddReceipt } from "../src/global/integrations/sdd-rollback.js";
import { verifySddConfigure } from "../src/global/integrations/sdd-verify.js";
import { buildSddCoreManagedSection } from "../src/global/components/sdd-core.js";
import { harnessHomePaths } from "../src/global/paths.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const trackedOf = (receipt) => Object.fromEntries(
  receipt.files.filter((file) => file.afterHash).map((file) => [file.destinationPath, file.afterHash])
);

test("pi shares ~/.agents/skills with codex/cursor and activates teaching via AGENTS.md", async () => {
  const homeDir = mkdtempSync(join(process.cwd(), ".tmp-pi-sdd-"));
  const paths = harnessHomePaths(homeDir);
  try {
    const groups = groupSddSkillDestinations(["pi", "codex", "cursor"], homeDir);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].agentIds, ["cursor", "codex", "pi"]);

    const applied = await applySddConfigure({
      requestedAgentIds: ["pi", "codex"],
      homeDir,
      packageRoot,
      persona: "teaching",
      yes: true,
      receiptId: "sdd-pi-teach"
    });
    assert.equal(applied.personaTransition.after.join(), "codex,pi");
    assert.equal(
      resolveSddSkillPath("sdd-init", "pi", homeDir),
      resolveSddSkillPath("sdd-init", "codex", homeDir)
    );
    assert.ok(readFileSync(resolveSddSkillPath("sdd-init", "pi", homeDir), "utf8").includes("sdd-init"));

    const tracked = trackedOf(applied.receipt);
    mkdirSync(dirname(join(paths.root, "components/sdd-core/personas/teaching.md")), { recursive: true });
    copyFileSync(
      join(packageRoot, "global-template/components/sdd-core/personas/teaching.md"),
      join(paths.root, "components/sdd-core/personas/teaching.md")
    );
    mkdirSync(join(homeDir, ".pi", "agent"), { recursive: true });
    mkdirSync(join(homeDir, ".codex"), { recursive: true });
    const piSection = buildSddCoreManagedSection(
      { componentsDir: join(paths.root, "components"), paths },
      { id: "pi" },
      null
    );
    writeFileSync(join(homeDir, ".pi/agent/AGENTS.md"), `${piSection}\n`);
    writeFileSync(
      join(homeDir, ".codex/AGENTS.md"),
      `${buildSddCoreManagedSection({ componentsDir: join(paths.root, "components"), paths }, { id: "codex" }, null)}\n`
    );

    const verified = await verifySddConfigure({
      requestedAgentIds: ["pi", "codex"],
      homeDir,
      packageRoot,
      personaAgentIds: ["codex", "pi"],
      trackedFiles: tracked
    });
    assert.equal(verified.persona.status, SDD_PERSONA_HEALTH.CONFIGURED);
    assert.equal(verified.persona.personaActive, true);
    assert.ok(piSection.includes("sdd.personaAgentIds"));

    const rolled = await rollbackSddReceipt({
      receiptId: "sdd-pi-teach",
      homeDir,
      yes: true,
      personaAgentIds: ["codex", "pi"]
    });
    assert.ok(rolled.actions.some((action) => action.ok));
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
