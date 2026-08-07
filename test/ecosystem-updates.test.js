import test from "node:test";
import assert from "node:assert/strict";
import {
  loadEcosystemUpdates,
  parseGentleUpdateOutput,
  parseHermesUpdateCheck
} from "../src/global/observability/ecosystem-updates.js";

test("parsers: gentle rows and hermes check states", () => {
  const rows = parseGentleUpdateOutput(`[ok] gentle-ai installed: 2.2.4 latest: 2.2.4\n[UP] x installed: 1.0.0 latest: 1.0.1`);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].updateAvailable, true);
  assert.equal(parseHermesUpdateCheck("Already up to date.", "", true).updateAvailable, false);
  assert.equal(parseHermesUpdateCheck("Update available: behind", "", true).updateAvailable, true);
  assert.equal(parseHermesUpdateCheck("", "fatal: lock", false).state, "error");
});

test("matrix: current / update / offline / timeout / malformed", async () => {
  const current = await loadEcosystemUpdates({
    installedVersion: "1.0.0", forceRefresh: true,
    fetchVersion: async () => "1.0.0",
    fetchJson: async () => ({ sha: "d2478bf0c73a6357df39a3ed6aff16acaa218843" }),
    probeCommand: () => ({ ok: false, stdout: "", stderr: "", timedOut: false }),
    pinnedSkillsRev: "d2478bf0c73a6357df39a3ed6aff16acaa218843"
  });
  assert.equal(current.tools.kairo.updateAvailable, false);
  assert.equal(current.tools.skills.updateAvailable, false);

  const newer = await loadEcosystemUpdates({
    installedVersion: "1.0.0", forceRefresh: true,
    fetchVersion: async () => "1.1.0",
    fetchJson: async () => ({ sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
    probeCommand: (cmd, args) => {
      if (String(cmd) === "which") {
        return { ok: true, stdout: args[0] === "hermes" ? "/usr/bin/hermes" : "/usr/bin/gentle-ai" };
      }
      if (args?.[1] === "--check") return { ok: true, stdout: "Update available", timedOut: false };
      if (args?.[0] === "update") return { ok: true, stdout: "[UP] gentle-ai installed: 2.2.4 latest: 2.3.0", timedOut: false };
      return { ok: false, stdout: "", stderr: "", timedOut: false };
    },
    pinnedSkillsRev: "d2478bf0c73a6357df39a3ed6aff16acaa218843"
  });
  assert.equal(newer.tools.kairo.updateAvailable, true);
  assert.equal(newer.tools.hermes.updateAvailable, true);
  assert.equal(newer.tools.gentle.updateAvailable, true);
  assert.equal(newer.tools.skills.updateAvailable, true);

  const offline = await loadEcosystemUpdates({
    installedVersion: "1.0.0", forceRefresh: true,
    fetchVersion: async () => { throw new Error("getaddrinfo ENOTFOUND registry.npmjs.org"); },
    fetchJson: async () => { throw new Error("network offline"); },
    probeCommand: () => ({ ok: false, stdout: "", stderr: "", timedOut: false })
  });
  assert.equal(offline.tools.kairo.error, "offline");

  const timed = await loadEcosystemUpdates({
    installedVersion: "1.0.0", forceRefresh: true, timeoutMs: 20,
    fetchVersion: async () => { await new Promise((r) => setTimeout(r, 50)); return "1.0.0"; },
    fetchJson: async () => { await new Promise((r) => setTimeout(r, 50)); return { sha: "abc" }; },
    probeCommand: () => ({ ok: false, stdout: "", stderr: "", timedOut: false })
  });
  assert.equal(timed.state, "error");
  assert.ok(timed.diagnostics.some((d) => /timeout/i.test(d)));

  const malformed = await loadEcosystemUpdates({
    installedVersion: "1.0.0", forceRefresh: true,
    fetchVersion: async () => "",
    fetchJson: async () => ({ sha: 123 }),
    probeCommand: (cmd, args) => {
      if (String(cmd) === "which" && args[0] === "gentle-ai") return { ok: true, stdout: "/usr/bin/gentle-ai" };
      if (args?.[0] === "update") return { ok: true, stdout: "not parseable", timedOut: false };
      return { ok: false, stdout: "", stderr: "", timedOut: false };
    }
  });
  assert.equal(malformed.tools.kairo.error, "malformed");
  assert.equal(malformed.tools.skills.error, "malformed");
  assert.equal(malformed.tools.gentle.state, "partial");
});

test("24h cache hit skips probes; check path has no apply flags", async () => {
  const calls = [];
  const first = await loadEcosystemUpdates({
    homeDir: "/tmp/kairo-eco-cache-test", installedVersion: "1.0.0",
    forceRefresh: true, nowMs: 1_000_000,
    fetchVersion: async () => { calls.push("fetch"); return "1.0.0"; },
    fetchJson: async () => ({ sha: "d2478bf0c73a6357df39a3ed6aff16acaa218843" }),
    probeCommand: (cmd, args) => { calls.push([cmd, ...args].join(" ")); return { ok: false, stdout: "", stderr: "", timedOut: false }; },
    readCacheFile: async () => null,
    writeCacheFile: async () => {}
  });
  const cached = await loadEcosystemUpdates({
    homeDir: "/tmp/kairo-eco-cache-test", installedVersion: "1.0.0",
    forceRefresh: false, nowMs: 1_000_000 + 60_000,
    fetchVersion: async () => { calls.push("fetch-again"); return "9.9.9"; },
    fetchJson: async () => ({ sha: "deadbeef" }),
    probeCommand: () => { calls.push("probe-again"); return { ok: false, stdout: "", stderr: "", timedOut: false }; },
    readCacheFile: async () => first,
    writeCacheFile: async () => {}
  });
  assert.equal(cached.cacheHit, true);
  assert.ok(!calls.includes("fetch-again"));
  assert.ok(!calls.some((c) => /\b(upgrade|--yes)\b/.test(String(c))));
});
