import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHomeDir, harnessHomePaths } from "./paths.js";
import { readGlobalState, writeGlobalState } from "./state.js";
import { printJson } from "./json-output.js";
import { formatCliCommand } from "./brand/cli.js";
import {
  assertExplicitApplyConsent,
  promptApplyConfirmation,
  shouldPromptApplyConfirmation
} from "./apply-confirmation.js";
import { ensureIntegrationProvidersRegistered } from "./integrations/index.js";
import { requireIntegrationProvider } from "./integrations/provider-registry.js";
import { SDD_HEALTH } from "./integrations/sdd-evidence.js";
import {
  adoptedHashesFromState,
  recordSddAdoptions
} from "./integrations/sdd-state.js";
import { resolveCanonicalSddSkillFile } from "./integrations/sdd-destinations.js";
import { assertComponentInstalled } from "./component-integration-cli.js";

const DEFAULT_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Minimal unified-style diff without external deps. */
export function createUnifiedDiff(fromLabel, toLabel, fromText, toText) {
  const fromLines = String(fromText ?? "").split("\n");
  const toLines = String(toText ?? "").split("\n");
  const lines = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  const max = Math.max(fromLines.length, toLines.length);
  let identical = true;
  for (let i = 0; i < max; i += 1) {
    const a = fromLines[i];
    const b = toLines[i];
    if (a === b) {
      if (a !== undefined) lines.push(` ${a}`);
      continue;
    }
    identical = false;
    if (a !== undefined) lines.push(`-${a}`);
    if (b !== undefined) lines.push(`+${b}`);
  }
  if (identical) lines.push(" (no textual differences)");
  return lines.join("\n");
}

async function buildSddContext(options) {
  const homeDir = resolveHomeDir();
  await assertComponentInstalled("sdd-core", { homeDir });
  ensureIntegrationProvidersRegistered();
  const provider = requireIntegrationProvider("sdd-core");
  const state = await readGlobalState(harnessHomePaths(homeDir).statePath);
  const trackedFiles = Object.fromEntries(
    (state?.sdd?.files ?? []).map((file) => [file.destinationPath, file.hash])
  );
  return {
    homeDir,
    provider,
    state,
    packageRoot: options.packageRoot ?? DEFAULT_PACKAGE_ROOT,
    requestedAgentIds: options.adapters ?? null,
    detectedAgentIds: (state?.adapters ?? []).map((entry) => entry.id),
    trackedFiles,
    adoptedFiles: adoptedHashesFromState(state?.sdd),
    personaAgentIds: state?.sdd?.personaAgentIds ?? []
  };
}

/** Adopt conflict disk hashes into state — no file writes. */
export async function runComponentsAdopt(options = {}) {
  if (options.componentId !== "sdd-core") {
    throw new Error(
      `components adopt supports sdd-core only (got "${options.componentId}").`
    );
  }

  const dryRun = Boolean(options.dryRun);
  const yes = Boolean(options.yes);
  const json = Boolean(options.json);
  assertExplicitApplyConsent({
    applying: !dryRun,
    dryRun,
    json,
    yes,
    interactive: null,
    command: "components adopt sdd-core"
  });

  const ctx = await buildSddContext(options);
  const verification = await ctx.provider.verify({
    homeDir: ctx.homeDir,
    packageRoot: ctx.packageRoot,
    requestedAgentIds: ctx.requestedAgentIds,
    detectedAgentIds: ctx.detectedAgentIds,
    trackedFiles: ctx.trackedFiles,
    adoptedFiles: ctx.adoptedFiles,
    personaAgentIds: ctx.personaAgentIds
  });

  const conflicts = (verification.findings ?? []).filter(
    (finding) => finding.status === SDD_HEALTH.CONFLICT && finding.diskHash
  );
  const adoptions = conflicts.map((finding) => ({
    destinationPath: finding.destinationPath,
    hash: finding.diskHash,
    skillId: finding.skillId,
    agentIds: finding.agentIds ?? [],
    relativePath: finding.relativePath ?? "SKILL.md",
    reason: "Adopted pre-existing disk bytes via components adopt."
  }));

  const result = {
    provider: "sdd-core",
    componentId: "sdd-core",
    dryRun,
    ok: true,
    adopted: adoptions.length,
    adoptions,
    summary: verification.summary
  };

  if (dryRun) {
    if (json) { printJson(result); return result; }
    console.log(formatCliCommand("components adopt sdd-core"));
    console.log(`Plan: adopt=${adoptions.length} conflict files (no writes).`);
    for (const entry of adoptions) {
      console.log(`  adopt    ${entry.skillId} → ${entry.destinationPath}`);
    }
    console.log("Dry-run only — no state updated.");
    return result;
  }

  if (shouldPromptApplyConfirmation({ applying: true, dryRun, json, confirm: yes, interactive: null })) {
    const accepted = await promptApplyConfirmation({
      command: "components adopt sdd-core",
      question: `Adopt ${adoptions.length} conflicting SDD skill file(s) as-is into Kairo state? [Y/n]: `
    });
    if (!accepted) {
      result.cancelled = true;
      result.ok = false;
      if (json) printJson(result);
      else console.log("Cancelled.");
      return result;
    }
  }

  if (adoptions.length) {
    await writeGlobalState(
      harnessHomePaths(ctx.homeDir).statePath,
      recordSddAdoptions(ctx.state ?? {}, { adoptions })
    );
  }

  result.applied = true;
  if (json) { printJson(result); return result; }
  console.log(formatCliCommand("components adopt sdd-core"));
  console.log(`Adopted ${adoptions.length} file(s) into Kairo state (disk unchanged).`);
  for (const entry of adoptions) {
    console.log(`  adopted  ${entry.skillId} → ${entry.destinationPath}`);
  }
  return result;
}

