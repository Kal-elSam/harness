import cursor from "./cursor.js";
import codex from "./codex.js";
import claude from "./claude.js";
import opencode from "./opencode.js";

const EXECUTION_ADAPTERS = [cursor, codex, claude, opencode];

export const EXECUTION_ADAPTER_IDS = EXECUTION_ADAPTERS.map((adapter) => adapter.id);

export function listExecutionAdapters() {
  return [...EXECUTION_ADAPTERS];
}

export function resolveExecutionAdapter(id) {
  const adapter = EXECUTION_ADAPTERS.find((candidate) => candidate.id === id);
  if (!adapter) {
    throw new Error(`Unknown execution adapter "${id}". Use ${EXECUTION_ADAPTER_IDS.join(", ")}.`);
  }
  return adapter;
}

export function inspectExecutionAdapters(context = {}) {
  return EXECUTION_ADAPTERS.map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    executable: adapter.executable,
    capabilities: adapter.capabilities,
    ...adapter.availability(context)
  }));
}

export function listLaunchableAdapterIds(context = {}) {
  return inspectExecutionAdapters(context)
    .filter((provider) => provider.launchable)
    .map((provider) => provider.id);
}
