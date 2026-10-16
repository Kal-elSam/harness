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
const DOCUMENTED_URL = "https://artificialanalysis.ai/api/v2/language/models/free";
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
    agenticIndex: evaluations.artificial_analysis_agentic_index ?? null,
    costPerTask: finiteCost(entry.artificial_analysis_intelligence_index_cost?.cost_per_task?.total_cost),
    costPerTaskVariant: null,
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
    terminalBenchV4: evaluations.terminalbench_v4_0 ?? null,
    tau2: evaluations.tau2 ?? null,
    tauBanking: evaluations.tau_banking ?? null,
    // Real reported numbers, not derived scores — used to flag the
    // cheapest/fastest real option among what you actually have access to,
    // never blended into a single invented composite.
    priceInputPerMTok: entry.pricing?.price_1m_input_tokens ?? null,
    priceOutputPerMTok: entry.pricing?.price_1m_output_tokens ?? null,
    outputTokensPerSecond: entry.performance?.median_output_tokens_per_second ?? entry.median_output_tokens_per_second ?? null
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

const finiteCost = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const bareSlug = slug => String(slug ?? "").replace(/-(?:low|medium|high|xhigh)$/, "");

// Kairo cannot set effort: prefer bare, then medium, then lower median cost.
// Unknown costs sort last; lexical slug breaks equal-cost ties independently
// of response/page order. This is a representative measurement, not a blend.
function mergeDocumented(models, entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (typeof entry.slug !== "string" || !entry.slug) continue;
    const bare = bareSlug(entry.slug);
    if (!groups.has(bare)) groups.set(bare, []);
    groups.get(bare).push(entry);
  }
  const bySlug = new Map(models.map(model => [model.slug, model]));
  for (const [bare, variants] of groups) {
    const ordered = [...variants].sort((a, b) => {
      const ac = finiteCost(a.artificial_analysis_intelligence_index_cost?.cost_per_task?.total_cost);
      const bc = finiteCost(b.artificial_analysis_intelligence_index_cost?.cost_per_task?.total_cost);
      return (ac ?? Infinity) - (bc ?? Infinity) || a.slug.localeCompare(b.slug);
    });
    const priced = ordered.filter(entry => finiteCost(entry.artificial_analysis_intelligence_index_cost?.cost_per_task?.total_cost) != null);
    const selected = ordered.find(entry => entry.slug === bare)
      ?? ordered.find(entry => entry.slug === bare + "-medium")
      ?? (priced.length ? priced[Math.floor((priced.length - 1) / 2)] : ordered[0]);
    const normalized = normalizeModel(selected);
    const legacy = bySlug.get(bare);
    bySlug.set(bare, {
      ...(legacy ?? { ...normalized, slug: bare }),
      costPerTask: normalized.costPerTask,
      costPerTaskVariant: selected.slug,
      agenticIndex: normalized.agenticIndex
    });
  }
  return [...bySlug.values()];
}

// Never expose transport errors or reflected response strings containing the
// environment secret. Whitelist normalized fields; never cache raw API payloads.
function redact(value, key) {
  if (typeof value === "string") return key ? value.split(key).join("[redacted]") : value;
  if (Array.isArray(value)) return value.map(item => redact(item, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, key)]));
  return value;
}

/** The API key is read exclusively from ARTIFICIAL_ANALYSIS_API_KEY. */
export async function readArtificialAnalysisModels({
  homeDir, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, ...deps
} = {}) {
  const apiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY ?? null;
  const cached = async error => redact(fromCache(await readCache(homeDir, deps), error), apiKey);
  if (!apiKey) return cached("no API key configured");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const request = async url => {
    const response = await fetchImpl(url, { headers: { "x-api-key": apiKey }, signal: controller.signal });
    if (!response.ok) throw new Error(`artificial analysis api returned ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.data)) throw new Error("invalid artificial analysis data");
    return payload;
  };
  const documented = async () => {
    const entries = [];
    for (let page = 1; ; page++) {
      const payload = await request(page === 1 ? DOCUMENTED_URL : `${DOCUMENTED_URL}?page=${page}`);
      entries.push(...payload.data);
      const pagination = payload.pagination;
      if (!pagination) {
        if (page !== 1) throw new Error("missing artificial analysis pagination");
        break;
      }
      if (pagination.page !== page || !Number.isInteger(pagination.total_pages)
        || pagination.total_pages < page || pagination.total_pages > 100
        || pagination.has_more !== (page < pagination.total_pages)) throw new Error("invalid artificial analysis pagination");
      if (!pagination.has_more) break;
    }
    return entries;
  };
  try {
    // One legacy request plus each documented page once per caller refresh.
    // No retries: preserve the free tier's limited daily request budget.
    const [legacy, extra] = await Promise.allSettled([request(API_URL), documented()]);
    if (legacy.status === "rejected") throw legacy.reason;
    if (extra.status === "rejected") {
      const fallback = await cached(extra.reason?.message ?? "artificial analysis fetch failed");
      if (fallback.status === "cached") return fallback;
      // Legacy-only remains useful when no documented snapshot exists.
      return redact({ ...fallback, status: "live", fetchedAt: new Date().toISOString(), age: "<1h",
        models: legacy.value.data.map(normalizeModel) }, apiKey);
    }
    const models = redact(mergeDocumented(legacy.value.data.map(normalizeModel), extra.value), apiKey);
    const fetchedAt = new Date().toISOString();
    await writeCache(homeDir, { fetchedAt, models }, deps).catch(() => {});
    return { status: "live", source: SOURCE, fetchedAt, age: "<1h", models, error: null };
  } catch (error) {
    return cached(redact(error?.message ?? "artificial analysis fetch failed", apiKey));
  } finally {
    clearTimeout(timer);
  }
}
