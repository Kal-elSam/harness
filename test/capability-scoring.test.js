import test from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";
import { ingestArtificialAnalysisEvidence } from "../src/global/intelligence/model-capability-registry-sources.js";
import { ROLE_METRIC_WEIGHTS } from "../src/global/intelligence/role-profiles.js";
import {
  activeBenchmarkCountForCapability, computeCapabilityGapValue, computeCapabilityPercentile, computeRoleEvaluations, computeRoleGapValue,
  countModelBenchmarks, isCapabilityComparable, renormalizedWeights, weightedAverage
} from "../src/global/intelligence/capability-scoring.js";

function addEvidence(registry, model, metric, value, opts = {}) {
  const id = registry.registerIdentity(model.adapterId, model.modelId, model.displayName ?? null);
  registry.addEvidence(id, {
    metric, value, source: opts.source ?? "test-source", scale: opts.scale ?? null,
    benchmarkVersion: opts.benchmarkVersion ?? null, date: opts.date ?? "2026-01-01", verified: opts.verified ?? false, vendorReported: opts.vendorReported ?? false
  });
}

const claude = { adapterId: "claude", modelId: "claude-x" };
const codex = { adapterId: "codex", modelId: "codex-x" };
const go = { adapterId: "opencode-go", modelId: "go-x" };

test("percentile ranks a real 3-model cohort correctly, highest real score gets percentile 1", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "gpqa", 0.90);
  addEvidence(registry, codex, "gpqa", 0.70);
  addEvidence(registry, go, "gpqa", 0.50);

  const scores = computeCapabilityPercentile(registry, [claude, codex, go], "reasoning");
  assert.equal(scores.get("claude::claude-x").percentile, 1);
  assert.equal(scores.get("codex::codex-x").percentile, 0.5);
  assert.equal(scores.get("opencode-go::go-x").percentile, 0);
});

test("a benchmark with only one real result produces no percentile at all — never a fabricated single-model 100th percentile", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "gpqa", 0.90);
  const scores = computeCapabilityPercentile(registry, [claude, codex], "reasoning");
  assert.equal(scores.size, 0);
});

test("the same real benchmark reported under two different source key names counts once, not twice", () => {
  // gpqa (AA-style) and gpqa-diamond (manufacturer-style) are aliases of
  // the SAME real GPQA benchmark identity — deduped via verified-then-
  // recent, exactly like bestEvidence.
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "gpqa", 0.80, { source: "artificial-analysis-free", verified: false, date: "2026-01-01" });
  addEvidence(registry, claude, "gpqa-diamond", 0.96, { source: "openai-official", verified: false, date: "2026-02-01" });
  addEvidence(registry, codex, "gpqa-diamond", 0.85, { source: "openai-official", verified: false, date: "2026-02-01" });

  const scores = computeCapabilityPercentile(registry, [claude, codex], "reasoning");
  // Only ONE gpqa data point per model contributes (the more recent
  // gpqa-diamond, 0.96 for claude) — if both aliases counted separately,
  // claude would show 2 benchmarkCount instead of 1.
  assert.equal(scores.get("claude::claude-x").benchmarkCount, 1);
});

test("percentile ranking normalizes cross-scale evidence before comparing — a 0-1 'unit' result is never compared raw against a 0-100 'hundred' result", () => {
  // Both are real terminal-bench aliases (terminalBenchV2: "unit",
  // terminal-bench: "hundred") of the SAME benchmark identity. Claude's
  // real 0.64 (64%) is actually ahead of Codex's real 57.9/100 (57.9%) —
  // but a naive raw comparison (0.64 < 57.9) would rank Codex first.
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "terminalBenchV2", 0.64);
  addEvidence(registry, codex, "terminal-bench", 57.9);

  const scores = computeCapabilityPercentile(registry, [claude, codex], "terminalExecution");
  assert.equal(scores.get("claude::claude-x").percentile, 1, "0.64 (64%) is the real leader, not 57.9 raw (misread as 100x too large)");
  assert.equal(scores.get("codex::codex-x").percentile, 0);
});

