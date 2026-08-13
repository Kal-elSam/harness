"use strict";

const { spawn } = require("node:child_process");
const { DEFAULT_TTL_MS, DEFAULT_TIMEOUT_MS } = require("./status");

function emptyControlPlane(error) {
  return {
    schema: "kairo.control-plane/v1",
    ok: false,
    error: error ?? "unknown",
    work: null,
    workflow: {
      kind: "none",
      active: false,
      label: "No active workflow",
      phase: null,
      nextTransition: null,
      changeName: null,
      review: null
    },
    team: { platforms: [], activity: null, connections: [], fleetNote: null },
    attention: { items: [], primaryActions: [], secondaryActions: [] },
    sections: {
      work: { ok: false, error: error ?? "unknown" },
      workflow: { ok: false, error: error ?? "unknown" },
      team: { ok: false, error: error ?? "unknown" },
      attention: { ok: false, error: error ?? "unknown" }
    },
    diagnostics: [error ?? "unknown"]
  };
}

function fetchKairoControlPlane({
  command = "kairo",
  args = ["control-plane", "--json"],
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
      finish(emptyControlPlane("timeout"));
    }, timeoutMs);

    try {
      const spawnOpts = { env, stdio: ["ignore", "pipe", "pipe"], shell: false };
      if (typeof cwd === "string" && cwd) spawnOpts.cwd = cwd;
      child = spawnFn(command, args, spawnOpts);
    } catch (error) {
      finish(emptyControlPlane(error instanceof Error ? error.message : String(error)));
      return;
    }

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.on("error", (error) => finish(emptyControlPlane(error.message)));
    child.on("close", () => {
      const trimmed = stdout.trim();
      if (!trimmed) return finish(emptyControlPlane("empty"));
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== "object" || parsed.schema !== "kairo.control-plane/v1") {
          return finish(emptyControlPlane("invalid_schema"));
        }
        finish(parsed);
      } catch (error) {
        finish(emptyControlPlane(error instanceof Error ? error.message : String(error)));
      }
    });
  });
}

class ControlPlaneCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, fetch = fetchKairoControlPlane } = {}) {
    this.ttlMs = ttlMs;
    this.fetch = fetch;
    this._value = null;
    this._fetchedAt = 0;
    this._inflight = null;
  }

  async get({ force = false } = {}) {
    if (!force && this._value && Date.now() - this._fetchedAt < this.ttlMs) return this._value;
    if (this._inflight) return this._inflight;
    this._inflight = this.fetch()
      .then((value) => {
        this._value = value;
        this._fetchedAt = Date.now();
        return value;
      })
      .finally(() => { this._inflight = null; });
    return this._inflight;
  }

  invalidate() {
    this._value = null;
    this._fetchedAt = 0;
  }
}

/** Adapt control-plane team → legacy fleetReport shape for existing panel-fleet helpers. */
function fleetReportFromControlPlane(controlPlane) {
  if (!controlPlane?.team) {
    return { fleets: [], activity: null, fleetNote: null, orchestratorAuthority: null };
  }
  const team = controlPlane.team;
  return {
    fleets: (team.platforms ?? []).map((p) => ({
      platform: p.platform,
      opaque: p.honesty === "opaque",
      honesty: p.honesty,
      source: p.source,
      orchestrator: p.orchestrator
        ? {
            id: p.orchestrator.id,
            model: p.orchestrator.model,
            modelShort: p.orchestrator.model,
            opaque: p.orchestrator.honesty === "opaque",
            honesty: p.orchestrator.honesty,
            mode: p.orchestrator.role
          }
        : null,
      minions: (p.agents ?? []).map((a) => ({
        id: a.id,
        model: a.model,
        modelShort: a.model,
        role: a.role,
        opaque: a.honesty === "opaque",
        honesty: a.honesty
      }))
    })),
    activity: team.activity,
    fleetNote: team.fleetNote,
    orchestratorAuthority: team.orchestratorAuthority,
    connections: team.connections ?? []
  };
}

module.exports = {
  ControlPlaneCache,
  fetchKairoControlPlane,
  emptyControlPlane,
  fleetReportFromControlPlane
};
