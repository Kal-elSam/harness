import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { inspectEngramAgentConfig } from "./engram-evidence.js";

const MEMORY_DB = /engram\.db$/i;

export function engramIntegrationsDir(homeDir) {
  return join(harnessHomePaths(homeDir).root, "integrations", "engram");
}

export function engramReceiptPath(homeDir, receiptId) {
  assertSafeReceiptId(receiptId);
  return join(engramIntegrationsDir(homeDir), `${receiptId}.json`);
}

export function engramReceiptBackupDir(homeDir, receiptId) {
  assertSafeReceiptId(receiptId);
  return join(engramIntegrationsDir(homeDir), "backups", receiptId);
}

export function assertSafeReceiptId(receiptId) {
  if (typeof receiptId !== "string" || !/^engram-[A-Za-z0-9-]+$/.test(receiptId)) {
    throw new Error(`Invalid Engram receipt id "${receiptId}".`);
  }
}

export function hashFileContents(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export async function hashFileIfPresent(path) {
  if (!existsSync(path)) return null;
  if (MEMORY_DB.test(path)) throw new Error("Refusing to hash Engram memory database.");
  return hashFileContents(await readFile(path));
}

export async function captureEngramObservedFiles(agentIds, { homeDir } = {}) {
  const files = [];
  for (const agentId of agentIds) {
    for (const item of inspectEngramAgentConfig(agentId, { homeDir }).evidence) {
      if (MEMORY_DB.test(item.path)) continue;
      const hash = await hashFileIfPresent(item.path);
      files.push({
        agentId,
        path: item.path,
        kind: item.kind,
        ownership: item.kind === "plugin" ? "provider" : "kairo",
        present: hash != null,
        hash
      });
    }
  }
  return files;
}

export function diffEngramObservedFiles(before = [], after = []) {
  const beforeByPath = new Map(before.map((e) => [e.path, e]));
  const afterByPath = new Map(after.map((e) => [e.path, e]));
  const changes = [];
  for (const path of new Set([...beforeByPath.keys(), ...afterByPath.keys()])) {
    const prev = beforeByPath.get(path);
    const next = afterByPath.get(path);
    if (!prev?.present && next?.present) {
      changes.push({
        path, agentId: next.agentId, kind: next.kind, ownership: next.ownership,
        change: "created", beforeHash: null, afterHash: next.hash
      });
    } else if (prev?.present && next?.present && prev.hash !== next.hash) {
      changes.push({
        path, agentId: next.agentId, kind: next.kind, ownership: next.ownership,
        change: "modified", beforeHash: prev.hash, afterHash: next.hash
      });
    }
  }
  return changes;
}

export async function backupObservedFiles(before, { homeDir, receiptId } = {}) {
  const backups = [];
  const root = engramReceiptBackupDir(homeDir, receiptId);
  for (const entry of before) {
    if (!entry.present || entry.ownership !== "kairo") continue;
    const backupPath = join(root, Buffer.from(entry.path).toString("base64url"));
    await mkdir(root, { recursive: true });
    await copyFile(entry.path, backupPath);
    backups.push({ path: entry.path, backupPath, beforeHash: entry.hash });
  }
  return backups;
}

export async function saveEngramReceipt(receipt, { homeDir } = {}) {
  assertSafeReceiptId(receipt.id);
  if (receipt.touchedMemoryDb) {
    throw new Error("Refusing to persist a receipt that touched the Engram memory database.");
  }
  await mkdir(engramIntegrationsDir(homeDir), { recursive: true });
  const path = engramReceiptPath(homeDir, receipt.id);
  const sanitized = { ...receipt, persisted: true };
  await writeFile(path, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
  return { path, receipt: sanitized };
}

export async function loadEngramReceipt(receiptId, { homeDir } = {}) {
  const path = engramReceiptPath(homeDir, receiptId);
  if (!existsSync(path)) throw new Error(`Engram receipt not found: ${receiptId}`);
  return JSON.parse(await readFile(path, "utf8"));
}

export async function listEngramReceipts({ homeDir } = {}) {
  const dir = engramIntegrationsDir(homeDir);
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)).sort();
}
