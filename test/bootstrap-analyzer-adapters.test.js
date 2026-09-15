import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  createBootstrapAnalyzerAdapter, createCodexBootstrapAnalyzerAdapter, createClaudeBootstrapAnalyzerAdapter,
  createCursorBootstrapAnalyzerAdapter
} from "../src/global/conversation/bootstrap-analyzer-adapters.js";

test("createCodexBootstrapAnalyzerAdapter reports isolation 'verified' only when the real boundary is actually available, never a hardcoded claim", async () => {
  const available = createCodexBootstrapAnalyzerAdapter({
    modelId: "codex-model",
    deps: { getCodexIsolationStatus: async () => ({ available: true, platform: "darwin", boundaryVerified: true, reason: null }) }
  });
  const eligibleResult = await available.checkEligibility();
  assert.equal(eligibleResult.eligible, true);
  assert.equal(eligibleResult.isolation, "verified");
  assert.equal(eligibleResult.canaryTested, true);

  const unavailable = createCodexBootstrapAnalyzerAdapter({
    modelId: "codex-model",
    deps: { getCodexIsolationStatus: async () => ({ available: false, platform: "linux", boundaryVerified: false, reason: "macOS only" }) }
  });
  const ineligibleResult = await unavailable.checkEligibility();
  assert.equal(ineligibleResult.eligible, false);
  assert.equal(ineligibleResult.isolation, "unverified");
  assert.equal(ineligibleResult.canaryTested, false);
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

test("createClaudeBootstrapAnalyzerAdapter reports isolation 'restricted' (application-enforced, not kernel) with canaryTested true (empirically proven, that's a separate axis) — only when auth and model are real", async () => {
  const adapter = createClaudeBootstrapAnalyzerAdapter({
    modelId: "claude-sonnet-5",
    deps: {
      verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
      readClaudeModels: () => ({ status: "documented", source: "test", models: [{ id: "claude-sonnet-5" }], error: null })
    }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.isolation, "restricted");
  assert.equal(eligibility.canaryTested, true);
});

test("createClaudeBootstrapAnalyzerAdapter is ineligible when the real CLI/auth check fails — never a hardcoded true", async () => {
  const adapter = createClaudeBootstrapAnalyzerAdapter({
    modelId: "claude-sonnet-5",
    deps: {
      verifyClaudeSubscriptionAuth: async () => { throw new Error("Claude execution requires a first-party claude.ai Pro, Max, Team, or Enterprise subscription."); }
    }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.isolation, "unverified");
  assert.equal(eligibility.canaryTested, false);
  assert.match(eligibility.reason, /subscription/);
});

test("createClaudeBootstrapAnalyzerAdapter is ineligible when modelId isn't in Claude's real documented catalog — never a silent pass for an unknown model", async () => {
  const adapter = createClaudeBootstrapAnalyzerAdapter({
    modelId: "claude-does-not-exist",
    deps: {
      verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
      readClaudeModels: () => ({ status: "documented", source: "test", models: [{ id: "claude-sonnet-5" }], error: null })
    }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.isolation, "unverified");
  assert.equal(eligibility.canaryTested, false);
  assert.match(eligibility.reason, /claude-does-not-exist/);
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

test("createCursorBootstrapAnalyzerAdapter rejects a MISSING selection outright — Cursor Auto must be chosen explicitly, never an implicit default", async () => {
  const noModel = createCursorBootstrapAnalyzerAdapter({ modelId: null });
  const noModelResult = await noModel.checkEligibility();
  assert.equal(noModelResult.eligible, false);
  assert.match(noModelResult.reason, /No Cursor model selection/);
});

test("createCursorBootstrapAnalyzerAdapter normalizes every Cursor Auto spelling to the canonical 'cursor:auto' identity — outcomes are always attributed there, never to a guessed inner model", () => {
  for (const auto of ["auto", "Auto", "cursor:auto", "cursor-auto"]) {
    const adapter = createCursorBootstrapAnalyzerAdapter({ modelId: auto });
    assert.equal(adapter.modelId, "cursor:auto", `"${auto}" must normalize to the canonical id`);
  }
});

test("createCursorBootstrapAnalyzerAdapter's Cursor Auto is exempt from the explicit per-account catalog check (it's a routing mode, not a listed model) but still gated on the isolation proof, the same standard as every other candidate", async () => {
  const adapter = createCursorBootstrapAnalyzerAdapter({
    modelId: "cursor:auto",
    deps: { readCursorModels: async () => { throw new Error("must never be called for Cursor Auto"); } }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.isolation, "unverified");
  assert.equal(eligibility.canaryTested, false);
  assert.match(eligibility.reason, /canary-tested/);
});

test("createCursorBootstrapAnalyzerAdapter is ineligible when the real per-account model catalog is empty — a real, current fact, not a stub", async () => {
  const adapter = createCursorBootstrapAnalyzerAdapter({
    modelId: "gpt-6",
    deps: { readCursorModels: async () => ({ status: "measured", source: "test", models: [], error: null }) }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.match(eligibility.reason, /No models are enabled/);
});

test("createCursorBootstrapAnalyzerAdapter is ineligible when the real catalog read itself fails — never silently treated as eligible", async () => {
  const adapter = createCursorBootstrapAnalyzerAdapter({
    modelId: "gpt-6",
    deps: { readCursorModels: async () => ({ status: "unknown", source: "test", models: [], error: "cursor-agent models timed out" }) }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.match(eligibility.reason, /Could not read Cursor's real model catalog/);
});

test("createCursorBootstrapAnalyzerAdapter is ineligible when modelId isn't in the real per-account catalog", async () => {
  const adapter = createCursorBootstrapAnalyzerAdapter({
    modelId: "not-a-real-model",
    deps: { readCursorModels: async () => ({ status: "measured", source: "test", models: ["gpt-6"], error: null }) }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.match(eligibility.reason, /not-a-real-model/);
});

test("createCursorBootstrapAnalyzerAdapter is ineligible even with real auth and a real catalog model, because --sandbox enabled has never been canary-tested — the same standard as every other adapter", async () => {
  const adapter = createCursorBootstrapAnalyzerAdapter({
    modelId: "gpt-6",
    deps: { readCursorModels: async () => ({ status: "measured", source: "test", models: ["gpt-6"], error: null }) }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.isolation, "unverified");
  assert.equal(eligibility.canaryTested, false);
  assert.match(eligibility.reason, /canary-tested/);
});

test("createCursorBootstrapAnalyzerAdapter.analyze spawns the real verified CLI flags with an explicit model, never auto", async () => {
  const seenArgs = [];
  const spawn = (cmd, args) => {
    seenArgs.push([cmd, args]);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      child.stdout.emit("data", JSON.stringify({ result: "Real answer." }));
      child.emit("close", 0);
    }, 0);
    return child;
  };
  const adapter = createCursorBootstrapAnalyzerAdapter({ modelId: "gpt-6", deps: { spawn } });
  const result = await adapter.analyze({ question: "investigate", snapshotRoot: "/tmp/snap", timeoutMs: 5000 });
  assert.equal(result.status, "answered");
  assert.equal(result.answer, "Real answer.");
  const [cmd, args] = seenArgs[0];
  assert.equal(cmd, "cursor-agent");
  assert.ok(args.includes("--sandbox"));
  assert.ok(args.includes("enabled"));
  assert.ok(args.includes("--mode"));
  assert.ok(args.includes("ask"));
  assert.ok(args.includes("--workspace"));
  assert.ok(args.includes("/tmp/snap"));
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("gpt-6"));
});

test("createCursorBootstrapAnalyzerAdapter.analyze omits --model entirely for Cursor Auto — never passes the literal 'cursor:auto' as a model id Cursor wouldn't recognize", async () => {
  const seenArgs = [];
  const spawn = (cmd, args) => {
    seenArgs.push([cmd, args]);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      child.stdout.emit("data", JSON.stringify({ result: "Real answer." }));
      child.emit("close", 0);
    }, 0);
    return child;
  };
  const adapter = createCursorBootstrapAnalyzerAdapter({ modelId: "cursor:auto", deps: { spawn } });
  await adapter.analyze({ question: "investigate", snapshotRoot: "/tmp/snap", timeoutMs: 5000 });
  const [, args] = seenArgs[0];
  assert.equal(args.includes("--model"), false, "Cursor Auto must let the CLI route internally, never pass a fake --model value");
});

test("createCursorBootstrapAnalyzerAdapter.analyze fails closed on malformed JSON or a missing result field", async () => {
  const malformedSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => { child.stdout.emit("data", "not json"); child.emit("close", 0); }, 0);
    return child;
  };
  const adapter = createCursorBootstrapAnalyzerAdapter({ modelId: "gpt-6", deps: { spawn: malformedSpawn } });
  const result = await adapter.analyze({ question: "q", snapshotRoot: "/tmp/snap", timeoutMs: 5000 });
  assert.equal(result.status, "error");
});

test("createBootstrapAnalyzerAdapter dispatches to the right real factory by adapterId", () => {
  const codex = createBootstrapAnalyzerAdapter("codex", { modelId: "m" });
  assert.equal(codex.adapterId, "codex");
  const claude = createBootstrapAnalyzerAdapter("claude", { modelId: "m" });
  assert.equal(claude.adapterId, "claude");
  const cursor = createBootstrapAnalyzerAdapter("cursor", { modelId: "m" });
  assert.equal(cursor.adapterId, "cursor");
});

test("createBootstrapAnalyzerAdapter returns an honest, ineligible adapter for a provider with no real implementation yet — never a silent fallback to a different provider", async () => {
  const adapter = createBootstrapAnalyzerAdapter("opencode-go", { modelId: "some-model" });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.match(eligibility.reason, /no bootstrap analyzer adapter implemented/i);
  assert.equal(eligibility.isolation, "unverified");
  assert.equal(eligibility.canaryTested, false);
  await assert.rejects(() => adapter.analyze({ question: "q", snapshotRoot: "/tmp/x" }), /no bootstrap analyzer adapter implemented/i);
});
