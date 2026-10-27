// Default readers never run a model. Claude/Cursor access and quota use local
// caches; Codex reads its real catalog through the read-only app-server RPC.

import { readClaudeEntitlementCache, resolveClaudeEntitlements } from "../observability/claude-entitlement-store.js";
import { readCodexModels } from "../observability/codex-models.js";
import { readClaudeModels } from "../observability/claude-models.js";
import { readCursorAccessCache, resolveCursorPoolAccess } from "../observability/cursor-entitlement-store.js";
import { CURSOR_POOL } from "../observability/cursor-entitlement.js";
import { readCachedUsage } from "../host/workspace-cache.js";
import { STATUS_ARGV } from "./allowlist.js";
import { parseCursorAuth } from "./parsers.js";
import { createSpawnRunner, execute } from "./runner.js";

import { QUOTA_CACHE_MAX_AGE_MS, routingQuotaWindows } from "../team/quota-snapshot.js";
import { readRoutingInputCache } from "../team/routing-input-cache.js";
import { resolveProjectRoot } from "../architect/architect-store.js";

// Quota is account-wide and the usage cache is not identity-bound, so only a
// recent snapshot is trusted.
export { QUOTA_CACHE_MAX_AGE_MS };

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
    async codex() {
      const catalog = await readCodexModels({ spawn: deps.spawn, cwd: deps.cwd });
      if (catalog.status !== "measured") return [];
      return catalog.models.filter(model => typeof model.id === "string" && model.id.trim()).map(model => ({
        modelId: model.id, label: model.displayName, catalogued: true
      }));
    },
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
    // opencode-go: no per-model evidence source exists => no reader.
  };

  async function usageSnapshot(now) {
    const cached = await readCachedUsage(homeDir, deps);
    if (!cached || !Number.isFinite(cached.savedAt) || now - cached.savedAt > QUOTA_CACHE_MAX_AGE_MS) return null;
    return cached.value?.usage ?? null;
  }
  // The usage cache has no production writer; the routing-input cache carries the real windows.
  async function routingWindows(provider, now) {
    try {
      const root = deps.projectRoot ?? await resolveProjectRoot(deps.cwd);
      return routingQuotaWindows(await readRoutingInputCache(homeDir, root), provider, now);
    } catch {
      return null;
    }
  }
  const windowsQuota = (provider, pick) => async ({ now }) => {
    const usage = await usageSnapshot(now);
    let remaining = usage ? pick(usage) : null;
    if (remaining === null && provider !== "opencode-go") remaining = worstRemaining(await routingWindows(provider, now) ?? []);
    return remaining === null ? null : { remainingPercent: remaining };
  };
  const quotaReaders = {
    codex: windowsQuota("codex", (u) => worstRemaining([u.codex?.primary, u.codex?.secondary])),
    claude: windowsQuota("claude", (u) => worstRemaining([u.claude?.primary, u.claude?.secondary])),
    "opencode-go": windowsQuota("opencode-go", (u) => worstRemaining(u.opencode?.go?.windows ?? []))
  };
  return { accessReaders, quotaReaders };
}
