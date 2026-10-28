import { spawn as defaultSpawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The host CLI owns catalog membership; its cache only supplies metadata.
// Covers OpenCode Go ("opencode-go") and Zen ("opencode"). Missing cache
// metadata is harmless; an unavailable or empty CLI catalog fails closed.
const DEFAULT_TIMEOUT_MS = 8_000;
const SOURCE = "opencode models";

function unknown(provider, error = null) {
  return { status: "unknown", source: SOURCE, provider, models: [], error: error ? String(error) : null };
}

/** Parse the host's mixed-provider list without inventing catalog entries. */
export function parseOpenCodeModelList(text, provider) {
  const prefix = `${provider}/`;
  const ids = String(text ?? "").split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

function readHostMetadata(env, provider) {
  const cacheHome = env.XDG_CACHE_HOME || (env.HOME ? join(env.HOME, ".cache") : null);
  if (!cacheHome) return {};
  try {
    const cache = JSON.parse(readFileSync(join(cacheHome, "opencode", "models.json"), "utf8"));
    return cache?.[provider]?.models ?? {};
  } catch {
    return {}; // The host cache is optional, not a second catalog.
  }
}

function normalizeModel(id, provider, entry) {
  return {
    id,
    providerID: provider,
    displayName: entry?.name ?? id,
    status: entry?.status ?? "active",
    costInputPerMTok: entry?.cost?.input ?? null,
    costOutputPerMTok: entry?.cost?.output ?? null,
    contextWindow: entry?.limit?.context ?? null,
    maxOutput: entry?.limit?.output ?? null,
    supportsReasoning: entry?.reasoning === true,
    supportsToolCall: entry?.tool_call === true
  };
}

/**
 * Reads the real, currently-listed model catalog for one OpenCode provider
 * ("opencode-go" or "opencode" for Zen). Requires the `opencode` CLI to be
 * installed and authenticated — same as the rest of the OpenCode adapter.
 */
export async function readOpenCodeModels({
  provider,
  spawn = defaultSpawn,
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  if (!provider) return unknown("unknown", "provider is required");

  let child;
  try {
    child = spawn("opencode", ["models"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return unknown(provider, error?.message ?? error);
  }

  return new Promise((resolve) => {
    let stdout = "";
    let finished = false;
    const timer = setTimeout(() => finish(unknown(provider, "opencode models timed out")), timeoutMs);

    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { child.kill?.(); } catch { /* best effort */ }
      resolve(result);
    }

    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.once?.("error", (error) => finish(unknown(provider, error?.message ?? error)));
    child.once?.("close", (code) => {
      if (code !== 0 && !stdout.trim()) return finish(unknown(provider, `opencode models exited with code ${code}`));
      const metadata = readHostMetadata(env, provider);
      const models = parseOpenCodeModelList(stdout, provider)
        .map((id) => normalizeModel(id, provider, metadata[id]));
      if (models.length === 0) return finish(unknown(provider, "no models parsed"));
      finish({ status: "measured", source: SOURCE, provider, models, error: null });
    });
  });
}
