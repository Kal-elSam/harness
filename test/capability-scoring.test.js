import test from "node:test";
import assert from "node:assert/strict";
import { createCapabilityRegistry } from "../src/global/intelligence/model-capability-registry.js";
import { computeCapabilityPercentile, computeRoleEvaluations, computeRoleGapValue } from "../src/global/intelligence/capability-scoring.js";

function addEvidence(registry, model, metric, value, opts = {}) {
  const id = registry.registerIdentity(model.adapterId, model.modelId, model.displayName ?? null);
  registry.addEvidence(id, { metric, value, source: opts.source ?? "test-source", benchmarkVersion: opts.benchmarkVersion ?? null, date: opts.date ?? "2026-01-01", verified: opts.verified ?? false });
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

test("confidence is high only with real coverage >=70% AND at least one verified contributing benchmark", () => {
  const registry = createCapabilityRegistry();
  addEvidence(registry, claude, "gpqa", 0.90, { verified: true });
  addEvidence(registry, codex, "gpqa", 0.50, { verified: true });
  addEvidence(registry, claude, "liveCodeBench", 0.80, { verified: true });
  addEvidence(registry, codex, "liveCodeBench", 0.60, { verified: true });
  const evaluations = computeRoleEvaluations(registry, [claude, codex], "Debugger", ["reasoning", "coding"]);
  assert.equal(evaluations.get("claude::claude-x").confidence, "high");
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
