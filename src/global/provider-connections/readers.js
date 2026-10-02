// Default CACHE-ONLY readers used when createProviderConnections() is built
// without injected pieces. They only read files Kairo already wrote
// (entitlement/access/usage caches); they never probe a model, never list
// models through a CLI and never spawn a process. Anything without a cached
// source is reported as unverified/catalogued/unknown, never guessed.

import { readClaudeEntitlementCache, resolveClaudeEntitlements } from "../observability/claude-entitlement-store.js";
import { readClaudeModels } from "../observability/claude-models.js";
import { readCursorAccessCache, resolveCursorPoolAccess } from "../observability/cursor-entitlement-store.js";
import { CURSOR_POOL } from "../observability/cursor-entitlement.js";
import { readCachedUsage } from "../host/workspace-cache.js";
import { STATUS_ARGV } from "./allowlist.js";
import { parseCursorAuth } from "./parsers.js";
import { createSpawnRunner, execute } from "./runner.js";

// Quota is account-wide and the usage cache is not identity-bound, so only a
// recent snapshot is trusted.
export const QUOTA_CACHE_MAX_AGE_MS = 30 * 60 * 1000;

const POOL_LABELS = { [CURSOR_POOL.CURSOR_MODELS]: "Cursor models", [CURSOR_POOL.OTHER_MODELS]: "Other models" };

function worstRemaining(windows) {
  const values = windows.map((w) => w?.remainingPercent).filter((v) => typeof v === "number" && Number.isFinite(v));
  return values.length > 0 ? Math.min(...values) : null;
}

/**
 * Production identity source for the Cursor access writer: ONLY the allowlisted
 * `cursor-agent status --format json` through the shared runner, parsed by the
 * existing parser. Any failure or absent field is null (never a guess).
 */
export async function readCursorAccountIdentifier({ runner = createSpawnRunner(), timeoutMs = 10_000, signal } = {}) {
  try {
    const step = await execute(runner, STATUS_ARGV.cursor.auth, { timeoutMs, signal });
    return step.kind === "exit" ? (parseCursorAuth(step).identifier ?? null) : null;
  } catch {
    return null;
  }
}

export function createDefaultReaders({ homeDir, deps = {} } = {}) {
  const accessReaders = {
    // Per documented catalog model. Evidence comes from the entitlement cache
    // and is only reused when subscription type and account fingerprint match.
    async claude({ accountIdentifier = null, subscriptionType = null, now }) {
      const cache = await readClaudeEntitlementCache(homeDir, deps);
      const models = readClaudeModels().models;
      const resolved = resolveClaudeEntitlements({
        cache, subscriptionType, catalogIds: models.map((m) => m.id), now, accountIdentifier
      });
      return models.map((model) => {
        const evidence = resolved[model.id];
        return { ...evidence, modelId: model.id, label: model.displayName, catalogued: !evidence.probedAt };
      });
    },
    // Pool-level only: there is no cache-only Cursor model catalog (listing
    // models needs `cursor-agent models`, which Kairo never runs from here).
    async cursor({ accountIdentifier = null, now }) {
      const cache = await readCursorAccessCache(homeDir, deps);
      // A cache with evidence but no fingerprint predates identity-aware writes (or the
      // account was unidentifiable when it was written): say so instead of a bare unknown.
      const unidentified = Object.keys(cache?.pools ?? {}).length > 0 && typeof cache.accountFingerprint !== "string";
      return Object.values(CURSOR_POOL).map((pool) => {
        const access = resolveCursorPoolAccess({ cache, pool, now, accountIdentifier });
        const reason = unidentified && access.status === "unverified" ? "cursor_identity_not_recorded" : access.reason;
        return { ...access, reason, modelId: pool, label: POOL_LABELS[pool] ?? pool, scope: "pool" };
      });
    }
    // codex / opencode-go: no per-model evidence source exists => no reader.
  };

  async function usageSnapshot(now) {
    const cached = await readCachedUsage(homeDir, deps);
    if (!cached || !Number.isFinite(cached.savedAt) || now - cached.savedAt > QUOTA_CACHE_MAX_AGE_MS) return null;
    return cached.value?.usage ?? null;
  }
  const windowsQuota = (pick) => async ({ now }) => {
    const usage = await usageSnapshot(now);
    const remaining = usage ? pick(usage) : null;
    return remaining === null ? null : { remainingPercent: remaining };
  };
  const quotaReaders = {
    codex: windowsQuota((u) => worstRemaining([u.codex?.primary, u.codex?.secondary])),
    claude: windowsQuota((u) => worstRemaining([u.claude?.primary, u.claude?.secondary])),
    "opencode-go": windowsQuota((u) => worstRemaining(u.opencode?.go?.windows ?? []))
  };
  return { accessReaders, quotaReaders };
}