test("REGRESSION: the SAME metric name from two real sources that report in genuinely different scales is normalized per-evidence, never guessed from the metric name alone — the real bug that let a Hugging Face HLE score (0-100) get compared raw against Artificial Analysis's own HLE (0-1)", () => {
  // Live-verified real data: DeepSeek-V4.1-Flash's real HLE via Hugging
  // Face is 63.9 (a 0-100 score), while a real AA-sourced "hle" entry for
  // another model is a genuine 0-1 fraction (e.g. 0.50 = 50%). Without a
  // per-evidence scale, both shared capability-scoring.js's single
  // metric-name-based "unit" assumption — HF's 63.9 stayed 63.9,
  // dwarfing any real 0-1 evidence and making a thinly-evidenced model
  // look decisively ahead of a properly, broadly-measured one.
  const registry = createCapabilityRegistry();
  addEvidence(registry, go, "hle", 63.9, { source: "huggingface-leaderboard", scale: "hundred" });
  addEvidence(registry, claude, "hle", 0.50, { source: "artificial-analysis-free", scale: "unit" });

  const scores = computeCapabilityPercentile(registry, [claude, go], "reasoning");
  // Real, correctly-scaled comparison: 0.639 (63.9%) is still ahead of
  // 0.50 (50%) — go genuinely wins here, but only after real, honest
  // unit conversion, not because 63.9 dwarfed 0.50 by two orders of
  // magnitude.
  assert.equal(scores.get("opencode-go::go-x").percentile, 1);
  assert.equal(scores.get("claude::claude-x").percentile, 0);

  const gapValues = computeRoleGapValue(registry, [claude, go], ["reasoning"]);
  // The real, scale-normalized magnitude must never exceed 1 — a raw,
  // unconverted 63.9 would have produced a nonsensical gap value far
  // outside any real 0-1 range.
  assert.ok(gapValues.get("opencode-go::go-x") <= 1, `expected a real 0-1 gapValue, got ${gapValues.get("opencode-go::go-x")}`);
  assert.ok(gapValues.get("opencode-go::go-x") > gapValues.get("claude::claude-x"));
});

test("distinct real benchmarks within a capability are never merged — GPQA and HLE stay separate contributions to the median", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "gpqa", 0.90);
  addEvidence(registry, codex, "gpqa", 0.50);
  addEvidence(registry, claude, "hle", 0.30);
  addEvidence(registry, codex, "hle", 0.70);

  const scores = computeCapabilityPercentile(registry, [claude, codex], "reasoning");
  // claude: gpqa percentile 1, hle percentile 0 -> median 0.5
  // codex: gpqa percentile 0, hle percentile 1 -> median 0.5
  assert.equal(scores.get("claude::claude-x").benchmarkCount, 2);
  assert.equal(scores.get("claude::claude-x").percentile, 0.5);
  assert.equal(scores.get("codex::codex-x").percentile, 0.5);
});

test("the capability median resists a single outlier benchmark", () => {
  const registry = createCapabilityRegistry();
  // claude wins gpqa and hle decisively, but loses mmlu-pro badly (an
  // outlier) — the median should still reflect claude's real, consistent
  // strength rather than being dragged down by the one outlier.
  addEvidence(registry, claude, "gpqa", 0.95);
  addEvidence(registry, codex, "gpqa", 0.40);
  addEvidence(registry, claude, "hle", 0.90);
  addEvidence(registry, codex, "hle", 0.30);
  addEvidence(registry, claude, "mmluPro", 0.10);
  addEvidence(registry, codex, "mmluPro", 0.99);

  const scores = computeCapabilityPercentile(registry, [claude, codex], "reasoning");
  // claude: percentiles [1, 1, 0] -> median 1
  assert.equal(scores.get("claude::claude-x").percentile, 1);
  // codex: percentiles [0, 0, 1] -> median 0
  assert.equal(scores.get("codex::codex-x").percentile, 0);
});

test("composite index is used as a fallback only when no component benchmark produced any real cohort", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "intelligenceIndex", 90);
  addEvidence(registry, codex, "intelligenceIndex", 60);
  const scores = computeCapabilityPercentile(registry, [claude, codex], "reasoning");
  assert.equal(scores.get("claude::claude-x").percentile, 1);
  assert.equal(scores.get("codex::codex-x").percentile, 0);
});

test("composite index is never counted alongside real component benchmarks — no double counting", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "gpqa", 0.60);
  addEvidence(registry, codex, "gpqa", 0.90);
  // Both models also report intelligenceIndex — if it were blended in
  // too, claude's benchmarkCount would be 2, not 1.
  addEvidence(registry, claude, "intelligenceIndex", 95);
  addEvidence(registry, codex, "intelligenceIndex", 50);
  const scores = computeCapabilityPercentile(registry, [claude, codex], "reasoning");
  assert.equal(scores.get("claude::claude-x").benchmarkCount, 1);
  // Real component (gpqa) decides — codex wins despite a lower composite index.
  assert.equal(scores.get("codex::codex-x").percentile, 1);
});

