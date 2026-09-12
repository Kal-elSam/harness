import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHuggingFaceLeaderboard } from "../src/global/observability/huggingface-leaderboard.js";
import { harnessHomePaths } from "../src/global/paths.js";

async function tempHome() {
  return mkdtemp(join(tmpdir(), "kairo-home-"));
}

function fakeResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

// Shaped exactly like the real payload verified live against
// https://huggingface.co/api/datasets/cais/hle/leaderboard
const REAL_SHAPED_PAYLOAD = [
  { rank: 2, filename: ".eval_results/hle.yaml", value: 62.5, modelId: "zai-org/GLM-5.3", notes: "With tools.", verified: false },
  { rank: 4, filename: ".eval_results/hle.yaml", value: 56, modelId: "moonshotai/Kimi-K3", verified: false }
];

test("returns unknown, never a fabricated result, when no datasetId is given", async () => {
  const homeDir = await tempHome();
  const result = await readHuggingFaceLeaderboard({ homeDir });
  assert.equal(result.status, "unknown");
  assert.deepEqual(result.entries, []);
  assert.match(result.error, /datasetId/);
});

test("a successful live fetch normalizes real entries and persists a cache", async () => {
  const homeDir = await tempHome();
  const result = await readHuggingFaceLeaderboard({
    datasetId: "cais/hle", homeDir, fetchImpl: async () => fakeResponse(REAL_SHAPED_PAYLOAD)
  });
  assert.equal(result.status, "live");
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].modelId, "zai-org/GLM-5.3");
  assert.equal(result.entries[0].value, 62.5);
  assert.equal(result.entries[0].verified, false);
  assert.equal(result.error, null);

  const onDisk = JSON.parse(await readFile(harnessHomePaths(homeDir).huggingfaceLeaderboardPath, "utf8"));
  assert.equal(onDisk["cais/hle"].entries[0].modelId, "zai-org/GLM-5.3");
});

test("caches per dataset id — fetching a second dataset never clobbers the first's cache", async () => {
  const homeDir = await tempHome();
  await readHuggingFaceLeaderboard({ datasetId: "cais/hle", homeDir, fetchImpl: async () => fakeResponse(REAL_SHAPED_PAYLOAD) });
  await readHuggingFaceLeaderboard({
    datasetId: "Idavidrein/gpqa", homeDir,
    fetchImpl: async () => fakeResponse([{ rank: 1, value: 93.5, modelId: "moonshotai/Kimi-K3", verified: false }])
  });

  const hle = await readHuggingFaceLeaderboard({ datasetId: "cais/hle", homeDir, fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(hle.status, "cached");
  assert.equal(hle.entries.length, 2);

  const gpqa = await readHuggingFaceLeaderboard({ datasetId: "Idavidrein/gpqa", homeDir, fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(gpqa.status, "cached");
  assert.equal(gpqa.entries[0].modelId, "moonshotai/Kimi-K3");
});

test("falls back to a cached snapshot (marked as such, with a real age) when the live fetch fails", async () => {
  const homeDir = await tempHome();
  await readHuggingFaceLeaderboard({ datasetId: "cais/hle", homeDir, fetchImpl: async () => fakeResponse(REAL_SHAPED_PAYLOAD) });

  const result = await readHuggingFaceLeaderboard({
    datasetId: "cais/hle", homeDir, fetchImpl: async () => { throw new Error("network down"); }
  });
  assert.equal(result.status, "cached");
  assert.equal(result.entries.length, 2);
  assert.match(result.error, /network down/);
  assert.ok(result.age);
});

test("fails closed to unknown, never throwing, on a non-2xx response with no cache", async () => {
  const homeDir = await tempHome();
  const result = await readHuggingFaceLeaderboard({
    datasetId: "cais/hle", homeDir, fetchImpl: async () => fakeResponse({ error: "not found" }, false, 404)
  });
  assert.equal(result.status, "unknown");
  assert.match(result.error, /404/);
});
