import { existsSync } from "node:fs";
import { harnessHomePaths } from "./paths.js";

export const INITIAL_EXPERIENCE = {
  ONBOARDING: "onboarding",
  DASHBOARD: "dashboard"
};

/**
 * First-run marker is ~/.harness/state.json only.
 * profile.json does not participate in this decision.
 */
export function hasConfiguredGlobalState(homeDir) {
  return existsSync(harnessHomePaths(homeDir).statePath);
}

/**
 * Pure resolver for the interactive bare-entry experience.
 * Returns null when CLI should keep existing non-onboarding paths
 * (non-TTY, explicit commands, setup flags already routed elsewhere).
 */
export function resolveInitialExperience({
  interactive = false,
  isImplicitCommand = false,
  hasGlobalState = false
} = {}) {
  if (!interactive || !isImplicitCommand) {
    return null;
  }

  return hasGlobalState
    ? INITIAL_EXPERIENCE.DASHBOARD
    : INITIAL_EXPERIENCE.ONBOARDING;
}
