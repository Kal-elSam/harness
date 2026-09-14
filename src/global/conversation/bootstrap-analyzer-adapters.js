// A neutral contract for Bootstrap Analysis, so conversation/service.js's
// runBootstrapAnalysis doesn't special-case providers inline — each real
// provider gets its own adapter, and adding a new one (Cursor, a future
// verified Claude boundary, etc.) means adding a factory here, not
// branching inside runBootstrapAnalysis.
//
// Every adapter exposes:
//   adapterId, modelId
//   checkEligibility(): Promise<{ eligible, reason?, isolation, canaryTested }>
//     isolation and canaryTested are separate axes — WHO enforces the
//     boundary is not the same question as WHETHER it's been proven:
//       isolation: "verified" | "restricted" | "unverified" — WHO enforces
//         it. "verified" = an OS/kernel-enforced boundary (Codex's
//         sandbox-exec, see codex-sandbox.js) that holds even if the CLI's
//         own logic has a bug. "restricted" = an application-enforced
//         boundary — the provider's own CLI/tool-permission logic (Claude's
//         --restricted). "unverified" = no real boundary available.
//       canaryTested: boolean — WHETHER that boundary has actually been
//         empirically proven (a real canary read outside it was attempted
//         and denied), as opposed to merely documented/assumed from
//         --help text or a vendor's own claim. Both Codex's and Claude's
//         adapters are canaryTested: true today; a provider could in
//         principle be "restricted" but NOT canaryTested if its isolation
//         claim were never independently checked — never conflate the two.
//   analyze({ question, snapshotRoot, timeoutMs }): Promise<{status, answer, error}>
//     same response shape intelligence/quick-ask.js's askProvider already
//     returns, so callers don't need to branch on adapter type downstream.
//
// This module only wires the providers that already have a real
// implementation (Codex, Claude). Requesting an adapterId with no real
// implementation yet returns an honest "not implemented" ineligible
// adapter — never a silent fallback to a provider the caller didn't ask
// for.

import { askProvider as defaultAskProvider } from "../intelligence/quick-ask.js";
import {
  getCodexIsolationStatus as defaultGetCodexIsolationStatus,
  runCodexSandboxedBootstrap as defaultRunCodexSandboxedBootstrap
} from "./codex-sandbox.js";
import { verifyClaudeSubscriptionAuth as defaultVerifyClaudeSubscriptionAuth } from "../runtime/execution-adapters/claude.js";
import { readClaudeModels as defaultReadClaudeModels } from "../observability/claude-models.js";
import { readCursorModels as defaultReadCursorModels } from "../observability/cursor-models.js";
import { spawn as defaultSpawn } from "node:child_process";

export function createCodexBootstrapAnalyzerAdapter({ modelId, deps = {} } = {}) {
  const runSandboxed = deps.runCodexSandboxedBootstrap ?? defaultRunCodexSandboxedBootstrap;
  const getIsolation = deps.getCodexIsolationStatus ?? defaultGetCodexIsolationStatus;
  return {
    adapterId: "codex",
    modelId,
    async checkEligibility() {
      const isolation = await getIsolation(deps.isolationDeps ?? {});
      return {
        eligible: isolation.available,
        reason: isolation.available ? undefined : isolation.reason,
        isolation: isolation.available ? "verified" : "unverified",
        // The sandbox-exec mechanism itself was empirically canary-tested
        // (a real absolute-path read outside the confined root was denied,
        // see codex-sandbox.js's own header) — `available` reflects that
        // the same proven mechanism is usable here (platform + binary
        // present), not a fresh proof on every call.
        canaryTested: isolation.available
      };
    },
    async analyze({ question, snapshotRoot, timeoutMs }) {
      return runSandboxed({ question, model: modelId, snapshotRoot, timeoutMs, deps: deps.isolationDeps ?? {} });
    }
  };
}

