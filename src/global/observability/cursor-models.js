import { spawn as defaultSpawn } from "node:child_process";

// Real per-account model list via `cursor-agent models`. The populated
// shape below was captured from the real CLI against a real authenticated
// account with real models enabled (one `<id> - <Display Name>` entry per
// line, plus a leading "Available models" header and a trailing "Tip: use
// --model <id>..." line) — not assumed, not the earlier placeholder
// parser that predated ever seeing a real populated catalog.
//
// A process crash (killed by a signal) or a non-zero exit is never
// reinterpreted as a clean "no models" answer — an empty/partial stdout
// from a crash mid-run parses identically to a genuine empty catalog, so
// exit status is the only real signal that tells them apart. Only a clean
// exit (code 0, no signal) is trusted; anything else yields `status:
// "unknown"` with the real stderr, never a fabricated empty catalog.
const DEFAULT_TIMEOUT_MS = 8_000;
const SOURCE = "cursor-agent models";
const ANSI_PATTERN = /\x1b\[[0-9;]*[a-zA-Z]/g;
const NO_MODELS_SENTINEL = /no models available/i;
const LOADING_LINE = /^loading models/i;
// Real model line shape: "<id> - <Display Name>", id has no spaces (every
// real id observed is a bare slug like "gpt-5.3-codex-low" or "auto").
// Header ("Available models") and the trailing "Tip: ..." line never
// match this — no line-anchored " - " separator — so they're dropped
// without needing to special-case their exact text.
const MODEL_LINE_PATTERN = /^(\S+)\s-\s(.+)$/;

function unknown(error = null) {
  return { status: "unknown", source: SOURCE, models: [], error: error ? String(error) : null };
}

/**
 * Strips the spinner's ANSI control codes and non-model lines (loading
 * status, the "Available models" header, the trailing "Tip: ..." line),
 * returning either an empty array (the account has no models — a real,
 * confirmed answer) or the real `{id, displayName}` models — the same
 * shape codex-models.js/claude-models.js already use, so callers never
 * need to branch on catalog source.
 */
export function parseCursorModelsOutput(raw) {
  const clean = String(raw ?? "").replace(ANSI_PATTERN, "");
  const lines = clean.split("\n").map((line) => line.trim()).filter(Boolean).filter((line) => !LOADING_LINE.test(line));
  if (lines.some((line) => NO_MODELS_SENTINEL.test(line))) return [];
  const models = [];
  for (const line of lines) {
    const match = line.match(MODEL_LINE_PATTERN);
    if (match) models.push({ id: match[1], displayName: match[2].trim() });
  }
  return models;
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
    let stderr = "";
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
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
    child.once?.("close", (code, signal) => {
      // A crash (killed by a signal, e.g. a real SIGSEGV) or a non-zero
      // exit must never be silently reinterpreted as a clean, real
      // "no models" answer — an empty/partial stdout from a crash mid-run
      // parses identically to a genuine empty catalog, so exit status is
      // the only real signal that tells them apart. Only a clean exit
      // (code 0, no signal) is trusted to mean the CLI actually finished
      // and its stdout is a real, complete answer.
      if (signal) return finish(unknown(`cursor-agent models was killed by signal ${signal}${stderr ? `: ${stderr.trim()}` : ""}`));
      if (code !== 0) return finish(unknown(`cursor-agent models exited with code ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
      finish({ status: "measured", source: SOURCE, models: parseCursorModelsOutput(stdout), error: null });
    });
  });
}
