import { spawn as defaultSpawn } from "node:child_process";

// Claude Code's `/usage` is a local_command — intercepted client-side before
// it reaches the model, so `claude -p "/usage" --output-format json` returns
// real session/weekly percentages at zero cost (total_cost_usd: 0, all token
// counts 0). This mirrors codex-usage.js's app-server approach: a real,
// zero-cost, local read, never a fabricated quota.
const SOURCE = 'claude -p "/usage" (local_command, zero-cost)';
const DEFAULT_TIMEOUT_MS = 15_000;

function unknown(error = null) {
  return {
    status: "unknown",
    source: SOURCE,
    windows: [],
    primary: null,
    secondary: null,
    raw: null,
    error: error ? String(error) : null
  };
}

/**
 * Parses lines like:
 *   "Current session: 0% used · resets Sep 11 at 7:09pm (America/Mexico_City)"
 *   "Current week (all models): 7% used · resets Sep 13 at 7:59am (America/Mexico_City)"
 * into normalized usage windows. Unrecognized lines are skipped, not guessed.
 */
export function parseClaudeUsageText(text) {
  const windows = [];
  for (const line of String(text ?? "").split("\n")) {
    const match = line.match(/^(.+?):\s*(\d+)%\s*used(?:\s*·\s*resets\s*(.+))?\s*$/);
    if (!match) continue;
    const usedPercent = Number(match[2]);
    if (!Number.isFinite(usedPercent)) continue;
    windows.push({
      label: match[1].trim(),
      usedPercent,
      remainingPercent: 100 - usedPercent,
      resetsAt: match[3] ? match[3].trim() : null
    });
  }
  return windows;
}

/**
 * Reads Claude Code's own real session/weekly usage percentages via its
 * `/usage` local_command, without starting a model turn. Fail-closed: any
 * spawn error, timeout, malformed JSON, or unparseable response yields
 * `unknown`, never a fabricated percentage.
 */
export async function readClaudeUsage({
  spawn = defaultSpawn,
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  let child;
  try {
    child = spawn("claude", ["-p", "/usage", "--output-format", "json"], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    return unknown(error?.message ?? error);
  }

  return new Promise((resolve) => {
    let stdout = "";
    let finished = false;
    const timer = setTimeout(() => finish(unknown("claude -p \"/usage\" timed out")), timeoutMs);

    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { child.kill?.(); } catch { /* best effort */ }
      resolve(result);
    }

    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.on("error", (error) => finish(unknown(error?.message ?? error)));
    child.on("close", () => {
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        finish(unknown("malformed JSON from claude -p \"/usage\""));
        return;
      }
      if (parsed?.local_command !== "usage" || typeof parsed?.result !== "string") {
        finish(unknown("unexpected response shape from claude -p \"/usage\""));
        return;
      }
      const windows = parseClaudeUsageText(parsed.result);
      if (windows.length === 0) {
        finish(unknown("no usage windows parsed from claude -p \"/usage\""));
        return;
      }
      finish({
        status: "measured",
        source: SOURCE,
        windows,
        primary: windows[0] ?? null,
        secondary: windows[1] ?? null,
        raw: parsed.result,
        error: null
      });
    });
  });
}
