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
import { probeCursorAuth as defaultProbeCursorAuth } from "../observability/cursor-auth.js";
import {
  getCursorIsolationStatus as defaultGetCursorIsolationStatus,
  runCursorSandboxedBootstrap as defaultRunCursorSandboxedBootstrap
} from "./cursor-sandbox.js";

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
const CURSOR_AUTO_CANONICAL = "cursor:auto";
const CURSOR_ANALYZE_TIMEOUT_MS = 180_000;

export function createCursorBootstrapAnalyzerAdapter({ modelId, deps = {} } = {}) {
  const listModels = deps.readCursorModels ?? defaultReadCursorModels;
  const probeAuth = deps.probeCursorAuth ?? defaultProbeCursorAuth;
  const getIsolation = deps.getCursorIsolationStatus ?? defaultGetCursorIsolationStatus;
  const runSandboxed = deps.runCursorSandboxedBootstrap ?? defaultRunCursorSandboxedBootstrap;
  const isAuto = modelId != null && CURSOR_AUTO_IDS.has(String(modelId).toLowerCase());
  // Cursor Auto is a distinct, real candidate identity, never an implicit
  // default for a missing selection — its own outcomes are ALWAYS
  // attributed to this canonical "cursor:auto" id, never to a guessed
  // inner model (Cursor never discloses which model actually answered in
  // Auto mode). A caller must explicitly choose it.
  const normalizedModelId = isAuto ? CURSOR_AUTO_CANONICAL : modelId;
  return {
    adapterId: "cursor",
    modelId: normalizedModelId,
    // Real eligibility — currently, honestly, negative. Real gates, none
    // skipped or assumed:
    //  1. A modelId must actually be provided — either a real explicit
    //     model or the canonical "cursor:auto" opaque-router candidate;
    //     an absent selection is never silently defaulted to either.
    //  2. For an EXPLICIT model: checked against the real per-account
    //     catalog (observability/cursor-models.js's readCursorModels — a
    //     real `cursor-agent models` call, exit-status-checked). Cursor
    //     Auto is exempt from this specific check (it's a routing mode,
    //     not a listed catalog model) — but exempting the catalog check
    //     must never also exempt authentication: `cursor-agent status`/
    //     `whoami` do NOT reliably reflect whether a real invocation will
    //     work (verified empirically — status can report "Logged in"
    //     while a real -p call still fails with "Authentication
    //     required"), so Auto is separately gated on
    //     observability/cursor-auth.js's probeCursorAuth, a real
    //     invocation-based probe, not the unreliable status/whoami claim.
    //  3. Isolation proof, for BOTH explicit models and Cursor Auto alike:
    //     Cursor's OWN --sandbox enabled does NOT confine reads (verified
    //     empirically — a real out-of-bounds absolute-path read under
    //     --sandbox enabled alone succeeded and disclosed real content).
    //     The real boundary is cursor-sandbox.js's external macOS
    //     sandbox-exec wrapper (mirroring codex-sandbox.js), independently
    //     canary-tested and proven to hold: an in-bounds read succeeds, an
    //     out-of-bounds one is denied ("Permission denied"). isolation:
    //     "verified" + canaryTested: true only when that mechanism is
    //     actually available (macOS + sandbox-exec present) — never on
    //     any other platform, and never via Cursor's own --sandbox flag.
    async checkEligibility() {
      if (!modelId) {
        return {
          eligible: false,
          reason: "No Cursor model selection was provided — pass an explicit model or \"cursor:auto\".",
          isolation: "unverified", canaryTested: false
        };
      }
      if (!isAuto) {
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
        if (!catalog.models.some((m) => m.id === modelId)) {
          return {
            eligible: false, reason: `"${modelId}" is not in this account's real Cursor model catalog.`,
            isolation: "unverified", canaryTested: false
          };
        }
      } else {
        const auth = await probeAuth();
        if (auth.status !== "measured") {
          return {
            eligible: false, reason: `Could not determine whether Cursor Auto can actually be invoked: ${auth.reason ?? auth.status}`,
            isolation: "unverified", canaryTested: false
          };
        }
        if (!auth.authenticated) {
          return { eligible: false, reason: auth.reason, isolation: "unverified", canaryTested: false };
        }
      }
      const isolation = await getIsolation(deps.isolationDeps ?? {});
      if (!isolation.available) {
        return { eligible: false, reason: isolation.reason, isolation: "unverified", canaryTested: false };
      }
      return { eligible: true, isolation: "verified", canaryTested: true };
    },
    // Routed through cursor-sandbox.js's external sandbox-exec wrapper —
    // never a bare `cursor-agent` spawn, since Cursor's own --sandbox
    // enabled does not confine reads (see that module's header for the
    // full empirical finding). Cursor Auto omits a model id; the wrapper
    // itself omits --model entirely for that case.
    async analyze({ question, snapshotRoot, timeoutMs = CURSOR_ANALYZE_TIMEOUT_MS }) {
      return runSandboxed({
        question, model: isAuto ? null : modelId, snapshotRoot, timeoutMs, deps: deps.isolationDeps ?? {}
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
