import { spawn as defaultSpawn } from "node:child_process";

// Real per-account model catalog via Codex's app-server JSON-RPC protocol
// (`model/list`, confirmed present in `codex app-server generate-json-schema`
// output and verified live) — never the static, possibly-stale documented
// list. Same fail-closed shape as codex-usage.js: any error yields
// `unknown`, never a fabricated model.
const DEFAULT_TIMEOUT_MS = 2500;
const SOURCE = "codex app-server model/list";

function unknown(error = null) {
  return { status: "unknown", source: SOURCE, models: [], error: error ? String(error) : null };
}

function writeRequest(child, id, method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
}

function normalizeModel(entry) {
  return {
    id: entry.id,
    displayName: entry.displayName ?? entry.id,
    isDefault: entry.isDefault === true,
    hidden: entry.hidden === true
  };
}

/**
 * Reads Codex's real, currently-available model catalog for this
 * authenticated account — not a static documented list. Excludes hidden
 * models by default (mirrors what Codex's own picker would offer).
 */
export async function readCodexModels({
  spawn = defaultSpawn,
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  includeHidden = false
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
    let listRequestId = null;
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
      if (!message || typeof message !== "object" || message.id == null) return;
      if (message.error) return finish(unknown(`codex app-server error: ${message.error.message ?? "request failed"}`));
      if (message.id === 1) {
        listRequestId = 2;
        writeRequest(child, listRequestId, "model/list", { includeHidden });
        return;
      }
      if (message.id === listRequestId) {
        const data = Array.isArray(message.result?.data) ? message.result.data : null;
        if (!data) return finish(unknown("codex returned no model list"));
        finish({ status: "measured", source: SOURCE, models: data.map(normalizeModel), error: null });
      }
    }

    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onLine(line.trim());
    });
    child.once?.("error", (error) => finish(unknown(error?.message ?? error)));
    child.once?.("close", () => { if (!finished) finish(unknown("codex app-server closed before model list")); });

    writeRequest(child, 1, "initialize", {
      clientInfo: { name: "kairo", title: "Kairo", version: "0.23.1" },
      capabilities: {}
    });
  });
}
