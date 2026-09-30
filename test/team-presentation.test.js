import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildKairoWorkspaceSnapshot, loadKairoWorkspaceSnapshot } from "../src/global/host/workspace-snapshot.js";
import { writeProjectStrategy } from "../src/global/conversation/project-strategy-store.js";
import { deriveTeamPresentation } from "../src/global/conversation/team-presentation.js";

const model = (adapterId, modelId) => ({ displayName: modelId, adapterId, modelId, accessMode: "automatic" });
const COMPLETE = {
  schema: "kairo.project-strategy/v1",
  status: "active",
  bootstrapAnalyst: model("claude", "claude-opus-5"),
  orchestrator: model("opencode-go", "kimi-k3"),
  projectTeam: [
    { role: "Builder", model: model("codex", "gpt-6-terra") },
    { role: "Reviewer", model: model("codex", "gpt-6-terra") }
  ]
};
const ALL_OK = {
  eligibility: { codex: { ok: true }, claude: { ok: true }, "opencode-go": { ok: true } },
  claudeEntitlement: {},
  cursorAccess: {}
};
const snap = (strategy, extra = {}) => buildKairoWorkspaceSnapshot({ projectRoot: "/work/p", strategy, ...extra });

test("complete = every role assigned + ACTIVE + validated against live availability", () => {
  const presentation = snap(COMPLETE, { intelligence: ALL_OK }).team.presentation;
  assert.deepEqual(presentation, { state: "complete", rolesVisible: true, reason: null });
});

test("a never-analyzed project is incomplete and hides roles", () => {
  const presentation = snap(null).team.presentation;
  assert.deepEqual(presentation, { state: "incomplete", rolesVisible: false, reason: "not_analyzed" });
});

test("suggested and stale teams are incomplete (not approved) even when every role is available", () => {
  for (const status of ["suggested", "stale"]) {
    const presentation = snap({ ...COMPLETE, status }, { intelligence: ALL_OK }).team.presentation;
    assert.deepEqual(presentation, { state: "incomplete", rolesVisible: false, reason: "not_approved" }, status);
  }
});

test("a role without a saved model makes the whole team incomplete (no partial team)", () => {
  const strategy = { ...COMPLETE, projectTeam: [COMPLETE.projectTeam[0], { role: "Reviewer", model: null }] };
  assert.deepEqual(snap(strategy, { intelligence: ALL_OK }).team.presentation,
    { state: "incomplete", rolesVisible: false, reason: "missing_assignment" });
  const noOrchestrator = { ...COMPLETE, orchestrator: null };
  assert.equal(snap(noOrchestrator, { intelligence: ALL_OK }).team.presentation.reason, "missing_assignment");
});

test("probe still pending is verifying, never blocked and never quota", () => {
  const presentation = snap(COMPLETE).team.presentation;
  assert.deepEqual(presentation, { state: "verifying", rolesVisible: false, reason: "availability_pending" });
});

test("last-known cache while the probe is pending is still verifying (not validated against current availability)", () => {
  const cache = { value: ALL_OK, savedAt: 1000 };
  const presentation = snap(COMPLETE, { availabilityCache: cache, now: 2000 }).team.presentation;
  assert.equal(presentation.state, "verifying");
  assert.equal(presentation.rolesVisible, false);
});

test("a failed probe is blocked with an unverified reason, even with a cache", () => {
  const cache = { value: ALL_OK, savedAt: 1000 };
  const failed = snap(COMPLETE, { intelligence: null }).team.presentation;
  assert.deepEqual(failed, { state: "blocked", rolesVisible: false, reason: "availability_unverified" });
  const cachedFailed = snap(COMPLETE, { intelligence: null, availabilityCache: cache, now: 2000 }).team.presentation;
  assert.deepEqual(cachedFailed, { state: "blocked", rolesVisible: false, reason: "availability_unverified" });
});

test("any blocked role hides the whole team", () => {
  const intelligence = { ...ALL_OK, eligibility: { ...ALL_OK.eligibility, codex: { ok: false, reason: "rate limited" } } };
  assert.deepEqual(snap(COMPLETE, { intelligence }).team.presentation,
    { state: "blocked", rolesVisible: false, reason: "availability_blocked" });
});

test("deriveTeamPresentation is tolerant of missing input", () => {
  assert.equal(deriveTeamPresentation(undefined, undefined).rolesVisible, false);
});

test("projection never mutates saved assignments: store is byte-identical after loading snapshots", async () => {
  const home = await mkdtemp(join(tmpdir(), "kairo-presentation-"));
  const root = "/work/p";
  await writeProjectStrategy(home, root, COMPLETE);
  const { harnessHomePaths } = await import("../src/global/paths.js");
  const { projectKeyForPath } = await import("../src/global/next/project-key.js");
  const file = join(harnessHomePaths(home).sessionsDir, projectKeyForPath(root), "project-strategy.json");
  const before = await readFile(file);
  const deps = { resolveProjectRoot: async () => root, resolveHomeDir: () => home, inspectEngramIntegration: () => ({ status: "ok" }),
    readCachedUsage: async () => null, writeCachedUsage: async () => {}, readCachedAvailability: async () => null, writeCachedAvailability: async () => {} };
  for (const intelligence of [undefined, null, { ...ALL_OK, eligibility: { codex: { ok: false } } }]) {
    const snapshot = await loadKairoWorkspaceSnapshot({ cwd: root, intelligence }, deps);
    assert.equal(snapshot.team.presentation.rolesVisible, false);
    assert.equal(snapshot.team.assignments.length, 2, "assignments still projected for other consumers");
  }
  const after = await readFile(file);
  assert.ok(before.equals(after));
});
