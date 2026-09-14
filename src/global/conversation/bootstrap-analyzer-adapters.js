// A neutral contract for Bootstrap Analysis, so conversation/service.js's
// runBootstrapAnalysis doesn't special-case providers inline — each real
// provider gets its own adapter, and adding a new one (Cursor, a future
// verified Claude boundary, etc.) means adding a factory here, not
// branching inside runBootstrapAnalysis.
//
// Every adapter exposes:
//   adapterId, modelId
//   checkEligibility(): Promise<{ eligible, reason?, isolation }>
//     isolation is one of "verified" | "restricted" | "unverified" —
//     "verified" means an empirically-proven OS-level boundary (like
//     Codex's sandbox-exec, see codex-sandbox.js); "restricted" means a
//     real, meaningful reduction that has NOT been independently
//     canary-tested the same way (like Claude's --restricted); never
//     invent "verified" for a provider that hasn't actually been proven.
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
        isolation: isolation.available ? "verified" : "unverified"
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
    //  3. isolation: "restricted" — --restricted's actual confinement was
    //     empirically canary-tested (not assumed): a real absolute-path
    //     read outside cwd came back in the JSON output's own
    //     `permission_denials` array (Claude's Read tool itself refused
    //     it), while an in-bounds read succeeded with an empty
    //     `permission_denials`. That's a real, held boundary — but
    //     enforced by the claude CLI's own in-process tool-permission
    //     logic, not an OS kernel sandbox like Codex's sandbox-exec (a
    //     bug in that enforcement, unlike a kernel boundary, could
    //     theoretically be bypassed). "verified" stays reserved for a
    //     kernel-enforced boundary; Claude does not qualify for that
    //     label even though its own boundary has now been proven to hold.
    async checkEligibility() {
      try {
        await verifyAuth({});
      } catch (error) {
        return { eligible: false, reason: error?.message ?? String(error), isolation: "unverified" };
      }
      if (modelId) {
        const catalog = listModels();
        const known = catalog.models.some((m) => m.id === modelId);
        if (!known) {
          return { eligible: false, reason: `"${modelId}" is not in Claude's documented model catalog.`, isolation: "unverified" };
        }
      }
      return { eligible: true, isolation: "restricted" };
    },
    async analyze({ question, snapshotRoot, timeoutMs }) {
      return ask({ provider: "claude", question, model: modelId, cwd: snapshotRoot, timeoutMs });
    }
  };
}

const ADAPTER_FACTORIES = Object.freeze({
  codex: createCodexBootstrapAnalyzerAdapter,
  claude: createClaudeBootstrapAnalyzerAdapter
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
      checkEligibility() { return { eligible: false, reason, isolation: "unverified" }; },
      async analyze() { throw new Error(reason); }
    };
  }
  return factory({ modelId, deps });
}
