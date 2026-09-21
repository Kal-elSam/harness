import { spawn as defaultSpawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 2500;
const SOURCE = "codex app-server account/rateLimits/read";

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, number));
}

function epochSecondsToIso(value) {
  try {
    const date = new Date(Number(value) * 1000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

function normalizeWindow(name, value) {
  if (!value || typeof value !== "object") return null;
  const usedPercent = clampPercent(value.usedPercent ?? value.used_percentage);
  if (usedPercent == null) return null;
  const windowDurationMins = Number(value.windowDurationMins ?? value.window_duration_mins);
  const resetsAt = value.resetsAt ?? value.resets_at ?? null;
  const numericReset = (typeof resetsAt === "number" && Number.isFinite(resetsAt))
    || (typeof resetsAt === "string" && resetsAt.trim() !== "" && Number.isFinite(Number(resetsAt)));
  const resetsAtIso = numericReset
    ? epochSecondsToIso(resetsAt)
    : (typeof resetsAt === "string" ? resetsAt : null);
  return {
    name,
    usedPercent,
    remainingPercent: 100 - usedPercent,
    // Short aliases keep the normalized contract convenient for consumers
    // while the explicit Percent fields make units unambiguous in the UI.
    used: usedPercent,
    remaining: 100 - usedPercent,
    windowDurationMins: Number.isFinite(windowDurationMins) ? windowDurationMins : null,
    // The app-server contract uses epoch seconds. Preserve that value and
    // provide an ISO projection for human-facing clients.
    resetsAt: numericReset ? Number(resetsAt) : (typeof resetsAt === "string" ? resetsAt : null),
    resetsAtIso
  };
}

/** Normalize only safe, displayable rate-limit fields. Never returns account ids/credits. */
export function normalizeCodexRateLimits(payload) {
  const root = payload?.rateLimits ?? payload?.rate_limits ?? payload ?? {};
  const primary = normalizeWindow("5h", root.primary);
  const secondary = normalizeWindow("weekly", root.secondary);
  // Current Codex returns this beside `rateLimits`; accept the older nested
  // placement only as a compatibility fallback.
  const ordinaryUsageAllowed = payload?.ordinaryUsageAllowed
    ?? payload?.ordinary_usage_allowed
    ?? root.ordinaryUsageAllowed
    ?? root.ordinary_usage_allowed;
  const allowed = typeof ordinaryUsageAllowed === "boolean" ? ordinaryUsageAllowed : null;
  if (!primary && !secondary && allowed == null) return null;
  return {
    status: allowed === false ? "exhausted" : "measured",
    source: SOURCE,
    ordinaryUsageAllowed: allowed,
    windows: [primary, secondary].filter(Boolean),
    primary,
    secondary
  };
}

function unknown(error = null) {
  return {
    status: "unknown",
    source: SOURCE,
    ordinaryUsageAllowed: null,
    windows: [],
    primary: null,
    secondary: null,
    error: error ? String(error) : null
  };
}

function writeRequest(child, id, method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
}

/**
 * Read Codex subscription rate limits without starting a model turn.
 * This is deliberately fail-closed: malformed output, unavailable auth, or a
 * timeout produces `unknown`, never a fabricated quota or a PAYG fallback.
 */
export async function readCodexUsage({
  spawn = defaultSpawn,
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  let child;
  try {
    child = spawn("codex", ["app-server", "--listen", "stdio://"], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (error) {
    return unknown(error?.message ?? error);
  }

  return new Promise((resolve) => {
    let buffer = "";
    let nextId = 2;
    let rateRequestId = null;
    let finished = false;
    const timer = setTimeout(() => finish(unknown("codex app-server timeout")), timeoutMs);

    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { child.kill?.(); } catch { /* best effort */ }
      resolve(result);
    }

    function onLine(line) {
      let message;
      try { message = JSON.parse(line); } catch { return finish(unknown("malformed codex app-server output")); }
      if (!message || typeof message !== "object") return;
      // Notifications have no id and must not affect the request state.
      if (message.id == null) return;
      if (message.error) return finish(unknown(`codex app-server error: ${message.error.message ?? "request failed"}`));
      if (message.id === 1) {
        rateRequestId = nextId++;
        writeRequest(child, rateRequestId, "account/rateLimits/read", {
          excludeResetCreditDetails: true,
          supportsLunaReserve: false
        });
        return;
      }
      if (message.id === rateRequestId) {
        finish(normalizeCodexRateLimits(message.result) ?? unknown("codex returned unusable rate limits"));
      }
    }

    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onLine(line.trim());
    });
    child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
    child.once?.("close", () => { if (!finished) finish(unknown("codex app-server closed before rate limits")); });

    writeRequest(child, 1, "initialize", {
      clientInfo: { name: "kairo", title: "Kairo", version: "0.30.1" },
      capabilities: {}
    });
  });
}

export const CODEX_USAGE_SOURCE = SOURCE;
