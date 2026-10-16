import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtificialAnalysisModels } from "../src/global/observability/artificial-analysis-models.js";
import { harnessHomePaths } from "../src/global/paths.js";

const originalKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
beforeEach(() => { process.env.ARTIFICIAL_ANALYSIS_API_KEY = "aa_fixture_secret"; });
after(() => {
  if (originalKey === undefined) delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  else process.env.ARTIFICIAL_ANALYSIS_API_KEY = originalKey;
});

async function tempHome() {
  return mkdtemp(join(tmpdir(), "kairo-home-"));
}

function fakeResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test("returns unknown, never a fabricated score, when no API key is configured and there is no cache", async () => {
  const homeDir = await tempHome();
  delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  const result = await readArtificialAnalysisModels({ apiKey: "ignored", homeDir, fetchImpl: async () => { throw new Error("must not fetch without env key"); } });
  assert.equal(result.status, "unknown");
  assert.deepEqual(result.models, []);
  assert.match(result.error, /no API key/);
});

test("a successful live fetch normalizes real entries and persists a cache", async () => {
  const homeDir = await tempHome();
  const payload = {
    data: [
      {
        slug: "gpt-6-astra", name: "GPT-6 Astra (max)",
        model_creator: { slug: "openai" },
        evaluations: { artificial_analysis_intelligence_index: 52.8, artificial_analysis_coding_index: 76.9, artificial_analysis_math_index: null }
      }
    ]
  };
  const result = await readArtificialAnalysisModels({
    apiKey: "aa_test_key", homeDir, fetchImpl: async () => fakeResponse(payload)
  });
  assert.equal(result.status, "live");
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].slug, "gpt-6-astra");
  assert.equal(result.models[0].intelligenceIndex, 52.8);
  assert.equal(result.error, null);

  const onDisk = JSON.parse(await readFile(harnessHomePaths(homeDir).modelIntelligencePath, "utf8"));
  assert.equal(onDisk.models[0].slug, "gpt-6-astra");
});

test("normalizeModel also extracts real per-benchmark scores (gpqa, hle, etc.) that the free API already returns alongside the composite indices", async () => {
  const homeDir = await tempHome();
  const payload = {
    data: [{
      slug: "kimi-k3", name: "Kimi K3",
      model_creator: { slug: "moonshotai" },
      evaluations: {
        artificial_analysis_intelligence_index: 43.8, artificial_analysis_coding_index: 76.2, artificial_analysis_math_index: null,
        gpqa: 0.935, hle: 0.469, scicode: 0.595, mmlu_pro: null, livecodebench: null, ifbench: null,
        terminalbench_hard: null, terminalbench_v2_1: 0.850187265917603, tau2: null, tau_banking: 0.45979381443299
      }
    }]
  };
  const result = await readArtificialAnalysisModels({ apiKey: "aa_test_key", homeDir, fetchImpl: async () => fakeResponse(payload) });
  const model = result.models[0];
  assert.equal(model.gpqa, 0.935);
  assert.equal(model.hle, 0.469);
  assert.equal(model.sciCode, 0.595);
  assert.equal(model.terminalBenchV2, 0.850187265917603);
  assert.equal(model.tauBanking, 0.45979381443299);
  assert.equal(model.mmluPro, null); // never fabricated when AA itself reports null
});

test("falls back to a cached snapshot (marked as such, with a real age) when the live fetch fails", async () => {
  const homeDir = await tempHome();
  const payload = { data: [{ slug: "claude-opus-5", name: "Claude Opus 5", model_creator: { slug: "anthropic" }, evaluations: {} }] };
  await readArtificialAnalysisModels({ apiKey: "aa_test_key", homeDir, fetchImpl: async () => fakeResponse(payload) });

  const result = await readArtificialAnalysisModels({
    apiKey: "aa_test_key", homeDir, fetchImpl: async () => { throw new Error("network down"); }
  });
  assert.equal(result.status, "cached");
  assert.equal(result.models[0].slug, "claude-opus-5");
  assert.match(result.error, /network down/);
  assert.ok(result.age);
});

test("fails closed to unknown, never throwing, on a non-2xx response with no cache", async () => {
  const homeDir = await tempHome();
  const result = await readArtificialAnalysisModels({
    apiKey: "bad_key", homeDir, fetchImpl: async () => fakeResponse({ error: "Invalid API key." }, false, 401)
  });
  assert.equal(result.status, "unknown");
  assert.match(result.error, /401/);
});

test("normalizeModel carries Terminal-Bench v4.0 and keeps absent versions null", async () => {
  const homeDir = await tempHome();
  const result = await readArtificialAnalysisModels({
    apiKey: "aa_test_key", homeDir,
    fetchImpl: async () => fakeResponse({ data: [
      { slug: "v4-only", evaluations: { terminalbench_v4_0: 0.6 } },
      { slug: "absent", evaluations: {} }
    ] })
  });
  assert.equal(result.models[0].terminalBenchV4, 0.6);
  assert.equal(result.models[0].terminalBenchV2, null);
  assert.equal(result.models[0].terminalBenchHard, null);
  assert.equal(result.models[1].terminalBenchV4, null);
  const cached = JSON.parse(await readFile(harnessHomePaths(homeDir).modelIntelligencePath, "utf8"));
  assert.equal(cached.models[0].terminalBenchV4, 0.6);
});

