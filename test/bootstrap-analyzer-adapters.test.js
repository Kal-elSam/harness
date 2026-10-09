import test from "node:test";
import assert from "node:assert/strict";
import {
  createBootstrapAnalyzerAdapter, createCodexBootstrapAnalyzerAdapter, createClaudeBootstrapAnalyzerAdapter,
  createCursorBootstrapAnalyzerAdapter, createOpencodeGoBootstrapAnalyzerAdapter
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

test("createClaudeBootstrapAnalyzerAdapter is ineligible when deps say the documented sibling is entitlement-denied — surfaces the real CLI reason", async () => {
  const adapter = createClaudeBootstrapAnalyzerAdapter({
    modelId: "claude-fable-5-1",
    deps: {
      verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
      readClaudeModels: () => ({
        status: "documented",
        source: "test",
        models: [{ id: "claude-fable-5-1" }, { id: "claude-sonnet-5" }],
        error: null
      }),
      modelEntitlement: {
        "claude-fable-5-1": {
          status: "denied",
          reason: "Credits required to use this model — upgrade your plan"
        }
      }
    }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.isolation, "unverified");
  assert.equal(eligibility.canaryTested, false);
  assert.match(eligibility.reason, /Credits required to use this model/);
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

test("createCursorBootstrapAnalyzerAdapter's Cursor Auto is exempt from the explicit per-account catalog check (it's a routing mode, not a listed model), but is NOT exempt from a real authentication probe — status/whoami's claim alone is never trusted", async () => {
  const adapter = createCursorBootstrapAnalyzerAdapter({
    modelId: "cursor:auto",
    deps: {
      readCursorModels: async () => { throw new Error("must never be called for Cursor Auto"); },
      probeCursorAuth: async () => ({ authenticated: false, status: "measured", source: "test", reason: "cursor-agent reports \"Authentication required\"" })
    }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.match(eligibility.reason, /Authentication required/);
});

test("createCursorBootstrapAnalyzerAdapter's Cursor Auto, once real authentication is confirmed, becomes eligible only when the real macOS sandbox-exec boundary is actually available", async () => {
  const eligible = createCursorBootstrapAnalyzerAdapter({
    modelId: "cursor:auto",
    deps: {
      readCursorModels: async () => { throw new Error("must never be called for Cursor Auto"); },
      probeCursorAuth: async () => ({ authenticated: true, status: "measured", source: "test", reason: null }),
      getCursorIsolationStatus: async () => ({ available: true, platform: "darwin", boundaryVerified: true, reason: null })
    }
  });
  const eligibility = await eligible.checkEligibility();
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.isolation, "verified");
  assert.equal(eligibility.canaryTested, true);

  const noBoundary = createCursorBootstrapAnalyzerAdapter({
    modelId: "cursor:auto",
    deps: {
      probeCursorAuth: async () => ({ authenticated: true, status: "measured", source: "test", reason: null }),
      getCursorIsolationStatus: async () => ({ available: false, platform: "linux", boundaryVerified: false, reason: "macOS only" })
    }
  });
  const ineligible = await noBoundary.checkEligibility();
  assert.equal(ineligible.eligible, false);
  assert.equal(ineligible.isolation, "unverified");
  assert.equal(ineligible.canaryTested, false);
  assert.equal(ineligible.reason, "macOS only");
});

test("createCursorBootstrapAnalyzerAdapter's Cursor Auto is ineligible when the real auth probe itself fails — never silently treated as authenticated", async () => {
  const adapter = createCursorBootstrapAnalyzerAdapter({
    modelId: "cursor:auto",
    deps: { probeCursorAuth: async () => ({ authenticated: false, status: "unknown", source: "test", reason: "cursor-agent -p probe timed out" }) }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.match(eligibility.reason, /Could not determine whether Cursor Auto/);
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
    deps: { readCursorModels: async () => ({ status: "measured", source: "test", models: [{ id: "gpt-6", displayName: "GPT 6" }], error: null }) }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.match(eligibility.reason, /not-a-real-model/);
});

test("createCursorBootstrapAnalyzerAdapter is ineligible with real auth and a real catalog model when the real sandbox-exec boundary isn't available on this platform", async () => {
  const adapter = createCursorBootstrapAnalyzerAdapter({
    modelId: "gpt-6",
    deps: {
      readCursorModels: async () => ({ status: "measured", source: "test", models: [{ id: "gpt-6", displayName: "GPT 6" }], error: null }),
      getCursorIsolationStatus: async () => ({ available: false, platform: "linux", boundaryVerified: false, reason: "macOS only" })
    }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.isolation, "unverified");
  assert.equal(eligibility.canaryTested, false);
});

test("createCursorBootstrapAnalyzerAdapter is eligible with real auth, a real catalog model, and a real available sandbox boundary — verified, canary-tested", async () => {
  const adapter = createCursorBootstrapAnalyzerAdapter({
    modelId: "gpt-6",
    deps: {
      readCursorModels: async () => ({ status: "measured", source: "test", models: [{ id: "gpt-6", displayName: "GPT 6" }], error: null }),
      getCursorIsolationStatus: async () => ({ available: true, platform: "darwin", boundaryVerified: true, reason: null })
    }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.isolation, "verified");
  assert.equal(eligibility.canaryTested, true);
});

test("createCursorBootstrapAnalyzerAdapter.analyze delegates to the real sandboxed runner with an explicit model, never auto", async () => {
  let seenArgs;
  const adapter = createCursorBootstrapAnalyzerAdapter({
    modelId: "gpt-6",
    deps: { runCursorSandboxedBootstrap: async (args) => { seenArgs = args; return { status: "answered", answer: "Real answer.", error: null }; } }
  });
  const result = await adapter.analyze({ question: "investigate", snapshotRoot: "/tmp/snap", timeoutMs: 5000 });
  assert.equal(result.status, "answered");
  assert.equal(result.answer, "Real answer.");
  assert.equal(seenArgs.model, "gpt-6");
  assert.equal(seenArgs.snapshotRoot, "/tmp/snap");
});

test("createCursorBootstrapAnalyzerAdapter.analyze passes model: null to the sandboxed runner for Cursor Auto — never the literal 'cursor:auto' string", async () => {
  let seenArgs;
  const adapter = createCursorBootstrapAnalyzerAdapter({
    modelId: "cursor:auto",
    deps: { runCursorSandboxedBootstrap: async (args) => { seenArgs = args; return { status: "answered", answer: "ok", error: null }; } }
  });
  await adapter.analyze({ question: "investigate", snapshotRoot: "/tmp/snap", timeoutMs: 5000 });
  assert.equal(seenArgs.model, null);
});

test("createBootstrapAnalyzerAdapter dispatches to the right real factory by adapterId", () => {
  const codex = createBootstrapAnalyzerAdapter("codex", { modelId: "m" });
  assert.equal(codex.adapterId, "codex");
  const claude = createBootstrapAnalyzerAdapter("claude", { modelId: "m" });
  assert.equal(claude.adapterId, "claude");
  const cursor = createBootstrapAnalyzerAdapter("cursor", { modelId: "m" });
  assert.equal(cursor.adapterId, "cursor");
});

test("createBootstrapAnalyzerAdapter returns an honest, ineligible adapter for a provider with no real implementation — OpenCode Zen stays unsupported, never a silent fallback to a different provider", async () => {
  const adapter = createBootstrapAnalyzerAdapter("opencode-zen", { modelId: "some-model" });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.match(eligibility.reason, /no bootstrap analyzer adapter implemented/i);
  assert.equal(eligibility.isolation, "unverified");
  assert.equal(eligibility.canaryTested, false);
  await assert.rejects(() => adapter.analyze({ question: "q", snapshotRoot: "/tmp/x" }), /no bootstrap analyzer adapter implemented/i);
});

test("createBootstrapAnalyzerAdapter dispatches 'opencode-go' to the real OpenCode Go factory", () => {
  const adapter = createBootstrapAnalyzerAdapter("opencode-go", { modelId: "glm-5" });
  assert.equal(adapter.adapterId, "opencode-go");
  assert.equal(adapter.modelId, "glm-5");
});

const goCatalog = (ids) => async () => ({ status: "measured", provider: "opencode-go", models: ids.map((id) => ({ id })), error: null });

test("OpenCode Go adapter is eligible only for a model in the real Go catalog, honestly 'restricted' and NOT canary-tested", async () => {
  let seenProvider;
  const adapter = createOpencodeGoBootstrapAnalyzerAdapter({
    modelId: "glm-5",
    deps: { readOpenCodeModels: async (args) => { seenProvider = args.provider; return goCatalog(["glm-5", "kimi-k3"])(); } }
  });
  const result = await adapter.checkEligibility();
  assert.equal(seenProvider, "opencode-go");
  assert.equal(result.eligible, true);
  assert.equal(result.isolation, "restricted");
  assert.equal(result.canaryTested, false);
});

test("OpenCode Go adapter accepts a fully-qualified 'opencode-go/<id>' model ref against the bare-id catalog", async () => {
  const adapter = createOpencodeGoBootstrapAnalyzerAdapter({
    modelId: "opencode-go/glm-5", deps: { readOpenCodeModels: goCatalog(["glm-5"]) }
  });
  assert.equal((await adapter.checkEligibility()).eligible, true);
});

test("OpenCode Go adapter is ineligible with an explicit reason when the model is missing, the catalog is unreadable, or no model was given — never a fallback provider", async () => {
  const missing = await createOpencodeGoBootstrapAnalyzerAdapter({
    modelId: "nope", deps: { readOpenCodeModels: goCatalog(["glm-5"]) }
  }).checkEligibility();
  assert.equal(missing.eligible, false);
  assert.match(missing.reason, /"nope".*OpenCode Go/);
  assert.equal(missing.isolation, "unverified");
  assert.equal(missing.canaryTested, false);

  const unreadable = await createOpencodeGoBootstrapAnalyzerAdapter({
    modelId: "glm-5", deps: { readOpenCodeModels: async () => ({ status: "unknown", models: [], error: "opencode not installed" }) }
  }).checkEligibility();
  assert.equal(unreadable.eligible, false);
  assert.match(unreadable.reason, /opencode not installed/);

  const throwing = await createOpencodeGoBootstrapAnalyzerAdapter({
    modelId: "glm-5", deps: { readOpenCodeModels: async () => { throw new Error("boom"); } }
  }).checkEligibility();
  assert.equal(throwing.eligible, false);
  assert.match(throwing.reason, /boom/);

  const none = await createOpencodeGoBootstrapAnalyzerAdapter({ deps: { readOpenCodeModels: goCatalog(["glm-5"]) } }).checkEligibility();
  assert.equal(none.eligible, false);
  assert.match(none.reason, /no opencode go model/i);
});

test("OpenCode Go adapter.analyze asks ONLY provider 'opencode-go' (never Zen) against the snapshot root with timeout and abort signal forwarded", async () => {
  let seen;
  const controller = new AbortController();
  const adapter = createOpencodeGoBootstrapAnalyzerAdapter({
    modelId: "glm-5",
    deps: { askProvider: async (args) => { seen = args; return { status: "answered", answer: "ok", error: null }; } }
  });
  const result = await adapter.analyze({ question: "investigate", snapshotRoot: "/tmp/snap", timeoutMs: 1234, signal: controller.signal });
  assert.deepEqual(result, { status: "answered", answer: "ok", error: null });
  assert.equal(seen.provider, "opencode-go");
  assert.equal(seen.model, "glm-5");
  assert.equal(seen.cwd, "/tmp/snap");
  assert.equal(seen.timeoutMs, 1234);
  assert.equal(seen.signal, controller.signal);
});

test("OpenCode Go adapter.analyze refuses to run without a snapshotRoot instead of falling back to the live cwd", async () => {
  let called = false;
  const adapter = createOpencodeGoBootstrapAnalyzerAdapter({
    modelId: "glm-5", deps: { askProvider: async () => { called = true; return { status: "answered", answer: "x", error: null }; } }
  });
  const result = await adapter.analyze({ question: "q" });
  assert.equal(called, false);
  assert.equal(result.status, "error");
  assert.match(result.error, /snapshotRoot/);
});