test("tauBanking is never treated as softwareExecution capability evidence", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "tauBanking", 0.90);
  addEvidence(registry, codex, "tauBanking", 0.10);
  const scores = computeCapabilityPercentile(registry, [claude, codex], "softwareExecution");
  assert.equal(scores.size, 0, "tauBanking must never contribute to softwareExecution scoring");
});

test("a model with zero real evidence for any relevant capability never competes for the role", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "gpqa", 0.90);
  addEvidence(registry, codex, "gpqa", 0.50);
  // go has no evidence at all for reasoning.
  const evaluations = computeRoleEvaluations(registry, [claude, codex, go], "Explorer", ["reasoning"]);
  assert.ok(evaluations.has("claude::claude-x"));
  assert.ok(evaluations.has("codex::codex-x"));
  assert.ok(!evaluations.has("opencode-go::go-x"), "a model with no real evidence must be entirely absent, never scored as zero");
});

test("missing evidence for one relevant capability reduces coverage, never introduces a zero into the score", () => {
  const registry = createCapabilityRegistry();
  // All three models score on reasoning. Only claude and go have real
  // coding evidence — a genuine 2-model cohort codex is simply absent
  // from (codex has zero coding evidence at all), so claude/go keep full
  // coding coverage while codex's coverage drops for that one capability.
  addEvidence(registry, claude, "gpqa", 0.80);
  addEvidence(registry, codex, "gpqa", 0.60);
  addEvidence(registry, go, "gpqa", 0.40);
  addEvidence(registry, claude, "liveCodeBench", 0.70);
  addEvidence(registry, go, "liveCodeBench", 0.30);
  const evaluations = computeRoleEvaluations(registry, [claude, codex, go], "Debugger", ["reasoning", "coding"]);
  const claudeEval = evaluations.get("claude::claude-x");
  const codexEval = evaluations.get("codex::codex-x");
  assert.equal(claudeEval.coverage, 1);
  assert.equal(codexEval.coverage, 0.5, "codex only has real evidence for 1 of 2 relevant capabilities");
  // codex's score is the median of its ONE real capability score (reasoning
  // percentile 0.5 — middle of the 3-way gpqa cohort), not an average
  // dragged down by a fabricated coding zero.
  assert.equal(codexEval.capabilityPercentile, 0.5);
  assert.ok(!("coding" in codexEval.capabilities), "an uncovered capability must be absent from the breakdown, never present as 0");
});

test("confidence is high only with real coverage >=70% AND at least one verified contributing benchmark, AND real benchmark-comparable coverage (not provisional)", () => {
  const registry = createCapabilityRegistry();
  // reasoning needs 2 of its 3 real active benchmarks (gpqa/hle/mmlu-pro)
  // to be comparable, not provisional — gpqa alone would cap this at
  // "medium" even with full coverage and verified sources (see the
  // REGRESSION test below for that exact case).
  addEvidence(registry, claude, "gpqa", 0.90, { verified: true });
  addEvidence(registry, codex, "gpqa", 0.50, { verified: true });
  addEvidence(registry, claude, "hle", 0.85, { verified: true });
  addEvidence(registry, codex, "hle", 0.45, { verified: true });
  addEvidence(registry, claude, "liveCodeBench", 0.80, { verified: true });
  addEvidence(registry, codex, "liveCodeBench", 0.60, { verified: true });
  const evaluations = computeRoleEvaluations(registry, [claude, codex], "Debugger", ["reasoning", "coding"]);
  assert.equal(evaluations.get("claude::claude-x").confidence, "high");
});

test("REGRESSION: a provisional candidate can never reach 'high' confidence, even with full coverage and a verified source — one real benchmark out of reasoning's three real active ones stays capped at 'medium'", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "gpqa", 0.90, { verified: true });
  addEvidence(registry, codex, "gpqa", 0.50, { verified: true });
  addEvidence(registry, claude, "liveCodeBench", 0.80, { verified: true });
  addEvidence(registry, codex, "liveCodeBench", 0.60, { verified: true });
  const evaluations = computeRoleEvaluations(registry, [claude, codex], "Debugger", ["reasoning", "coding"]);
  const claudeEval = evaluations.get("claude::claude-x");
  assert.equal(claudeEval.isProvisional, true);
  assert.deepEqual(claudeEval.provisionalCapabilities, ["reasoning"]);
  assert.equal(claudeEval.confidence, "medium");
});

test("confidence drops to medium without a verified source, even at full coverage", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "gpqa", 0.90, { verified: false });
  addEvidence(registry, codex, "gpqa", 0.50, { verified: false });
  addEvidence(registry, claude, "liveCodeBench", 0.80, { verified: false });
  addEvidence(registry, codex, "liveCodeBench", 0.60, { verified: false });
  const evaluations = computeRoleEvaluations(registry, [claude, codex], "Debugger", ["reasoning", "coding"]);
  assert.equal(evaluations.get("claude::claude-x").confidence, "medium");
});

