import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { EXECUTION_ADAPTER_IDS } from "./execution-adapters/index.js";
import { writeAtomicJson } from "./write-atomic-json.js";

const writeLocks = new Map();

export function getUsageDir(homeDir) {
  return harnessHomePaths(homeDir).usageDir;
}

/**
 * The one real boundary a provider id gets validated at before it's ever
 * used to build a path — the same defense-in-depth role
 * assertWorktreeId/assertTaskId already play elsewhere. Provider ids are a
 * real, closed list (the same one execution-adapters/index.js resolves
 * against), never a free-form string, so an unknown one is always a bug
 * to surface loudly rather than a path to silently sanitize.
 */
function usagePath(homeDir, provider) {
  if (!EXECUTION_ADAPTER_IDS.includes(provider)) {
    throw new Error(`Unknown provider "${provider}" for usage tracking. Use ${EXECUTION_ADAPTER_IDS.join(", ")}.`);
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
    if (!EXECUTION_ADAPTER_IDS.includes(provider)) continue;
    const record = await readProviderUsage(homeDir, provider);
    if (record) records.push(record);
  }
  records.sort((left, right) => left.provider.localeCompare(right.provider));
  return records;
}
