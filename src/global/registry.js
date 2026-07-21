import { existsSync } from "node:fs";
import { join } from "node:path";
import claude from "./adapters/claude.js";
import codex from "./adapters/codex.js";
import cursor from "./adapters/cursor.js";
import opencode from "./adapters/opencode.js";
import pi from "./adapters/pi.js";

const ADAPTERS = [cursor, codex, opencode, claude, pi];

export const GLOBAL_AGENT_IDS = ADAPTERS.map((adapter) => adapter.id);

export function isAllAgentsSelection(requestedIds) {
  return requestedIds?.length === 1 && requestedIds[0] === "all";
}

export function resolveAgentIds(requestedIds, context) {
  if (requestedIds == null) {
    const detected = detectInstalledAdapters(context);
    return detected.length > 0 ? detected : [...GLOBAL_AGENT_IDS];
  }

  if (isAllAgentsSelection(requestedIds)) {
    return [...GLOBAL_AGENT_IDS];
  }

  return validateAdapterIds(requestedIds);
}

export function listAdapters() {
  return [...ADAPTERS];
}

export function resolveAdapter(id) {
  const adapter = ADAPTERS.find((candidate) => candidate.id === id);

  if (!adapter) {
    throw new Error(`Unknown agent "${id}". Use ${GLOBAL_AGENT_IDS.join(", ")}.`);
  }

  return adapter;
}

export function validateAdapterIds(ids) {
  return ids.map((id) => resolveAdapter(id).id);
}

export function detectInstalledAdapters(context) {
  return ADAPTERS
    .filter((adapter) => adapter.detect(context))
    .map((adapter) => adapter.id);
}

export function resolveTargetAdapters(context, requestedIds = null) {
  if (requestedIds == null) {
    const detected = detectInstalledAdapters(context);
    return detected.length > 0
      ? detected.map((id) => resolveAdapter(id))
      : [...ADAPTERS];
  }

  if (isAllAgentsSelection(requestedIds)) {
    return [...ADAPTERS];
  }

  return validateAdapterIds(requestedIds).map((id) => resolveAdapter(id));
}

export function buildAdapterStateEntry(adapter, homeDir) {
  const configPath = join(homeDir, adapter.assets.configFile);

  return {
    id: adapter.id,
    label: adapter.label,
    rootDir: adapter.assets.rootDir,
    configFile: adapter.assets.configFile,
    managedTargets: [...adapter.assets.managedTargets],
    present: existsSync(configPath)
  };
}