test("confidence is low with thin, unverified, single-benchmark coverage", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "gpqa", 0.90, { verified: false });
  addEvidence(registry, codex, "gpqa", 0.50, { verified: false });
  const evaluations = computeRoleEvaluations(registry, [claude, codex], "Debugger", ["reasoning", "coding", "terminalExecution"]);
  assert.equal(evaluations.get("claude::claude-x").confidence, "low");
});

test("computeRoleGapValue preserves real magnitude with only 2 candidates — unlike percentile, it never collapses to {0,1}", () => {
  const registry = createCapabilityRegistry();
  // Real, close-but-not-identical coding scores — the whole point of the
  // gap value is that this 6.6%-apart pair reads as genuinely close, not
  // as a binary winner-take-all like percentile would with only 2 models.
  addEvidence(registry, claude, "liveCodeBench", 0.816);
  addEvidence(registry, codex, "liveCodeBench", 0.762);
  const gaps = computeRoleGapValue(registry, [claude, codex], ["coding"]);
  assert.equal(gaps.get("claude::claude-x"), 0.816);
  assert.equal(gaps.get("codex::codex-x"), 0.762);
  const relativeDiff = Math.abs(gaps.get("claude::claude-x") - gaps.get("codex::codex-x")) / gaps.get("claude::claude-x");
  assert.ok(relativeDiff < 0.08, "a real ~6.6% gap must read as within an 8% near-equivalence band");
});

test("computeRoleGapValue converts a 0-100 real score to the same 0-1 scale as a 0-1 real fraction, for honest comparison", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "gpqa", 0.90); // already 0-1
  addEvidence(registry, codex, "gpqa-diamond", 90); // 0-100, same real benchmark
  const gaps = computeRoleGapValue(registry, [claude, codex], ["reasoning"]);
  assert.equal(gaps.get("claude::claude-x"), 0.90);
  assert.equal(gaps.get("codex::codex-x"), 0.90);
});

test("computeRoleGapValue falls back to the composite index, scale-converted, when no component benchmark has any real value", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "intelligenceIndex", 53.4);
  addEvidence(registry, codex, "intelligenceIndex", 43.8);
  const gaps = computeRoleGapValue(registry, [claude, codex], ["reasoning"]);
  assert.ok(Math.abs(gaps.get("claude::claude-x") - 0.534) < 1e-9);
  assert.ok(Math.abs(gaps.get("codex::codex-x") - 0.438) < 1e-9);
});

test("computeRoleGapValue is absent (never zero) for a model with no real evidence anywhere", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "gpqa", 0.80);
  const gaps = computeRoleGapValue(registry, [claude, codex], ["reasoning"]);
  assert.equal(gaps.get("claude::claude-x"), 0.80);
  assert.equal(gaps.has("codex::codex-x"), false);
});

test("a lone accessible model still competes — percentile is trivially 1 when the whole candidate pool is just that one model", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "gpqa", 0.80);
  const scores = computeCapabilityPercentile(registry, [claude], "reasoning");
  assert.equal(scores.get("claude::claude-x").percentile, 1);
  const evaluations = computeRoleEvaluations(registry, [claude], "Explorer", ["reasoning"]);
  assert.ok(evaluations.has("claude::claude-x"), "the only real accessible model must still compete for the role");
});

test("activeBenchmarkCountForCapability reports the real, static number of distinct benchmark identities per capability", () => {
  assert.equal(activeBenchmarkCountForCapability("reasoning"), 3); // gpqa, hle, mmlu-pro
  assert.equal(activeBenchmarkCountForCapability("coding"), 2); // livecodebench, scicode
  assert.equal(activeBenchmarkCountForCapability("terminalExecution"), 1); // terminal-bench (pooled aliases)
  assert.equal(activeBenchmarkCountForCapability("instructionFollowing"), 1); // ifbench
});

test("isCapabilityComparable applies a real 50%-rounded-up floor per capability — reasoning needs 2/3, coding needs 1/2, a single-benchmark capability needs just 1/1", () => {
  assert.equal(isCapabilityComparable("reasoning", 0), false);
  assert.equal(isCapabilityComparable("reasoning", 1), false);
  assert.equal(isCapabilityComparable("reasoning", 2), true);
  assert.equal(isCapabilityComparable("reasoning", 3), true);
  assert.equal(isCapabilityComparable("coding", 0), false);
  assert.equal(isCapabilityComparable("coding", 1), true);
  assert.equal(isCapabilityComparable("terminalExecution", 0), false);
  assert.equal(isCapabilityComparable("terminalExecution", 1), true);
});

