// Real per-model benchmark scores from Artificial Analysis's official Data
// API (verified live against https://artificialanalysis.ai/api/v2/data/llms/models
// — not scraped from their leaderboard website, which has no stable JSON
// endpoint). Fails closed like every other observability probe: no API key
// or a failed fetch never fabricates a score, it falls back to the last
// successfully cached snapshot (marked "cached", with its real age) or
// "unknown" if there's no cache either.

import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { harnessHomePaths } from "../paths.js";
import { writeAtomicJson } from "../runtime/write-atomic-json.js";

export const SOURCE = "artificial-analysis api v2 (data/llms/models)";
const API_URL = "https://artificialanalysis.ai/api/v2/data/llms/models";
const DEFAULT_TIMEOUT_MS = 8000;

function normalizeModel(entry) {
  const evaluations = entry.evaluations ?? {};
  return {
    slug: entry.slug,
    name: entry.name,
    creator: entry.model_creator?.slug ?? null,
    intelligenceIndex: evaluations.artificial_analysis_intelligence_index ?? null,
    codingIndex: evaluations.artificial_analysis_coding_index ?? null,
    mathIndex: evaluations.artificial_analysis_math_index ?? null,
    // Real per-benchmark scores the free API already returns alongside the
    // composite indices above — verified live (not documented anywhere as
    // a free-tier feature, an earlier assumption here was wrong). These
    // matter because the composite intelligenceIndex can blur a real,
    // benchmark-specific near-tie: e.g. two models 18% apart on the
    // composite can be 0.2 points apart on GPQA specifically. Real,
    // 0-1 scale values as AA reports them — never rescaled or blended.
    gpqa: evaluations.gpqa ?? null,
    hle: evaluations.hle ?? null,
    sciCode: evaluations.scicode ?? null,
    mmluPro: evaluations.mmlu_pro ?? null,
    liveCodeBench: evaluations.livecodebench ?? null,
    ifBench: evaluations.ifbench ?? null,
    terminalBenchHard: evaluations.terminalbench_hard ?? null,
    terminalBenchV2: evaluations.terminalbench_v2_1 ?? null,
    tau2: evaluations.tau2 ?? null,
    tauBanking: evaluations.tau_banking ?? null,
    // Real reported numbers, not derived scores — used to flag the
    // cheapest/fastest real option among what you actually have access to,
    // never blended into a single invented composite.
    priceInputPerMTok: entry.pricing?.price_1m_input_tokens ?? null,
    priceOutputPerMTok: entry.pricing?.price_1m_output_tokens ?? null,
    outputTokensPerSecond: entry.median_output_tokens_per_second ?? null
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

async function readCache(homeDir, deps) {
  const read = deps.readFile ?? readFile;
  try {
    const raw = await read(harnessHomePaths(homeDir).modelIntelligencePath, "utf8");
    const doc = JSON.parse(raw);
    if (!Array.isArray(doc?.models) || typeof doc.fetchedAt !== "string") return null;
    return doc;
  } catch {
    return null;
  }
}

async function writeCache(homeDir, doc, deps) {
  const mkdirImpl = deps.mkdir ?? mkdir;
  const writeJson = deps.writeAtomicJson ?? writeAtomicJson;
  const path = harnessHomePaths(homeDir).modelIntelligencePath;
  await mkdirImpl(dirname(path), { recursive: true });
  await writeJson(path, doc);
}

function fromCache(cache, error) {
  if (!cache) return { status: "unknown", source: SOURCE, fetchedAt: null, age: null, models: [], error };
  return { status: "cached", source: SOURCE, fetchedAt: cache.fetchedAt, age: ageLabel(cache.fetchedAt), models: cache.models, error };
}

/**
 * @param {object} [options]
 * @param {string|null} [options.apiKey] - defaults to ARTIFICIAL_ANALYSIS_API_KEY; never hardcode a key
 * @param {string} options.homeDir - required; the cache lives under this harness home
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 */
export async function readArtificialAnalysisModels({
  apiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY ?? null,
  homeDir,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  ...deps
} = {}) {
  if (!apiKey) return fromCache(await readCache(homeDir, deps), "no API key configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(API_URL, { headers: { "x-api-key": apiKey }, signal: controller.signal });
    if (!response.ok) throw new Error(`artificial analysis api returned ${response.status}`);
    const payload = await response.json();
    const models = Array.isArray(payload?.data) ? payload.data.map(normalizeModel) : [];
    const fetchedAt = new Date().toISOString();
    await writeCache(homeDir, { fetchedAt, models }, deps).catch(() => {});
    return { status: "live", source: SOURCE, fetchedAt, age: "<1h", models, error: null };
  } catch (error) {
    return fromCache(await readCache(homeDir, deps), error?.message ?? String(error));
  } finally {
    clearTimeout(timer);
  }
}
