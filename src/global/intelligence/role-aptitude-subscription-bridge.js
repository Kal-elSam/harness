// Production authorization bridge for aptitude runs (S52).
// Billing is strict: only a subscription login with no provider API key in the
// run environment passes. Identity is informative and never blocks. Checks run
// locally through the allowlisted status commands and spend no quota. Neither
// email nor org name ever leaves this module.

import { createHash } from "node:crypto";
import { computeAccountFingerprint } from "../observability/account-fingerprint.js";
import { STATUS_ARGV } from "../provider-connections/allowlist.js";
import { createSpawnRunner, execute } from "../provider-connections/runner.js";

const API_KEY_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY"];
const STATUS_TIMEOUT_MS = 10_000;

function unverifiable(reason) {
  return { ok: false, code: "billing_unverifiable", reason };
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** Production reader: `claude auth status --json` through the shared bounded runner. */
export async function readClaudeAuthStatus({ runner = createSpawnRunner(), timeoutMs = STATUS_TIMEOUT_MS } = {}) {
  try {
    const step = await execute(runner, STATUS_ARGV.claude.auth, { timeoutMs });
    return step.kind === "exit" ? parseJson(step.stdout) : null;
  } catch {
    return null;
  }
}

/** Production reader: `codex login status` text through the shared bounded runner. */
export async function readCodexLoginStatus({ runner = createSpawnRunner(), timeoutMs = STATUS_TIMEOUT_MS } = {}) {
  try {
    const step = await execute(runner, STATUS_ARGV.codex.auth, { timeoutMs });
    return step.kind === "exit" ? `${step.stdout}\n${step.stderr}`.trim() || null : null;
  } catch {
    return null;
  }
}

function str(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function claudeFacts(status) {
  if (!status || typeof status !== "object" || typeof status.loggedIn !== "boolean") return null;
  const identifier = [status.email, status.orgId].map(str).filter(Boolean).join("|") || null;
  return {
    loggedIn: status.loggedIn,
    loginMethod: str(status.authMethod),
    plan: str(status.subscriptionType),
    accountFingerprint: computeAccountFingerprint(identifier)
  };
}

function codexFacts(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const chatgpt = /logged in using chatgpt/i.test(text);
  return {
    loggedIn: chatgpt || /logged in/i.test(text),
    loginMethod: chatgpt ? "chatgpt" : "other",
    plan: null,
    accountFingerprint: null
  };
}

export function createSubscriptionBridge({
  readClaudeAuthStatus: readClaude = readClaudeAuthStatus,
  readCodexLoginStatus: readCodex = readCodexLoginStatus,
  env = process.env,
  now = Date.now
} = {}) {
  async function facts(provider) {
    try {
      if (provider === "claude") return claudeFacts(await readClaude());
      if (provider === "codex") return codexFacts(await readCodex());
    } catch { /* unreadable status fails closed below */ }
    return null;
  }

  return {
    async verifyBilling({ provider }) {
      const seen = await facts(provider);
      if (!seen) return unverifiable(`${provider} login status could not be read`);
      const present = API_KEY_ENV.filter(key => typeof env?.[key] === "string" && env[key].trim() !== "");
      if (present.length > 0) {
        return { ok: false, code: "api_key_present", reason: `provider API key set in environment (${present.join(", ")})` };
      }
      const subscription = provider === "claude"
        ? seen.loggedIn && seen.loginMethod === "claude.ai"
        : seen.loggedIn && seen.loginMethod === "chatgpt";
      if (!subscription) {
        return { ok: false, code: "billing_not_subscription", reason: `${provider} login is not a subscription login` };
      }
      const checkedAt = now();
      const receiptId = createHash("sha256")
        .update(JSON.stringify([provider, seen.loginMethod, seen.plan, checkedAt]))
        .digest("hex").slice(0, 32);
      return { ok: true, billingCertainty: "no_additional_charge", receiptId };
    },

    async verifyIdentity({ provider, modelId, accountKey }) {
      const seen = await facts(provider);
      const receipt = {
        loginMethod: seen?.loginMethod ?? null,
        plan: seen?.plan ?? null,
        accountFingerprint: seen?.accountFingerprint ?? null
      };
      const receiptId = createHash("sha256")
        .update(JSON.stringify([provider, modelId, accountKey, receipt, now()]))
        .digest("hex").slice(0, 32);
      return { ok: true, verifiedIdentity: { provider, modelId, accountKey }, receiptId, receipt };
    }
  };
}