test("countModelBenchmarks counts real, DISTINCT benchmark identities, never sources — Artificial Analysis's HLE and Hugging Face's HLE are the same real benchmark, counted once", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "hle", 0.50, { source: "artificial-analysis-free", scale: "unit" });
  addEvidence(registry, claude, "hle", 63.9, { source: "huggingface-leaderboard", scale: "hundred" });
  // Two real evidence entries, same benchmark identity ("hle") — one count.
  assert.equal(countModelBenchmarks(registry, claude, "reasoning"), 1);

  addEvidence(registry, claude, "gpqa", 0.80, { source: "artificial-analysis-free", scale: "unit" });
  // A genuinely different real benchmark identity — now two.
  assert.equal(countModelBenchmarks(registry, claude, "reasoning"), 2);
});

test("REGRESSION: computeRoleEvaluations marks a candidate provisional when a required capability's real benchmark coverage is below the comparability floor — the exact real bug (DeepSeek V4.1 Flash winning Explorer on one HLE benchmark) this whole coverage policy was written to fix", () => {
  const registry = createCapabilityRegistry();
  // DeepSeek: real evidence on exactly ONE of reasoning's three real
  // active benchmarks (HLE only) — 1/3, below the 2/3 comparability
  // floor. Sonnet: real evidence on TWO (gpqa + hle) — comparable.
  const deepseek = { adapterId: "opencode-go", modelId: "deepseek-x" };
  addEvidence(registry, deepseek, "hle", 0.639, { source: "huggingface-leaderboard", scale: "hundred" });
  addEvidence(registry, claude, "gpqa", 0.55, { source: "artificial-analysis-free", scale: "unit" });
  addEvidence(registry, claude, "hle", 0.50, { source: "artificial-analysis-free", scale: "unit" });

  const evaluations = computeRoleEvaluations(registry, [deepseek, claude], "Explorer", ["reasoning"]);
  const deepseekEval = evaluations.get("opencode-go::deepseek-x");
  const claudeEval = evaluations.get("claude::claude-x");

  assert.equal(deepseekEval.benchmarkCountsByCapability.reasoning, 1);
  assert.equal(deepseekEval.isProvisional, true);
  assert.deepEqual(deepseekEval.provisionalCapabilities, ["reasoning"]);

  assert.equal(claudeEval.benchmarkCountsByCapability.reasoning, 2);
  assert.equal(claudeEval.isProvisional, false);
  assert.deepEqual(claudeEval.provisionalCapabilities, []);
});

test("Terminal-Bench v4 ranks only within its own cohort and shares terminal coverage", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "terminalBenchV4", 0.60);
  addEvidence(registry, codex, "terminalBenchV4", 0.59);
  addEvidence(registry, go, "terminalBenchV2", 0.88);
  const models = [claude, codex, go];
  const scores = computeCapabilityPercentile(registry, models, "terminalExecution");
  assert.equal(scores.get("claude::claude-x")?.percentile, 1);
  assert.equal(scores.get("codex::codex-x")?.percentile, 0);
  assert.equal(scores.has("opencode-go::go-x"), false, "a lone v2 result cannot join the v4 cohort");
  assert.equal(activeBenchmarkCountForCapability("terminalExecution"), 1);
  assert.equal(countModelBenchmarks(registry, claude, "terminalExecution"), 1);
  assert.equal(isCapabilityComparable("terminalExecution", 1), true);
  const evaluation = computeRoleEvaluations(registry, models, "Builder", ["terminalExecution"]).get("claude::claude-x");
  assert.equal(evaluation.coverage, 1);
  assert.equal(evaluation.benchmarkCoverage.terminalExecution, 1);
  assert.equal(evaluation.isProvisional, false);
  addEvidence(registry, claude, "terminalBenchV2", 0.87);
  assert.equal(countModelBenchmarks(registry, claude, "terminalExecution"), 1, "two versions still cover one family");
});

test("v2-only terminal coverage and comparability retain their previous exact values", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "terminalBenchV2", 0.88);
  addEvidence(registry, codex, "terminalBenchV2", 0.80);
  const evaluation = computeRoleEvaluations(registry, [claude, codex], "Builder", ["terminalExecution"]).get("claude::claude-x");
  assert.equal(countModelBenchmarks(registry, claude, "terminalExecution"), 1);
  assert.equal(activeBenchmarkCountForCapability("terminalExecution"), 1);
  assert.equal(isCapabilityComparable("terminalExecution", 0), false);
  assert.equal(isCapabilityComparable("terminalExecution", 1), true);
  assert.equal(evaluation.benchmarkCoverage.terminalExecution, 1);
  assert.equal(evaluation.coverage, 1);
  assert.equal(evaluation.benchmarkCount, 1);
  assert.equal(evaluation.isProvisional, false);
});

