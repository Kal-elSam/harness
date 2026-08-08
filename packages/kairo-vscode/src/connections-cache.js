"use strict";

const { spawn } = require("node:child_process");
const { DEFAULT_TTL_MS, DEFAULT_TIMEOUT_MS } = require("./status");

function fetchKairoConnections({
  command = "kairo",
  args = ["connections", "--json"],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
  cwd = undefined,
  spawnFn = spawn
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let child = null;
    let stdout = "";

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      if (child && !child.killed) child.kill("SIGTERM");
      finish({ ok: false, connections: [], fleets: [], activity: null, error: "timeout" });
    }, timeoutMs);

    try {
      const spawnOpts = {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false
      };
      if (typeof cwd === "string" && cwd) spawnOpts.cwd = cwd;
      child = spawnFn(command, args, spawnOpts);
    } catch (error) {
      finish({
        ok: false,
        connections: [],
        fleets: [],
        activity: null,
        error: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });

    child.on("error", (error) => {
      finish({ ok: false, connections: [], fleets: [], activity: null, error: error.message });
    });

    child.on("close", () => {
      const trimmed = stdout.trim();
      if (!trimmed) {
        finish({ ok: false, connections: [], fleets: [], activity: null, error: "empty" });
        return;
      }
      try {
        const parsed = JSON.parse(trimmed);
        finish({
          ok: parsed.ok !== false,
          connections: Array.isArray(parsed.connections) ? parsed.connections : [],
          fleets: Array.isArray(parsed.fleets) ? parsed.fleets : [],
          activity: parsed.activity ?? null,
          fleetNote: parsed.fleetNote ?? parsed.note ?? null,
          orchestratorAuthority: parsed.orchestratorAuthority ?? null,
          generatedAt: parsed.generatedAt ?? null
        });
      } catch (error) {
        finish({
          ok: false,
          connections: [],
          fleets: [],
          activity: null,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  });
}

class ConnectionsCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, fetch = fetchKairoConnections } = {}) {
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

module.exports = {
  ConnectionsCache,
  fetchKairoConnections
};
