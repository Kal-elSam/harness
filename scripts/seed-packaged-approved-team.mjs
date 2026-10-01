#!/usr/bin/env node
/**
 * Seed a SUGGESTED project team (Architect+Explorer → claude-haiku-4-5) under a
 * temp HARNESS_HOME, copy Claude entitlement evidence (read-only from the real
 * harness home), then approve via the real conversation service.
 *
 * No bootstrap analysis. Does not write to the real ~/.harness tree.
 *
 * Env:
 *   KAIRO_APPROVED_TEAM_PROJ   — project cwd (git repo)
 *   KAIRO_APPROVED_TEAM_HOME   — temp HARNESS_HOME
 *   KAIRO_REAL_HARNESS_HOME    — source for entitlement copy (default ~/.harness via homedir)
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writeProjectStrategy, PROJECT_STRATEGY_SCHEMA } from "../src/global/conversation/project-strategy-store.js";
import { harnessHomePaths, resolveHomeDir } from "../src/global/paths.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";
import { approveProjectTeam } from "../src/global/host/project-team-sidecar.js";

const proj = process.env.KAIRO_APPROVED_TEAM_PROJ;
const teamHome = process.env.KAIRO_APPROVED_TEAM_HOME;
if (!proj || !teamHome) {
  console.error("KAIRO_APPROVED_TEAM_PROJ and KAIRO_APPROVED_TEAM_HOME are required");
  process.exit(2);
}

process.env.HARNESS_HOME = teamHome;
// Explicit CLAUDE_CONFIG_DIR (even when equal to ~/.claude) makes
 // `claude auth status` report loggedIn:false in this environment.
delete process.env.CLAUDE_CONFIG_DIR;

const MODEL = Object.freeze({
  adapterId: "claude",
  modelId: "claude-haiku-4-5",
  displayName: "Claude Haiku 4.5",
  accessMode: "automatic",
  candidateKey: "claude::claude-haiku-4-5"
});

const realHarnessRoot = process.env.KAIRO_REAL_HARNESS_HOME
  || harnessHomePaths(homedir()).root;
const srcEntitlement = join(realHarnessRoot, "claude-entitlement.json");
const destEntitlement = harnessHomePaths(teamHome).claudeEntitlementPath;
mkdirSync(dirname(destEntitlement), { recursive: true });
if (!existsSync(srcEntitlement)) {
  console.error(`missing entitlement source: ${srcEntitlement}`);
  process.exit(2);
}
copyFileSync(srcEntitlement, destEntitlement);
const entitlement = JSON.parse(readFileSync(destEntitlement, "utf8"));
const haiku = entitlement?.models?.["claude-haiku-4-5"];
if (haiku?.status !== "allowed") {
  console.error(`claude-haiku-4-5 entitlement is not allowed (got ${JSON.stringify(haiku)})`);
  process.exit(2);
}

const suggested = {
  schema: PROJECT_STRATEGY_SCHEMA,
  status: "suggested",
  profileFingerprint: "packaged-approved-team-auth-2026-10-01",
  bootstrapAnalyst: MODEL,
  orchestrator: MODEL,
  projectTeam: [
    {
      role: "Architect",
      model: MODEL,
      fallback: null,
      assignmentSource: "recommended",
      assignmentState: "ready",
      reason: "Authorized packaged approved-team scenario (no analysis run)"
    },
    {
      role: "Explorer",
      model: MODEL,
      fallback: null,
      assignmentSource: "recommended",
      assignmentState: "ready",
      reason: "ASK routes Explorer; same Claude haiku as Architect for this bounded run"
    }
  ]
};

await writeProjectStrategy(teamHome, proj, suggested);
const homeCheck = resolveHomeDir(process.env);
if (homeCheck !== teamHome) {
  console.error(`HARNESS_HOME not effective: expected ${teamHome}, got ${homeCheck}`);
  process.exit(2);
}

const approved = await approveProjectTeam({ cwd: proj });
if (approved?.ok === false) {
  console.error("approve failed:", JSON.stringify(approved));
  process.exit(1);
}

const { sessionsDir } = harnessHomePaths(teamHome);
const strategyFile = join(sessionsDir, projectKeyForPath(proj), "project-strategy.json");
const persisted = JSON.parse(readFileSync(strategyFile, "utf8"));
if (persisted.status !== "active") {
  console.error(`expected active strategy, got ${persisted.status}`);
  process.exit(1);
}
const out = {
  ok: true,
  status: persisted.status,
  approvedAt: persisted.approvedAt ?? null,
  roles: approved.roles ?? persisted.projectTeam?.map((e) => e.role) ?? null,
  teamRows: approved.teamRows ?? persisted.projectTeam?.length ?? null,
  strategyFile,
  entitlementHaiku: haiku.status,
  model: MODEL.modelId
};
writeFileSync(join(teamHome, "seed-approve-result.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(out));