test("S29/S30 AA agentic index and latency flow through registry ingestion; lower latency ranks higher, gap magnitude stays 0-1", () => {
  const registry = createCapabilityRegistry();
  const aa = [
    { slug: "fast-x", name: "Fast", agenticIndex: 60, endToEndSeconds: 10 },
    { slug: "slow-x", name: "Slow", agenticIndex: 30, endToEndSeconds: 120 }
  ];
  const fast = { adapterId: "claude", modelId: "fast-x" };
  const slow = { adapterId: "codex", modelId: "slow-x" };
  ingestArtificialAnalysisEvidence(registry, [{ adapterId: "claude", models: [{ id: "fast-x" }] }, { adapterId: "codex", models: [{ id: "slow-x" }] }], aa);
  const time = computeCapabilityPercentile(registry, [fast, slow], "responseTime");
  assert.equal(time.get("claude::fast-x").percentile, 1);
  assert.equal(time.get("codex::slow-x").percentile, 0);
  const agentic = computeCapabilityPercentile(registry, [fast, slow], "agenticExecution");
  assert.equal(agentic.get("claude::fast-x").percentile, 1);
  const gaps = computeRoleGapValue(registry, [fast, slow], ["agenticExecution", "responseTime"]);
  for (const value of gaps.values()) assert.ok(value > 0 && value < 1);
  assert.equal(computeRoleGapValue(registry, [fast, slow], ["agenticExecution"]).get("claude::fast-x"), .6);
});

// S33: per-role weights replace the equal median of the required capabilities.
const BUILDER = ["coding", "terminalExecution", "agenticExecution"];
function builderRegistry({ bAgentic = 80 } = {}) {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "sciCode", 0.9); addEvidence(registry, claude, "terminalBenchV2", 0.5); addEvidence(registry, claude, "agenticIndex", 50);
  addEvidence(registry, codex, "sciCode", 0.5); addEvidence(registry, codex, "terminalBenchV2", 0.6);
  if (bAgentic != null) addEvidence(registry, codex, "agenticIndex", bAgentic);
  return registry;
}

test("S33 weighted Builder value differs from the equal median over three signals", () => {
  const registry = builderRegistry();
  const w = ROLE_METRIC_WEIGHTS.Builder;
  const median = computeRoleGapValue(registry, [claude, codex], BUILDER);
  const weighted = computeRoleGapValue(registry, [claude, codex], BUILDER, w);
  assert.ok(Math.abs(median.get("claude::claude-x") - 0.5) < 1e-9);
  assert.ok(Math.abs(weighted.get("claude::claude-x") - (0.45 * 0.9 + 0.25 * 0.5 + 0.30 * 0.5)) < 1e-9);
  const ev = computeRoleEvaluations(registry, [claude, codex], "Builder", BUILDER, w).get("claude::claude-x");
  assert.ok(Math.abs(ev.capabilityPercentile - 0.45) < 1e-9); // coding percentile 1 x .45; median would be 0
  assert.deepEqual(ev.weights, { coding: 0.45, terminalExecution: 0.25, agenticExecution: 0.30 });
});

test("S33 a model lacking agentic is renormalized over the signals it has", () => {
  const registry = builderRegistry({ bAgentic: null });
  const ev = computeRoleEvaluations(registry, [claude, codex], "Builder", BUILDER, ROLE_METRIC_WEIGHTS.Builder).get("codex::codex-x");
  assert.ok(Math.abs(ev.weights.coding - 0.45 / 0.70) < 1e-5);
  assert.ok(Math.abs(ev.weights.terminalExecution - 0.25 / 0.70) < 1e-5);
  assert.equal(ev.weights.agenticExecution, undefined);
  const gap = computeRoleGapValue(registry, [claude, codex], BUILDER, ROLE_METRIC_WEIGHTS.Builder).get("codex::codex-x");
  const coding = computeCapabilityGapValue(registry, [claude, codex], "coding").get("codex::codex-x");
  const terminal = computeCapabilityGapValue(registry, [claude, codex], "terminalExecution").get("codex::codex-x");
  assert.ok(Math.abs(gap - (0.45 * coding + 0.25 * terminal) / 0.70) < 1e-5); // no penalty baked in here (S20 applies it once, elsewhere)
});

