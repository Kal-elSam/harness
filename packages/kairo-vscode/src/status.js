"use strict";

const { spawn } = require("node:child_process");

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const INSTALL_HINT = "Install Kairo: npm install -g @kal-elsam/kairo-runtime";

function failureStatus({ installed, overall, nextAction, error }) {
  return { installed, ok: false, overall, nextAction, checks: [], error };
}

function fetchKairoStatus({
  command = "kairo",
  args = ["status", "--json"],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
  spawnFn = spawn
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let child = null;
    let stdout = "";
    let stderr = "";

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      if (child && !child.killed) child.kill("SIGTERM");
      finish(failureStatus({
        installed: true,
        overall: "error",
        nextAction: "Kairo status timed out. Run kairo status in a terminal.",
        error: "timeout"
      }));
    }, timeoutMs);

    try {
      child = spawnFn(command, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false
      });
    } catch (error) {
      finish(failureStatus({
        installed: false,
        overall: "missing",
        nextAction: INSTALL_HINT,
        error: error instanceof Error ? error.message : String(error)
      }));
      return;
    }

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      const missing = error?.code === "ENOENT";
      finish(failureStatus({
        installed: !missing,
        overall: missing ? "missing" : "error",
        nextAction: missing ? INSTALL_HINT : "Kairo could not start. Check your PATH.",
        error: error.message
      }));
    });

    child.on("close", (code) => {
      const trimmed = stdout.trim();
      if (!trimmed) {
        finish(failureStatus({
          installed: true,
          overall: "error",
          nextAction: "Kairo returned no status JSON.",
          error: stderr.trim() || `exit ${code ?? "?"}`
        }));
        return;
      }

      try {
        const parsed = JSON.parse(trimmed);
        finish({
          installed: true,
          ok: parsed.ok === true,
          overall: typeof parsed.overall === "string" ? parsed.overall : "unknown",
          nextAction:
            typeof parsed.nextAction === "string" && parsed.nextAction
              ? parsed.nextAction
              : "Open the Cockpit to review your setup.",
          checks: Array.isArray(parsed.checks) ? parsed.checks : [],
          backups: typeof parsed.backups === "number" ? parsed.backups : 0,
          cliVersion: typeof parsed.cliVersion === "string" ? parsed.cliVersion : undefined
        });
      } catch (error) {
        finish(failureStatus({
          installed: true,
          overall: "error",
          nextAction: "Kairo status JSON was invalid.",
          error: error instanceof Error ? error.message : String(error)
        }));
      }
    });
  });
}

class StatusCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, fetch = fetchKairoStatus } = {}) {
    this.ttlMs = ttlMs;
    this.fetch = fetch;
    this._value = null;
    this._fetchedAt = 0;
    this._inflight = null;
  }

  async get({ force = false } = {}) {
    const fresh = this._value && Date.now() - this._fetchedAt < this.ttlMs;
    if (!force && fresh) return this._value;
    if (this._inflight) return this._inflight;

    this._inflight = this.fetch()
      .then((value) => {
        this._value = value;
        this._fetchedAt = Date.now();
        return value;
      })
      .finally(() => {
        this._inflight = null;
      });

    return this._inflight;
  }

  invalidate() {
    this._value = null;
    this._fetchedAt = 0;
  }
}

function mapStatusBar(status) {
  if (!status || status.installed === false || status.overall === "missing") {
    return {
      text: "Kairo: not installed",
      tooltip: status?.nextAction ?? "Install @kal-elsam/kairo-runtime",
      overall: "missing"
    };
  }

  const overall = status.overall ?? "unknown";
  if (overall === "ok") {
    return {
      text: "Kairo: ready",
      tooltip: status.nextAction ?? "Everything looks good.",
      overall
    };
  }

  if (overall === "drift" || overall === "action_required" || overall === "warning") {
    return {
      text: "Kairo: needs attention",
      tooltip: status.nextAction ?? "Open Kairo to see what needs fixing.",
      overall
    };
  }

  return {
    text: "Kairo: check status",
    tooltip: status.nextAction ?? `Status: ${overall}`,
    overall
  };
}

function buildTreeModel(status) {
  if (!status || status.installed === false || status.overall === "missing") {
    return { nextAction: status?.nextAction ?? INSTALL_HINT, groups: [] };
  }

  const byCategory = new Map();
  for (const check of status.checks ?? []) {
    const checkStatus = typeof check.status === "string" ? check.status : "unknown";
    if (checkStatus === "ok") continue;
    const category =
      typeof check.category === "string" && check.category ? check.category : "other";
    const list = byCategory.get(category) ?? [];
    list.push({
      name: typeof check.name === "string" ? check.name : "check",
      status: checkStatus,
      detail: typeof check.detail === "string" ? check.detail : ""
    });
    byCategory.set(category, list);
  }

  return {
    nextAction: status.nextAction ?? "Open the Cockpit to review your setup.",
    groups: [...byCategory.entries()].map(([category, items]) => ({ category, items }))
  };
}

module.exports = {
  DEFAULT_TTL_MS,
  DEFAULT_TIMEOUT_MS,
  StatusCache,
  buildTreeModel,
  fetchKairoStatus,
  mapStatusBar
};
