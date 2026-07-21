import { resolve } from "node:path";
import { createManagedConfigAdapter } from "../managed-config-adapter.js";

export const PI_DEFAULT_ROOT_DIR = ".pi/agent";
export const PI_DEFAULT_CONFIG_FILE = ".pi/agent/AGENTS.md";
export const PI_CODING_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

const CUSTOM_DIR_MESSAGE =
  `Pi config writes are unsupported when ${PI_CODING_AGENT_DIR_ENV} points away from `
  + `~/${PI_DEFAULT_ROOT_DIR} (out of scope for Kairo 0.6.0). `
  + `Unset ${PI_CODING_AGENT_DIR_ENV} to manage the default directory; runtime launches remain available.`;

/** True when PI_CODING_AGENT_DIR is set to a non-default absolute/relative path. */
export function isCustomPiCodingAgentDir(env = process.env, homeDir) {
  const raw = env?.[PI_CODING_AGENT_DIR_ENV];
  if (raw == null || String(raw).trim() === "") return false;
  if (homeDir == null) return true;
  return resolve(String(raw).trim()) !== resolve(homeDir, PI_DEFAULT_ROOT_DIR);
}

export function assertDefaultPiConfigDir(context = {}) {
  const env = context.env ?? process.env;
  if (isCustomPiCodingAgentDir(env, context.homeDir)) {
    throw new Error(CUSTOM_DIR_MESSAGE);
  }
}

const managed = createManagedConfigAdapter({
  id: "pi",
  label: "Pi",
  rootDir: PI_DEFAULT_ROOT_DIR,
  configFile: PI_DEFAULT_CONFIG_FILE
});

/** Managed adapter for ~/.pi/agent/AGENTS.md; custom PI_CODING_AGENT_DIR fails before writes. */
export default {
  ...managed,

  plan(context) {
    assertDefaultPiConfigDir(context);
    return managed.plan(context);
  },

  async apply(context, plan) {
    assertDefaultPiConfigDir(context);
    return managed.apply(context, plan);
  },

  async uninstall(context, stateEntry) {
    assertDefaultPiConfigDir(context);
    return managed.uninstall(context, stateEntry);
  }
};
