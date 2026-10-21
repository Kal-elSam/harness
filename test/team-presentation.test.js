import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveTeamPresentation } from "../src/global/conversation/team-presentation.js";

const model = (adapterId, modelId) => ({ displayName: modelId, adapterId, modelId, accessMode: "automatic" });
const COMPLETE = {
  schema: "kairo.project-strategy/v1",
  status: "active",
  bootstrapAnalyst: model("claude", "claude-opus-5"),
  orchestrator: model("opencode-go", "kimi-k3"),
  projectTeam: [
    { role: "Builder", model: model("codex", "gpt-6-terra"), assignmentState: "ready" },
    { role: "Reviewer", model: model("codex", "gpt-6-terra"), assignmentState: "ready" }
  ]
};
const SUGGESTED = { ...COMPLETE, status: "suggested" };
const ALL_OK = {
  eligibility: { codex: { ok: true }, claude: { ok: true }, "opencode-go": { ok: true } },
  claudeEntitlement: {},
  cursorAccess: {}
};
const snap = (strategy, extra = {}) => {
  const intelligence = extra.intelligence;
  const probe = intelligence === undefined ? "pending" : intelligence === null ? "failed" : "live";
  const rows = (strategy?.projectTeam ?? []).map(({ model }) => ({
    availability: { state: intelligence?.eligibility?.[model?.adapterId]?.ok === true ? "available" : "blocked" }
  }));
  return { team: { presentation: deriveTeamPresentation(strategy, { rows, probe }) } };
};

test("complete = every role assigned + ACTIVE + validated against live availability", () => {
  const presentation = snap(COMPLETE, { intelligence: ALL_OK }).team.presentation;
  assert.deepEqual(presentation, { state: "complete", rolesVisible: true, reason: null });
});

test("a never-analyzed project is incomplete and hides roles", () => {
  const presentation = snap(null).team.presentation;
  assert.deepEqual(presentation, { state: "incomplete", rolesVisible: false, reason: "not_analyzed" });
});

test("T28: suggested draft with every assignment usable is ready_to_approve and shows roles", () => {
  const presentation = snap(SUGGESTED, { intelligence: ALL_OK }).team.presentation;
  assert.deepEqual(presentation, { state: "ready_to_approve", rolesVisible: true, reason: null });
});

test("T28: suggested draft while availability is pending is pending_approval (reviewable, not hidden)", () => {
  const presentation = snap(SUGGESTED).team.presentation;
  assert.deepEqual(presentation, { state: "pending_approval", rolesVisible: true, reason: "availability_pending" });
});

test("stale teams are incomplete (not approved) even when every role is available", () => {
  const presentation = snap({ ...COMPLETE, status: "stale" }, { intelligence: ALL_OK }).team.presentation;
  assert.deepEqual(presentation, { state: "incomplete", rolesVisible: false, reason: "not_approved" });
});

test("a role without a saved model makes the whole team incomplete (no partial team)", () => {
  const strategy = { ...COMPLETE, projectTeam: [COMPLETE.projectTeam[0], { role: "Reviewer", model: null }] };
  assert.deepEqual(snap(strategy, { intelligence: ALL_OK }).team.presentation,
    { state: "incomplete", rolesVisible: false, reason: "missing_assignment" });
  const noOrchestrator = { ...COMPLETE, orchestrator: null };
  assert.equal(snap(noOrchestrator, { intelligence: ALL_OK }).team.presentation.reason, "missing_assignment");
});

test("ACTIVE probe still pending is verifying, never blocked and never quota", () => {
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

test("any blocked role on an ACTIVE team hides the whole team", () => {
  const intelligence = { ...ALL_OK, eligibility: { ...ALL_OK.eligibility, codex: { ok: false, reason: "rate limited" } } };
  assert.deepEqual(snap(COMPLETE, { intelligence }).team.presentation,
    { state: "blocked", rolesVisible: false, reason: "availability_blocked" });
});

test("T28: suggested draft with a blocked operational assignment stays reviewable (rolesVisible)", () => {
  const strategy = {
    ...SUGGESTED,
    projectTeam: [
      { role: "Builder", model: model("codex", "gpt-6-terra"), assignmentState: "blocked" },
      COMPLETE.projectTeam[1]
    ]
  };
  const presentation = snap(strategy, { intelligence: ALL_OK }).team.presentation;
  assert.equal(presentation.state, "blocked");
  assert.equal(presentation.rolesVisible, true);
  assert.equal(presentation.reason, "assignment_blocked");
});

test("deriveTeamPresentation is tolerant of missing input", () => {
  assert.equal(deriveTeamPresentation(undefined, undefined).rolesVisible, false);
});

