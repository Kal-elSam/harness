import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { EXECUTION_ADAPTER_IDS } from "./execution-adapters/index.js";
import { writeAtomicJson } from "./write-atomic-json.js";

const writeLocks = new Map();

// OpenCode Go and Zen share a single real execution adapter object (one
// executable, one launch/parse contract — see
// execution-adapters/index.js's own resolveExecutionAdapter doc), but
// they are NOT the same thing for usage/budget tracking: Go is a flat
// $10/mo subscription with its own weekly/monthly quota, Zen is pay-per-
// token with its own real balance — genuinely separate budgets that must
// never share one usage record. So this whitelist is deliberately wider
// than EXECUTION_ADAPTER_IDS, not a mirror of it.
const EXTRA_USAGE_PROVIDER_IDS = ["opencode-go", "opencode-zen"];
const VALID_USAGE_PROVIDER_IDS = [...EXECUTION_ADAPTER_IDS, ...EXTRA_USAGE_PROVIDER_IDS];

export function getUsageDir(homeDir) {
  return harnessHomePaths(homeDir).usageDir;
}

/**
 * The one real boundary a provider id gets validated at before it's ever
 * used to build a path — the same defense-in-depth role
 * assertWorktreeId/assertTaskId already play elsewhere. Provider ids are a
 * real, closed list, never a free-form string, so an unknown one is
 * always a bug to surface loudly rather than a path to silently sanitize.
 */
function usagePath(homeDir, provider) {
  if (!VALID_USAGE_PROVIDER_IDS.includes(provider)) {
    throw new Error(`Unknown provider "${provider}" for usage tracking. Use ${VALID_USAGE_PROVIDER_IDS.join(", ")}.`);
  }
  return join(getUsageDir(homeDir), `${provider}.json`);
}

export async function readProviderUsage(homeDir, provider) {
  const statePath = usagePath(homeDir, provider);
  if (!existsSync(statePath)) return null;

  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid provider usage state at ${statePath}: ${error.message}`);
  }
}

/** Read-modify-write is serialized per provider — same real race protection run-store.js's writeRunState already relies on. */
export async function writeProviderUsage(homeDir, provider, record) {
  const key = provider;
  const previous = writeLocks.get(key) ?? Promise.resolve();
  const next = previous.then(async () => {
    const usageDir = getUsageDir(homeDir);
    await mkdir(usageDir, { recursive: true });
    await writeAtomicJson(usagePath(homeDir, provider), record);
    return record;
  });
  writeLocks.set(key, next.catch(() => {}));
  return next;
}

export async function listProviderUsage(homeDir) {
  const usageDir = getUsageDir(homeDir);
  if (!existsSync(usageDir)) return [];

  const entries = await readdir(usageDir, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const provider = entry.name.slice(0, -".json".length);
    if (!VALID_USAGE_PROVIDER_IDS.includes(provider)) continue;
    const record = await readProviderUsage(homeDir, provider);
    if (record) records.push(record);
  }
  records.sort((left, right) => left.provider.localeCompare(right.provider));
  return records;
}