/** Read-only unified diff of conflict/drifted findings vs canonical. */
export async function runComponentsDiff(options = {}) {
  if (options.componentId !== "sdd-core") {
    throw new Error(
      `components diff supports sdd-core only (got "${options.componentId}").`
    );
  }

  const ctx = await buildSddContext(options);
  const verification = await ctx.provider.verify({
    homeDir: ctx.homeDir,
    packageRoot: ctx.packageRoot,
    requestedAgentIds: ctx.requestedAgentIds,
    detectedAgentIds: ctx.detectedAgentIds,
    trackedFiles: ctx.trackedFiles,
    adoptedFiles: ctx.adoptedFiles,
    personaAgentIds: ctx.personaAgentIds
  });

  const interesting = (verification.findings ?? []).filter(
    (finding) => finding.status === SDD_HEALTH.CONFLICT || finding.status === SDD_HEALTH.DRIFTED
  );

  const diffs = [];
  for (const finding of interesting) {
    let canonicalText = "";
    let diskText = "";
    try {
      const canonicalPath = resolveCanonicalSddSkillFile(
        finding.skillId,
        finding.relativePath ?? "SKILL.md",
        ctx.packageRoot
      );
      canonicalText = await readFile(canonicalPath, "utf8");
    } catch (error) {
      canonicalText = `/* failed to read canonical: ${error.message} */\n`;
    }
    try {
      diskText = await readFile(finding.destinationPath, "utf8");
    } catch (error) {
      diskText = `/* failed to read disk: ${error.message} */\n`;
    }
    diffs.push({
      skillId: finding.skillId,
      status: finding.status,
      destinationPath: finding.destinationPath,
      agentIds: finding.agentIds ?? [],
      unified: createUnifiedDiff(
        `canonical/${finding.skillId}/${finding.relativePath ?? "SKILL.md"}`,
        finding.destinationPath,
        canonicalText,
        diskText
      )
    });
  }

  const result = {
    provider: "sdd-core",
    componentId: "sdd-core",
    ok: true,
    count: diffs.length,
    diffs,
    summary: verification.summary
  };

  if (options.json) {
    printJson(result);
    return result;
  }

  console.log(formatCliCommand("components diff sdd-core"));
  console.log(`Findings: ${diffs.length} conflict/drifted file(s).`);
  if (diffs.length === 0) {
    console.log("No conflicting or drifted skill files.");
    return result;
  }
  for (const entry of diffs) {
    console.log("");
    console.log(`## ${entry.status} ${entry.skillId} (${(entry.agentIds ?? []).join(",")})`);
    console.log(entry.unified);
  }
  return result;
}
