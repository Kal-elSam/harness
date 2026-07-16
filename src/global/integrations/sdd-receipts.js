import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { harnessHomePaths } from "../paths.js";

export function sddIntegrationsDir(homeDir) {
  return join(harnessHomePaths(homeDir).root, "integrations", "sdd-core");
}

export function assertSafeSddReceiptId(receiptId) {
  if (typeof receiptId !== "string" || !/^sdd-[A-Za-z0-9-]+$/.test(receiptId)) {
    throw new Error(`Invalid SDD receipt id "${receiptId}".`);
  }
}

export function sddReceiptPath(homeDir, receiptId) {
  assertSafeSddReceiptId(receiptId);
  return join(sddIntegrationsDir(homeDir), `${receiptId}.json`);
}

/** Persist a secret-free receipt under ~/.harness/integrations/sdd-core/. */
export async function saveSddReceipt(receipt, { homeDir } = {}) {
  assertSafeSddReceiptId(receipt.id);
  await mkdir(sddIntegrationsDir(homeDir), { recursive: true });
  const path = sddReceiptPath(homeDir, receipt.id);
  const sanitized = { ...receipt, persisted: true };
  await writeFile(path, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  return { path, receipt: sanitized };
}

export async function loadSddReceipt(receiptId, { homeDir } = {}) {
  const path = sddReceiptPath(homeDir, receiptId);
  if (!existsSync(path)) throw new Error(`SDD receipt not found: ${receiptId}`);
  return JSON.parse(await readFile(path, "utf8"));
}

export async function listSddReceipts({ homeDir } = {}) {
  const dir = sddIntegrationsDir(homeDir);
  if (!existsSync(dir)) return [];
  return (await readdir(dir))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -5))
    .sort();
}