test("S33 a capability with no evidence for any candidate is dropped and the rest renormalized", () => {
  const noAgentic = createCapabilityRegistry();
  addEvidence(noAgentic, claude, "sciCode", 0.9); addEvidence(noAgentic, claude, "terminalBenchV2", 0.5);
  addEvidence(noAgentic, codex, "sciCode", 0.5); addEvidence(noAgentic, codex, "terminalBenchV2", 0.6);
  const ev = computeRoleEvaluations(noAgentic, [claude, codex], "Builder", BUILDER, ROLE_METRIC_WEIGHTS.Builder).get("claude::claude-x");
  assert.deepEqual(Object.keys(ev.weights).sort(), ["coding", "terminalExecution"]);
  assert.ok(Math.abs(ev.weights.coding + ev.weights.terminalExecution - 1) < 1e-5);
});

test("S33 a project-added capability gets the mean weight and weights renormalize", () => {
  const w = renormalizedWeights(["reasoning", "coding", "softwareExecution"], ROLE_METRIC_WEIGHTS.Reviewer);
  assert.ok(Math.abs(w.softwareExecution - 1 / 3) < 1e-5);
  assert.ok(Math.abs(w.reasoning - 1 / 3) < 1e-5);
  assert.ok(Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-5);
  assert.ok(Math.abs(weightedAverage({ coding: 0.8, reasoning: 0.4 }, ROLE_METRIC_WEIGHTS.Reviewer) - 0.6) < 1e-9);
});

test("S15 an official Terminal-Bench 4.0 snapshot ranks in the v4 cohort, not with v2", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "terminalBenchV4", 0.60);
  addEvidence(registry, codex, "terminal-bench", 57.9, { source: "openai-official", benchmarkVersion: "4.0" });
  addEvidence(registry, go, "terminalBenchV2", 0.88);
  const scores = computeCapabilityPercentile(registry, [claude, codex, go], "terminalExecution");
  assert.equal(scores.get("claude::claude-x")?.percentile, 1);
  assert.equal(scores.get("codex::codex-x")?.percentile, 0, "57.9 on v4.0 ranks below 0.60 on v4.0");
  assert.equal(scores.has("opencode-go::go-x"), false, "a lone v2 result cannot join the v4 cohort");
});

test("S15 an unversioned terminal-bench row keeps ranking with Terminal-Bench v2", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "terminalBenchV2", 0.80);
  addEvidence(registry, codex, "terminal-bench", 90, { source: "vendor" });
  const scores = computeCapabilityPercentile(registry, [claude, codex], "terminalExecution");
  assert.equal(scores.get("codex::codex-x")?.percentile, 1);
  assert.equal(scores.get("claude::claude-x")?.percentile, 0);
});

test("S15 a vendor-reported benchmark weighs half of an independent one in a capability", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "hle", 0.60);
  addEvidence(registry, claude, "gpqa-diamond", 90, { source: "anthropic-official", vendorReported: true });
  addEvidence(registry, codex, "hle", 0.50);
  addEvidence(registry, codex, "gpqa", 0.80);
  const gaps = computeCapabilityGapValue(registry, [claude, codex], "reasoning");
  assert.ok(Math.abs(gaps.get("claude::claude-x") - 0.70) < 1e-9, `half-weight vendor value: ${gaps.get("claude::claude-x")}`);
  assert.ok(Math.abs(gaps.get("codex::codex-x") - 0.65) < 1e-9, "independent values keep the plain median");
  const percentiles = computeCapabilityPercentile(registry, [claude, codex], "reasoning");
  assert.equal(percentiles.get("claude::claude-x").benchmarkCount, 2, "vendor evidence still counts as coverage");
  assert.equal(percentiles.get("claude::claude-x").percentile, 1, "hle 1 (weight 1) and gpqa 1 (weight .5)");
});

test("S15 a vendor-reported value alone still scores the capability", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "gpqa-diamond", 90, { source: "anthropic-official", vendorReported: true });
  addEvidence(registry, codex, "gpqa", 0.80);
  assert.ok(Math.abs(computeCapabilityGapValue(registry, [claude, codex], "reasoning").get("claude::claude-x") - 0.90) < 1e-9);
});