export function createClaudeBootstrapAnalyzerAdapter({ modelId, deps = {} } = {}) {
  const ask = deps.askProvider ?? defaultAskProvider;
  const verifyAuth = deps.verifyClaudeSubscriptionAuth ?? defaultVerifyClaudeSubscriptionAuth;
  const listModels = deps.readClaudeModels ?? defaultReadClaudeModels;
  return {
    adapterId: "claude",
    modelId,
    // Real, integral eligibility — not a hardcoded claim:
    //  1. CLI + authentication: reuses execution-adapters/claude.js's own
    //     `claude auth status` check (the same real one gating a Claude
    //     execution run) — an unauthenticated or missing CLI fails here,
    //     never silently reported eligible.
    //  2. Model availability: checked against Claude's documented model
    //     catalog (observability/claude-models.js). Claude's CLI has no
    //     live model-discovery command (verified via its own --help, see
    //     that module's own header) — this catches an unknown/typo'd
    //     modelId, though it can't prove live per-account entitlement the
    //     way Codex/OpenCode's live catalogs can.
    //  3. isolation: "restricted" (application-enforced, by the claude
    //     CLI's own in-process tool-permission logic — not an OS kernel
    //     sandbox like Codex's sandbox-exec, so a bug in that logic could
    //     theoretically be bypassed, unlike a kernel boundary).
    //     canaryTested: true — --restricted's actual confinement was
    //     empirically canary-tested (not assumed): a real absolute-path
    //     read outside cwd came back in the JSON output's own
    //     `permission_denials` array (Claude's Read tool itself refused
    //     it), while an in-bounds read succeeded with an empty
    //     `permission_denials`. That proof is WHETHER it was tested, not
    //     WHO enforces it — it does not make this "verified"; only a
    //     kernel-enforced boundary earns that label.
    async checkEligibility() {
      try {
        await verifyAuth({});
      } catch (error) {
        return { eligible: false, reason: error?.message ?? String(error), isolation: "unverified", canaryTested: false };
      }
      if (modelId) {
        const catalog = listModels();
        const known = catalog.models.some((m) => m.id === modelId);
        if (!known) {
          return { eligible: false, reason: `"${modelId}" is not in Claude's documented model catalog.`, isolation: "unverified", canaryTested: false };
        }
      }
      return { eligible: true, isolation: "restricted", canaryTested: true };
    },
    async analyze({ question, snapshotRoot, timeoutMs }) {
      return ask({ provider: "claude", question, model: modelId, cwd: snapshotRoot, timeoutMs });
    }
  };
}

const CURSOR_AUTO_IDS = new Set(["auto", "cursor:auto", "cursor-auto"]);
const CURSOR_ANALYZE_TIMEOUT_MS = 180_000;

function unknownCursorResult(error) {
  return { status: "error", answer: null, error: String(error) };
}

