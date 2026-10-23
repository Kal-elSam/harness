import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyObsidianVaultStatus,
  loadObsidianVaultStatus,
  summarizeObsidianVaultStatus
} from "../src/global/observability/obsidian-status.js";
import { buildCompanionSnapshot } from "../src/global/observability/build-companion-snapshot.js";
import { CONTROL_PLANE_HEALTH } from "../src/global/control-plane-snapshot.js";
import { KAIRO_VAULT_SUBDIR } from "../src/global/observability/obsidian-vault.js";

test("status: unconfigured without vaultPath; summarize fail-soft", async () => {
  const bare = await loadObsidianVaultStatus({});
  assert.equal(bare.state, "unconfigured");
  assert.equal(summarizeObsidianVaultStatus(null).state, "error");
  assert.equal(emptyObsidianVaultStatus().state, "error");
});

test("status: inspects Kairo/ notes", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-obs-status-"));
  try {
    await mkdir(join(root, KAIRO_VAULT_SUBDIR), { recursive: true });
    await writeFile(join(root, KAIRO_VAULT_SUBDIR, "a.md"), "# A\n", "utf8");
    const status = await loadObsidianVaultStatus({
      vaultPath: root,
      lastPublishAt: "2026-08-07T12:00:00.000Z",
      pendingProposals: 2
    });
    assert.equal(status.state, "available");
    assert.equal(status.noteCount, 1);
    assert.equal(status.pendingProposals, 2);
    assert.equal(status.lastPublishAt, "2026-08-07T12:00:00.000Z");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("companion: obsidian signal fail-soft", async () => {
  const snap = await buildCompanionSnapshot({
    controlPlaneHealth: CONTROL_PLANE_HEALTH.HEALTHY,
    buildObservability: async () => ({ probes: [] }),
    loadHermesActivity: async () => ({ state: "unavailable", sessions: [], aggregates: {} }),
    loadSystemResources: async () => ({ state: "unavailable" }),
    loadEcosystemUpdates: async () => ({ state: "available", tools: {}, diagnostics: [], cacheHit: true }),
    loadObsidianVaultStatus: async () => ({
      state: "available", noteCount: 3, pendingProposals: 0, lastPublishAt: null, diagnostics: []
    }),
    runs: [], reviews: [], alerts: []
  });
  assert.equal(snap.signals.obsidian.vault.noteCount, 3);

  const threw = await buildCompanionSnapshot({
    controlPlaneHealth: CONTROL_PLANE_HEALTH.HEALTHY,
    buildObservability: async () => ({ probes: [] }),
    loadEcosystemUpdates: async () => ({ state: "available", tools: {}, diagnostics: [] }),
    loadObsidianVaultStatus: async () => { throw new Error("boom"); },
    runs: [], reviews: [], alerts: []
  });
  assert.equal(threw.signals.obsidian.vault.state, "error");
});