// Synthetic fixtures, not a snapshot of AA data.
const legacy = { data: [{ slug: "fixture-model", name: "Fixture", evaluations: { gpqa: .8 }, pricing: { price_1m_input_tokens: 2, price_1m_output_tokens: 8 } }] };
const variant = (slug, cost) => ({ slug, name: slug, evaluations: { artificial_analysis_agentic_index: 42 }, artificial_analysis_intelligence_index_cost: { cost_per_task: { total_cost: cost } } });
async function documentedResult(rows, options = {}) {
  return readArtificialAnalysisModels({
    homeDir: await tempHome(),
    fetchImpl: async url => fakeResponse(url.includes("/language/") ? { data: rows } : legacy),
    ...options
  });
}

test("S21 pagination reads every documented page exactly once alongside legacy", async () => {
  const calls = [];
  const result = await documentedResult([], { fetchImpl: async (url, init) => {
    calls.push(url);
    assert.equal(init.headers["x-api-key"], process.env.ARTIFICIAL_ANALYSIS_API_KEY);
    if (!url.includes("/language/")) return fakeResponse(legacy);
    const page = Number(new URL(url).searchParams.get("page") ?? 1);
    return fakeResponse({ data: [variant(page === 4 ? "fixture-model-medium" : "other-" + page, page / 10)],
      pagination: { page, total_pages: 4, has_more: page < 4 } });
  } });
  assert.equal(calls.length, 5);
  assert.equal(new Set(calls).size, 5);
  assert.equal(result.models[0].costPerTask, .4);
  assert.equal(result.models[0].gpqa, .8);
});

test("S21 normalizes task cost and stores agentic index without replacing legacy benchmarks", async () => {
  const result = await documentedResult([variant("fixture-model-medium", .5)]);
  assert.equal(result.models[0].costPerTask, .5);
  assert.equal(result.models[0].agenticIndex, 42);
  assert.equal(result.models[0].gpqa, .8);
});

test("S21 effort preference is bare, then medium, then lower median cost with slug ties", async () => {
  const rows = [variant("fixture-model-high", 3), variant("fixture-model-low", 1),
    variant("fixture-model-xhigh", 5), variant("fixture-model-medium", 2), variant("fixture-model", 4)];
  for (const [input, slug, cost] of [[rows, "fixture-model", 4],
    [rows.slice(0, 4), "fixture-model-medium", 2], [rows.slice(0, 3), "fixture-model-high", 3],
    [rows.slice(0, 2), "fixture-model-low", 1]]) {
    for (const order of [input, [...input].reverse()]) {
      const model = (await documentedResult(order)).models[0];
      assert.equal(model.costPerTaskVariant, slug);
      assert.equal(model.costPerTask, cost);
    }
  }
});

test("S21 incomplete pagination falls back to cache without persisting partial costs", async () => {
  const homeDir = await tempHome();
  await documentedResult([variant("fixture-model-medium", .5)], { homeDir });
  const result = await documentedResult([], { homeDir, fetchImpl: async url => {
    if (!url.includes("/language/")) return fakeResponse(legacy);
    if (url.includes("page=2")) throw new Error("page unavailable");
    return fakeResponse({ data: [variant("fixture-model-medium", 99)], pagination: { page: 1, total_pages: 2, has_more: true } });
  } });
  assert.equal(result.status, "cached");
  assert.equal(result.models[0].costPerTask, .5);
});

test("S24 only env key is used and secrets never reach errors, cache or status", async () => {
  const key = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  const homeDir = await tempHome();
  const live = await documentedResult([variant("fixture-model-medium", .5)], { homeDir, apiKey: "must-not-be-used",
    fetchImpl: async (url, init) => {
      assert.equal(init.headers["x-api-key"], key);
      return fakeResponse(url.includes("/language/") ? { data: [variant("fixture-model-medium", .5)] }
        : { data: [{ ...legacy.data[0], name: key }] });
    } });
  assert.ok(!JSON.stringify(live).includes(key));
  assert.ok(!(await readFile(harnessHomePaths(homeDir).modelIntelligencePath, "utf8")).includes(key));
  let result;
  await assert.doesNotReject(async () => { result = await readArtificialAnalysisModels({ homeDir, fetchImpl: async () => { throw new Error("request " + key); } }); });
  assert.ok(!JSON.stringify(result).includes(key));
});

test("S21 unavailable documented endpoint leaves legacy-only selection usable without invented costs", async () => {
  const result = await documentedResult([], { fetchImpl: async url => {
    if (url.includes("/language/")) throw new Error("documented unavailable");
    return fakeResponse(legacy);
  } });
  assert.equal(result.status, "live");
  assert.equal(result.models[0].costPerTask, null);
  assert.equal(result.models[0].gpqa, .8);
  assert.match(result.error, /documented unavailable/);
});