export function createCursorBootstrapAnalyzerAdapter({ modelId, deps = {} } = {}) {
  const listModels = deps.readCursorModels ?? defaultReadCursorModels;
  const spawnFn = deps.spawn ?? defaultSpawn;
  return {
    adapterId: "cursor",
    modelId,
    // Real eligibility — currently, honestly, negative. Three real gates,
    // all actually checked, none skipped or assumed:
    //  1. Cursor Auto exclusion (per plan): no modelId, or an
    //     "auto"-shaped one, is rejected outright — cursor:auto does not
    //     guarantee which underlying model actually ran, so it can never
    //     be attributed the way an explicit model can.
    //  2. Real per-account model catalog (observability/cursor-models.js's
    //     readCursorModels — a real `cursor-agent models` call). On this
    //     machine the account genuinely has zero models enabled
    //     ("No models available for this account.") — a real, current
    //     blocker, not hypothetical.
    //  3. Isolation proof: unlike Codex's sandbox-exec and Claude's
    //     --restricted (both independently canary-tested — a real
    //     out-of-bounds read denied, not assumed from --help text),
    //     Cursor's --sandbox enabled has NOT been empirically proven, and
    //     with zero models enabled on this account there is currently
    //     nothing to canary-test against. Cursor is reported ineligible
    //     for THAT reason alone even when auth/catalog would otherwise
    //     pass — the same standard as every other adapter, never relaxed.
    async checkEligibility() {
      if (!modelId || CURSOR_AUTO_IDS.has(String(modelId).toLowerCase())) {
        return {
          eligible: false,
          reason: "Cursor Auto does not guarantee model attribution and is excluded from Bootstrap Analysis — pass an explicit model.",
          isolation: "unverified", canaryTested: false
        };
      }
      const catalog = await listModels();
      if (catalog.status !== "measured") {
        return {
          eligible: false, reason: `Could not read Cursor's real model catalog: ${catalog.error ?? catalog.status}`,
          isolation: "unverified", canaryTested: false
        };
      }
      if (catalog.models.length === 0) {
        return { eligible: false, reason: "No models are enabled for this Cursor account.", isolation: "unverified", canaryTested: false };
      }
      if (!catalog.models.includes(modelId)) {
        return {
          eligible: false, reason: `"${modelId}" is not in this account's real Cursor model catalog.`,
          isolation: "unverified", canaryTested: false
        };
      }
      return {
        eligible: false,
        reason: "Cursor's --sandbox enabled read confinement has not been empirically canary-tested yet.",
        isolation: "unverified", canaryTested: false
      };
    },
    // NOT yet live-tested end-to-end — this account has no enabled models
    // to invoke, so this has only been unit-tested with injected fakes.
    // Built from the real, verified `cursor-agent --help` flags:
    // --mode ask (read-only Q&A), --sandbox enabled, --workspace (confines
    // the agent's own working root), --model (explicit, never auto).
    // Uses --output-format json (a single parseable blob, like
    // quick-ask.js's askClaude) rather than the plan's suggested
    // stream-json — simpler to parse correctly without a real example of
    // Cursor's stream-json shape to verify against; revisit if a real
    // invocation later shows json insufficient.
    async analyze({ question, snapshotRoot, timeoutMs = CURSOR_ANALYZE_TIMEOUT_MS }) {
      const args = [
        "-p", question, "--output-format", "json", "--mode", "ask",
        "--sandbox", "enabled", "--workspace", snapshotRoot, "--model", modelId
      ];
      return new Promise((resolve) => {
        let child;
        try {
          child = spawnFn("cursor-agent", args, { cwd: snapshotRoot, stdio: ["ignore", "pipe", "pipe"] });
        } catch (error) {
          resolve(unknownCursorResult(error?.message ?? error));
          return;
        }
        let stdout = "";
        let finished = false;
        const timer = setTimeout(() => finish(unknownCursorResult("cursor-agent -p timed out")), timeoutMs);
        function finish(result) {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          try { child.kill?.(); } catch { /* best effort */ }
          resolve(result);
        }
        child.stdout?.on("data", (chunk) => { stdout += chunk; });
        child.once?.("error", (error) => finish(unknownCursorResult(error?.message ?? error)));
        child.once?.("close", () => {
          let parsed;
          try { parsed = JSON.parse(stdout); } catch { return finish(unknownCursorResult("malformed JSON from cursor-agent -p")); }
          const answer = parsed?.result ?? parsed?.text ?? parsed?.message ?? null;
          if (typeof answer !== "string") return finish(unknownCursorResult("no result text in cursor-agent -p response"));
          finish({ status: "answered", answer, error: null });
        });
      });
    }
  };
}

const ADAPTER_FACTORIES = Object.freeze({
  codex: createCodexBootstrapAnalyzerAdapter,
  claude: createClaudeBootstrapAnalyzerAdapter,
  cursor: createCursorBootstrapAnalyzerAdapter
});

/**
 * @param {string} adapterId
 * @param {{modelId: string, deps?: object}} [options]
 * @returns {{adapterId: string, modelId: string, checkEligibility: Function, analyze: Function}}
 */
export function createBootstrapAnalyzerAdapter(adapterId, { modelId, deps = {} } = {}) {
  const factory = ADAPTER_FACTORIES[adapterId];
  if (!factory) {
    const reason = `No Bootstrap Analyzer adapter implemented for "${adapterId}" yet.`;
    return {
      adapterId, modelId,
      checkEligibility() { return { eligible: false, reason, isolation: "unverified", canaryTested: false }; },
      async analyze() { throw new Error(reason); }
    };
  }
  return factory({ modelId, deps });
}
