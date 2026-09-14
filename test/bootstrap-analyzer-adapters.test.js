import test from "node:test";
import assert from "node:assert/strict";
import {
  createBootstrapAnalyzerAdapter, createCodexBootstrapAnalyzerAdapter, createClaudeBootstrapAnalyzerAdapter
} from "../src/global/conversation/bootstrap-analyzer-adapters.js";

test("createCodexBootstrapAnalyzerAdapter reports isolation 'verified' only when the real boundary is actually available, never a hardcoded claim", async () => {
  const available = createCodexBootstrapAnalyzerAdapter({
    modelId: "codex-model",
    deps: { getCodexIsolationStatus: async () => ({ available: true, platform: "darwin", boundaryVerified: true, reason: null }) }
  });
  const eligibleResult = await available.checkEligibility();
  assert.equal(eligibleResult.eligible, true);
  assert.equal(eligibleResult.isolation, "verified");

  const unavailable = createCodexBootstrapAnalyzerAdapter({
    modelId: "codex-model",
    deps: { getCodexIsolationStatus: async () => ({ available: false, platform: "linux", boundaryVerified: false, reason: "macOS only" }) }
  });
  const ineligibleResult = await unavailable.checkEligibility();
  assert.equal(ineligibleResult.eligible, false);
  assert.equal(ineligibleResult.isolation, "unverified");
  assert.equal(ineligibleResult.reason, "macOS only");
});

test("createCodexBootstrapAnalyzerAdapter.analyze delegates to the real sandboxed runner with the adapter's own modelId", async () => {
  let seenArgs;
  const adapter = createCodexBootstrapAnalyzerAdapter({
    modelId: "codex-model",
    deps: {
      runCodexSandboxedBootstrap: async (args) => { seenArgs = args; return { status: "answered", answer: "ok", error: null }; }
    }
  });
  const result = await adapter.analyze({ question: "investigate", snapshotRoot: "/tmp/snap", timeoutMs: 5000 });
  assert.equal(result.status, "answered");
  assert.equal(seenArgs.model, "codex-model");
  assert.equal(seenArgs.snapshotRoot, "/tmp/snap");
  assert.equal(seenArgs.question, "investigate");
});

test("createClaudeBootstrapAnalyzerAdapter reports isolation 'restricted', never 'verified' — its boundary has not been independently canary-tested", async () => {
  const adapter = createClaudeBootstrapAnalyzerAdapter({ modelId: "claude-model" });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.isolation, "restricted");
});

test("createClaudeBootstrapAnalyzerAdapter.analyze delegates to askProvider with provider 'claude' and the snapshot as cwd", async () => {
  let seenArgs;
  const adapter = createClaudeBootstrapAnalyzerAdapter({
    modelId: "claude-model",
    deps: { askProvider: async (args) => { seenArgs = args; return { status: "answered", answer: "ok", error: null }; } }
  });
  await adapter.analyze({ question: "investigate", snapshotRoot: "/tmp/snap", timeoutMs: 5000 });
  assert.equal(seenArgs.provider, "claude");
  assert.equal(seenArgs.model, "claude-model");
  assert.equal(seenArgs.cwd, "/tmp/snap");
});

test("createBootstrapAnalyzerAdapter dispatches to the right real factory by adapterId", () => {
  const codex = createBootstrapAnalyzerAdapter("codex", { modelId: "m" });
  assert.equal(codex.adapterId, "codex");
  const claude = createBootstrapAnalyzerAdapter("claude", { modelId: "m" });
  assert.equal(claude.adapterId, "claude");
});

test("createBootstrapAnalyzerAdapter returns an honest, ineligible adapter for a provider with no real implementation yet — never a silent fallback to a different provider", async () => {
  const adapter = createBootstrapAnalyzerAdapter("cursor", { modelId: "some-model" });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.match(eligibility.reason, /no bootstrap analyzer adapter implemented/i);
  assert.equal(eligibility.isolation, "unverified");
  await assert.rejects(() => adapter.analyze({ question: "q", snapshotRoot: "/tmp/x" }), /no bootstrap analyzer adapter implemented/i);
});
