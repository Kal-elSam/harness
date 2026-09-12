import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArtificialAnalysisModels } from "../src/global/observability/artificial-analysis-models.js";
import { harnessHomePaths } from "../src/global/paths.js";

async function tempHome() {
  return mkdtemp(join(tmpdir(), "kairo-home-"));
}

function fakeResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test("returns unknown, never a fabricated score, when no API key is configured and there is no cache", async () => {
  const homeDir = await tempHome();
  const result = await readArtificialAnalysisModels({ apiKey: null, homeDir });
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
