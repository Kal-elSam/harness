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
  return {
    adapterId: "claude",
    modelId,
    // Claude's --restricted (quick-ask.js's askClaude) strips
    // Bash/code-exec/WebFetch and confines the remaining file tools to
    // cwd — a real, meaningful reduction, but never independently
    // canary-tested the way Codex's sandbox-exec boundary was (no test
    // has proven a real absolute-path read outside cwd is actually
    // denied). Reported honestly as "restricted", not "verified".
    checkEligibility() {
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
