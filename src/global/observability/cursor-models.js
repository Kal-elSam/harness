import { spawn as defaultSpawn } from "node:child_process";

// Real per-account model list via `cursor-agent models`. Unlike Codex/
// OpenCode, this CLI's populated-list output shape has NOT been observed —
// on this machine the account genuinely has zero models ("No models
// available for this account."), so only the empty-list and error paths
// are verified live. The parser below handles a plausible populated shape
// (one model name per line) defensively, but treat it as unverified until
// tested against an account that actually has models.
const DEFAULT_TIMEOUT_MS = 8_000;
const SOURCE = "cursor-agent models";
const ANSI_PATTERN = /\x1b\[[0-9;]*[a-zA-Z]/g;
const NO_MODELS_SENTINEL = /no models available/i;
const LOADING_LINE = /^loading models/i;

function unknown(error = null) {
  return { status: "unknown", source: SOURCE, models: [], error: error ? String(error) : null };
}

/**
 * Strips the spinner's ANSI control codes and its own status lines,
 * returning either an empty array (the account has no models — a real,
 * confirmed answer) or the remaining non-empty lines as model names.
 */
export function parseCursorModelsOutput(raw) {
  const clean = String(raw ?? "").replace(ANSI_PATTERN, "");
  const lines = clean.split("\n").map((line) => line.trim()).filter(Boolean).filter((line) => !LOADING_LINE.test(line));
  if (lines.some((line) => NO_MODELS_SENTINEL.test(line))) return [];
  return lines;
}

/**
 * Reads Cursor Agent's real, currently-available model list for this
 * account. `status: "measured"` with an empty `models` array is itself a
 * real answer (this account has none) — distinct from `"unknown"`, which
 * means the read itself failed.
 */
export async function readCursorModels({
  spawn = defaultSpawn,
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  let child;
  try {
    child = spawn("cursor-agent", ["models"], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return unknown(error?.message ?? error);
  }

  return new Promise((resolve) => {
    let stdout = "";
    let finished = false;
    const timer = setTimeout(() => finish(unknown("cursor-agent models timed out")), timeoutMs);

    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { child.kill?.(); } catch { /* best effort */ }
      resolve(result);
    }

    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
    child.once?.("close", () => {
      finish({ status: "measured", source: SOURCE, models: parseCursorModelsOutput(stdout), error: null });
    });
  });
}
