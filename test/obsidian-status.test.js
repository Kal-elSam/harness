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
import { formatObsidianVaultLines } from "../src/global/ink/obsidian-vault-display.js";
import { LAYOUT_MODES } from "../src/global/ink/layout.js";
import { buildCompanionSnapshot } from "../src/global/observability/build-companion-snapshot.js";
import { CONTROL_PLANE_HEALTH } from "../src/global/control-plane-snapshot.js";
import { KAIRO_VAULT_SUBDIR } from "../src/global/observability/obsidian-vault.js";
import { buildControlCenterModel } from "../src/global/ink/cockpit-control-center.js";

test("status: unconfigured without vaultPath; summarize fail-soft", async () => {
  const bare = await loadObsidianVaultStatus({});
  assert.equal(bare.state, "unconfigured");
  assert.equal(summarizeObsidianVaultStatus(null).state, "error");
  assert.equal(emptyObsidianVaultStatus().state, "error");
});

test("status: inspects Kairo/ notes; display lines by layout", async () => {
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
    assert.match(formatObsidianVaultLines(status, LAYOUT_MODES.MINIMAL)[0], /1 notes/);
    assert.ok(formatObsidianVaultLines(status, LAYOUT_MODES.COMPACT).some((l) => /pending · 2/.test(l)));
    assert.ok(formatObsidianVaultLines(status, LAYOUT_MODES.WIDE).some((l) => /last publish/.test(l)));
    assert.ok(!JSON.stringify(formatObsidianVaultLines(status, LAYOUT_MODES.WIDE)).includes(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("companion + cockpit: obsidian signal fail-soft; no write affordances", async () => {
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

  const model = buildControlCenterModel({
    projectName: "p",
    snapshot: { health: CONTROL_PLANE_HEALTH.HEALTHY, coverage: {}, diff: {}, cta: null },
    companion: snap,
    layoutMode: LAYOUT_MODES.COMPACT
  });
  const blob = JSON.stringify(model);
  assert.match(blob, /Obsidian · 3 notes/);
  assert.ok(!/auto-sync on|Publish|Write|Sync now/i.test(blob));
});
