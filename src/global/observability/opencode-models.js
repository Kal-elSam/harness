import { spawn as defaultSpawn } from "node:child_process";

// Real per-provider model catalog via `opencode models <provider> --verbose`
// — covers both OpenCode Go (provider "opencode-go") and OpenCode Zen
// (provider "opencode"), the two providers Kairo actually routes through.
// Same fail-closed contract as codex-models.js: any spawn/parse error or
// empty catalog yields `unknown`, never a fabricated model list.
const DEFAULT_TIMEOUT_MS = 8_000;

function unknown(provider, error = null) {
  return { status: "unknown", source: `opencode models ${provider} --verbose`, provider, models: [], error: error ? String(error) : null };
}

/**
 * Parses `opencode models <provider> --verbose` output: a "provider/model"
 * header line followed by a pretty-printed JSON object, repeated per model.
 * Strips the header lines and brace-matches the remaining text into
 * complete JSON objects — robust to the exact indentation/whitespace the
 * CLI uses, since it never assumes a fixed line count per model.
 */
export function parseOpenCodeModelsVerbose(text) {
  const lines = String(text ?? "").split("\n");
  const jsonText = lines.filter((line) => !/^[\w.-]+\/[\w.-]+$/.test(line.trim())).join("\n");
  const models = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < jsonText.length; i += 1) {
    const char = jsonText[i];
    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        try { models.push(JSON.parse(jsonText.slice(start, i + 1))); } catch { /* skip an unparseable entry, don't fail the whole catalog */ }
        start = -1;
      }
    }
  }
  return models;
}

function normalizeModel(entry) {
  return {
    id: entry.id,
    providerID: entry.providerID,
    displayName: entry.name ?? entry.id,
    status: entry.status ?? "unknown",
    costInputPerMTok: entry.cost?.input ?? null,
    costOutputPerMTok: entry.cost?.output ?? null,
    contextWindow: entry.limit?.context ?? null,
    maxOutput: entry.limit?.output ?? null,
    supportsReasoning: entry.capabilities?.reasoning === true,
    supportsToolCall: entry.capabilities?.toolcall === true
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
    child = spawn("opencode", ["models", provider, "--verbose"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
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
      const models = parseOpenCodeModelsVerbose(stdout).map(normalizeModel);
      if (models.length === 0) return finish(unknown(provider, "no models parsed"));
      finish({ status: "measured", source: `opencode models ${provider} --verbose`, provider, models, error: null });
    });
  });
}
