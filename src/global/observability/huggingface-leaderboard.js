// Real per-benchmark leaderboard data from Hugging Face's official Datasets
// API — verified live against https://huggingface.co/api/datasets/{id}/leaderboard
// (public, no API key needed for a public benchmark dataset). One dataset
// covers exactly one benchmark (e.g. cais/hle for HLE, Idavidrein/gpqa for
// GPQA); there is no cross-benchmark aggregate endpoint here. Fails closed
// like every other observability probe: a failed fetch never fabricates a
// result, it falls back to the last successfully cached snapshot (marked
// "cached", with its real age) or "unknown" if there's no cache either.

import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

export const SOURCE = "huggingface datasets api (leaderboard)";
const DEFAULT_TIMEOUT_MS = 8000;

function apiUrl(datasetId) {
  return `https://huggingface.co/api/datasets/${datasetId}/leaderboard`;
}

function normalizeEntry(entry) {
  return {
    modelId: entry.modelId ?? null,
    value: typeof entry.value === "number" ? entry.value : null,
    rank: entry.rank ?? null,
    verified: entry.verified === true,
    notes: entry.notes ?? null
  };
}

function ageLabel(fetchedAtIso) {
  const fetchedAt = new Date(fetchedAtIso ?? "").getTime();
  if (!Number.isFinite(fetchedAt)) return null;
  const hours = (Date.now() - fetchedAt) / 3_600_000;
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

async function readAllCaches(homeDir, deps) {
  const read = deps.readFile ?? readFile;
  try {
    const raw = await read(harnessHomePaths(homeDir).huggingfaceLeaderboardPath, "utf8");
    const doc = JSON.parse(raw);
    return doc && typeof doc === "object" ? doc : {};
  } catch {
    return {};
  }
}

async function writeCache(homeDir, datasetId, snapshot, deps) {
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const path = harnessHomePaths(homeDir).huggingfaceLeaderboardPath;
  const all = await readAllCaches(homeDir, deps);
  all[datasetId] = snapshot;
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, all);
}

function fromCache(cache, error) {
  if (!cache || !Array.isArray(cache.entries) || typeof cache.fetchedAt !== "string") {
    return { status: "unknown", source: SOURCE, fetchedAt: null, age: null, entries: [], error };
  }
  return { status: "cached", source: SOURCE, fetchedAt: cache.fetchedAt, age: ageLabel(cache.fetchedAt), entries: cache.entries, error };
}

/**
 * @param {object} options
 * @param {string} options.datasetId - e.g. "cais/hle", "SWE-bench/SWE-bench_Verified", "Idavidrein/gpqa"
 * @param {string} options.homeDir - required; the cache lives under this harness home
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 */
export async function readHuggingFaceLeaderboard({
  datasetId, homeDir, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, ...deps
} = {}) {
  if (!datasetId) return { status: "unknown", source: SOURCE, fetchedAt: null, age: null, entries: [], error: "datasetId is required" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(apiUrl(datasetId), { signal: controller.signal });
    if (!response.ok) throw new Error(`huggingface leaderboard api returned ${response.status}`);
    const payload = await response.json();
    const entries = Array.isArray(payload) ? payload.map(normalizeEntry) : [];
    const fetchedAt = new Date().toISOString();
    await writeCache(homeDir, datasetId, { fetchedAt, entries }, deps).catch(() => {});
    return { status: "live", source: SOURCE, fetchedAt, age: "<1h", entries, error: null };
  } catch (error) {
    const all = await readAllCaches(homeDir, deps);
    return fromCache(all[datasetId], error?.message ?? String(error));
  } finally {
    clearTimeout(timer);
  }
}
