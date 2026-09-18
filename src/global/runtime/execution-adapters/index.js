import cursor from "./cursor.js";
import codex from "./codex.js";
import claude from "./claude.js";
import opencode from "./opencode.js";
import pi from "./pi.js";

const EXECUTION_ADAPTERS = [cursor, codex, claude, opencode, pi];

export const EXECUTION_ADAPTER_IDS = EXECUTION_ADAPTERS.map((adapter) => adapter.id);

export function listExecutionAdapters() {
  return [...EXECUTION_ADAPTERS];
}

/**
 * Resolves the real adapter object for an id — "opencode-go"/"opencode-zen"
 * both share the single real "opencode" adapter object (one executable,
 * one launch/parse contract; the Go/Zen split is a routing/eligibility
 * distinction, decided by execution-router.js's checkCandidate, never a
 * separate adapter object), the same prefix rule execution-router.js's own
 * findAdapter already uses. Never silently falls through for an unrelated
 * unknown id — only an id that is exactly "opencode" or starts with
 * "opencode-" maps this way.
 */
export function resolveExecutionAdapter(id) {
  const baseId = id === "opencode" || id.startsWith("opencode-") ? "opencode" : id;
  const adapter = EXECUTION_ADAPTERS.find((candidate) => candidate.id === baseId);
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
    reviewCompatible: Boolean(adapter.capabilities?.reviewCompatible),
    ...adapter.availability(context)
  }));
}

export function listLaunchableAdapterIds(context = {}) {
  return inspectExecutionAdapters(context)
    .filter((provider) => provider.launchable)
    .map((provider) => provider.id);
}