// S48: effort outcomes are a low-weight prior, never standalone capability evidence.
test("S48 disjoint software cohorts keep role coverage at one half despite priors", () => {
  const registry = createCapabilityRegistry();
  const models = [claude, codex];
  addEvidence(registry, claude, "cursorbench", 80);
  addEvidence(registry, codex, "kairo.success", 0.6);
  addEvidence(registry, claude, "gpqa", 0.9);
  addEvidence(registry, codex, "gpqa", 0.7);
  const capabilities = ["softwareExecution", "reasoning"];
  const before = computeRoleEvaluations(registry, models, "Builder", capabilities);
  for (const evaluation of before.values()) assert.equal(evaluation.coverage, 0.5);
  addEvidence(registry, claude, "effort.passRate", 0.2);
  addEvidence(registry, codex, "effort.passRate", 0.9);
  const after = computeRoleEvaluations(registry, models, "Builder", capabilities);
  for (const evaluation of after.values()) assert.equal(evaluation.coverage, 0.5);
  assert.deepEqual(after, before);
  assert.equal(computeCapabilityPercentile(registry, models, "softwareExecution").size, 0);
  // Both models still have real magnitudes, even without percentile cohorts.
  const gaps = computeCapabilityGapValue(registry, models, "softwareExecution");
  assert.ok(Math.abs(gaps.get("claude::claude-x") - 0.68) < 1e-12);
  assert.ok(Math.abs(gaps.get("codex::codex-x") - 0.66) < 1e-12);
});

test("S48 cursorbench plus effort prior gives magnitude 0.68 and percentile 0.8", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "cursorbench", 80, { verified: true });
  addEvidence(registry, codex, "cursorbench", 60, { verified: true });
  addEvidence(registry, claude, "effort.passRate", 0.2);
  addEvidence(registry, codex, "effort.passRate", 0.9);
  // Midpoints for weights .25 and 1 interpolate 20% toward the prior:
  // .8 * .8 + .2 * .2 = .68; percentile 1 * .8 + 0 * .2 = .8.
  const gap = computeCapabilityGapValue(registry, [claude, codex], "softwareExecution");
  assert.ok(Math.abs(gap.get("claude::claude-x") - 0.68) < 1e-12);
  const score = computeCapabilityPercentile(registry, [claude, codex], "softwareExecution").get("claude::claude-x");
  assert.equal(score.percentile, 0.8);
  assert.equal(score.benchmarkCount, 1);
  assert.equal(score.verifiedCount, 1);
});

test("S48 prior-only models have no value and never enter the prior percentile cohort", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "cursorbench", 80);
  addEvidence(registry, codex, "cursorbench", 60);
  addEvidence(registry, claude, "effort.passRate", 0.2);
  addEvidence(registry, codex, "effort.passRate", 0.9);
  addEvidence(registry, go, "effort.passRate", 0.1);
  const models = [claude, codex, go];
  assert.equal(computeCapabilityGapValue(registry, models, "softwareExecution").has("opencode-go::go-x"), false);
  const scores = computeCapabilityPercentile(registry, models, "softwareExecution");
  assert.equal(scores.has("opencode-go::go-x"), false);
  assert.equal(scores.get("claude::claude-x").percentile, 0.8);
  assert.equal(computeCapabilityGapValue(registry, [go], "softwareExecution").size, 0);
  assert.equal(computeCapabilityPercentile(registry, [go], "softwareExecution").size, 0);
});

test("S48 priors do not change coverage, comparability, provisional status or benchmark counts", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "cursorbench", 80);
  addEvidence(registry, codex, "cursorbench", 60);
  const models = [claude, codex];
  const before = computeRoleEvaluations(registry, models, "Builder", ["softwareExecution"]);
  const active = activeBenchmarkCountForCapability("softwareExecution");
  addEvidence(registry, claude, "effort.passRate", 0.1);
  addEvidence(registry, codex, "effort.passRate", 1);
  assert.equal(activeBenchmarkCountForCapability("softwareExecution"), active);
  assert.equal(active, 2);
  assert.equal(countModelBenchmarks(registry, claude, "softwareExecution"), 1);
  const after = computeRoleEvaluations(registry, models, "Builder", ["softwareExecution"]);
  for (const [key, value] of before) {
    for (const field of ["coverage", "benchmarkCount", "benchmarkCountsByCapability", "benchmarkCoverage", "isProvisional", "confidence"]) {
      assert.deepEqual(after.get(key)[field], value[field], field);
    }
  }
});

test("S48 without effort evidence existing softwareExecution values stay identical", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "cursorbench", 80);
  addEvidence(registry, claude, "kairo.success", 0.6);
  addEvidence(registry, codex, "cursorbench", 60);
  addEvidence(registry, codex, "kairo.success", 0.8);
  const models = [claude, codex];
  assert.deepEqual([...computeCapabilityGapValue(registry, models, "softwareExecution")], [["claude::claude-x", 0.7], ["codex::codex-x", 0.7]]);
  for (const score of computeCapabilityPercentile(registry, models, "softwareExecution").values()) {
    assert.deepEqual(score, { percentile: 0.5, benchmarkCount: 2, verifiedCount: 0 });
  }
});
