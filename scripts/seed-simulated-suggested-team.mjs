#!/usr/bin/env node
/**
 * Seed a strategy for the simulated-Pi connect evidence run: a SUGGESTED
 * project team under a temp HARNESS_HOME, with NO analyst and NO model call.
 * Approval happens later through the real UI key + real service (team.approve).
 *
 * Env:
 *   KAIRO_SIM_PROJ           project cwd (git repo)            required
 *   KAIRO_SIM_HOME           temp HARNESS_HOME                  required
 *   KAIRO_SIM_PI_SCENARIO    scenario name (default positive)
 *   KAIRO_SIM_SEED_STATUS    suggested (default) | active
 */
import { seedSuggestedTeam } from "./fixtures/simulated-pi-host.mjs";

const cwd = process.env.KAIRO_SIM_PROJ;
const homeDir = process.env.KAIRO_SIM_HOME;
if (!cwd || !homeDir) {
  console.error("KAIRO_SIM_PROJ and KAIRO_SIM_HOME are required");
  process.exit(2);
}
process.env.HARNESS_HOME = homeDir;
const result = await seedSuggestedTeam({
  homeDir,
  cwd,
  scenario: process.env.KAIRO_SIM_PI_SCENARIO || "positive",
  status: process.env.KAIRO_SIM_SEED_STATUS || "suggested"
});
console.log(JSON.stringify({ ok: true, ...result, scenario: process.env.KAIRO_SIM_PI_SCENARIO || "positive" }));
