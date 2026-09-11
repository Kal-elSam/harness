import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyTask, isLikelyQuestion, matchSkills, selectAskProvider, selectExecutionProvider
} from "../src/global/intelligence/execution-router.js";

const SKILLS = [
  { name: "go-testing", description: "Apply focused Go testing patterns for teatest and golden files." },
  { name: "branch-pr", description: "Create Gentle AI pull requests with issue-first checks." }
];

const ADAPTERS = [
  { id: "codex", available: true, launchable: true, reason: null },
  { id: "claude", available: true, launchable: true, reason: null },
  { id: "opencode", available: true, launchable: false, reason: "OpenCode can be launched but does not emit auditable structured events in v1." },
  { id: "cursor", available: true, launchable: true, reason: null }
];

test("classifyTask surfaces the exact keywords matched — not a score with no explanation", () => {
  const profile = classifyTask("Rename this variable and fix a typo in the boilerplate comment");
  assert.deepEqual(profile.repetitive, ["rename", "typo", "boilerplate", "comment"]);
  assert.equal(profile.reasoningScore, 0);
});

test("routes a repetitive task to opencode-go first, falls back to claude when opencode is not launchable", () => {
  const result = selectExecutionProvider({ task: "Rename this variable and fix the typo in the fixture file", adapters: ADAPTERS });
  assert.equal(result.decision, "ROUTED");
  assert.equal(result.provider, "claude");
  assert.equal(result.rejectedCandidates.length, 1);
  assert.equal(result.rejectedCandidates[0].adapterId, "opencode-go");
});

test("routes a repetitive task to opencode-go when it IS launchable", () => {
  const adapters = ADAPTERS.map((a) => (a.id === "opencode" ? { ...a, launchable: true, reason: null } : a));
  const result = selectExecutionProvider({
    task: "Fix the typo in the readme",
    adapters,
    catalogs: { opencodeGo: { status: "measured", models: [{ id: "glm-5.3", isDefault: true }] } }
  });
  assert.equal(result.provider, "opencode-go");
  assert.equal(result.model, "glm-5.3");
});

test("routes an architecture/reasoning task to codex", () => {
  const result = selectExecutionProvider({
    task: "Investigate the root cause of this performance regression",
    adapters: ADAPTERS,
    catalogs: { codex: { status: "measured", models: [{ id: "gpt-6-astra", isDefault: true }, { id: "gpt-5.5", isDefault: false }] } }
  });
  assert.equal(result.decision, "ROUTED");
  assert.equal(result.provider, "codex");
  assert.equal(result.model, "gpt-6-astra");
  assert.match(result.why, /root cause/);
});

test("routes a multi-file integration task to claude", () => {
  const result = selectExecutionProvider({ task: "Integrate the new billing API across the backend and frontend", adapters: ADAPTERS });
  // "billing" is a risk keyword, so this should actually require approval — verifies risk gating fires even for multi-file tasks.
  assert.equal(result.decision, "WAIT_FOR_APPROVAL");
});

test("a genuinely low-risk multi-file task routes to claude without needing approval", () => {
  const result = selectExecutionProvider({ task: "Wire up the new pagination component across the table views", adapters: ADAPTERS });
  assert.equal(result.decision, "ROUTED");
  assert.equal(result.provider, "claude");
});

test("high risk combined with reasoning or multi-file scope requires human approval instead of auto-routing", () => {
  const result = selectExecutionProvider({ task: "Migrate the production authentication database schema", adapters: ADAPTERS });
  assert.equal(result.decision, "WAIT_FOR_APPROVAL");
  assert.equal(result.provider, null);
  assert.match(result.why, /production/);
});

test("never returns a provider that failed its own availability check", () => {
  const allUnavailable = ADAPTERS.map((a) => ({ ...a, available: false, reason: "not authenticated" }));
  const result = selectExecutionProvider({ task: "Rename this variable", adapters: allUnavailable });
  assert.equal(result.decision, "NO_PROVIDER_AVAILABLE");
  assert.equal(result.provider, null);
  assert.match(result.why, /not authenticated/);
});

test("falls back away from a provider whose real quota is nearly exhausted", () => {
  const result = selectExecutionProvider({
    task: "Investigate this bug",
    adapters: ADAPTERS,
    codexUsage: { primary: { remainingPercent: 2 } },
    catalogs: { claude: { status: "measured", models: [{ id: "claude-opus-5", isDefault: true }] } }
  });
  assert.equal(result.provider, "claude");
  assert.equal(result.rejectedCandidates[0].reason, "Codex quota nearly exhausted (2% left)");
});

test("never invents a model id — returns null when the provider's real catalog has no default", () => {
  const result = selectExecutionProvider({ task: "Investigate this bug", adapters: ADAPTERS, catalogs: {} });
  assert.equal(result.provider, "codex");
  assert.equal(result.model, null);
});

test("isLikelyQuestion recognizes real questions but never a request with an action verb, even one that also asks something", () => {
  assert.equal(isLikelyQuestion("¿De qué va este proyecto?"), true);
  assert.equal(isLikelyQuestion("What is this project about?"), true);
  assert.equal(isLikelyQuestion("How does authentication work here?"), true);
  assert.equal(isLikelyQuestion("Implementa paginación en usuarios"), false);
  assert.equal(isLikelyQuestion("Investigate the root cause of this race condition"), false);
  assert.equal(isLikelyQuestion("Explain this, then fix the login bug"), false); // action verb wins
  assert.equal(isLikelyQuestion(""), false);
  assert.equal(isLikelyQuestion("   "), false);
});

test("selectAskProvider never gates on risk keywords — a question about a risky topic is still safe to answer", () => {
  const result = selectAskProvider({ adapters: ADAPTERS });
  assert.equal(result.decision, "ROUTED");
  assert.equal(result.provider, "claude");
});

test("selectAskProvider falls back to codex when claude is unavailable, and reports no provider when both are", () => {
  const claudeDown = ADAPTERS.map((a) => (a.id === "claude" ? { ...a, available: false, reason: "not logged in" } : a));
  const fallback = selectAskProvider({ adapters: claudeDown, catalogs: { codex: { models: [{ id: "gpt-6-astra", isDefault: true }] } } });
  assert.equal(fallback.provider, "codex");
  assert.equal(fallback.model, "gpt-6-astra");

  const allDown = ADAPTERS.map((a) => ({ ...a, available: false, reason: "not logged in" }));
  const none = selectAskProvider({ adapters: allDown });
  assert.equal(none.decision, "NO_PROVIDER_AVAILABLE");
});

test("matchSkills surfaces real overlap between the task text and a skill's real description — never a guessed relevance", () => {
  const matches = matchSkills("Write Go tests for the new golden file cases", SKILLS);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, "go-testing");
  assert.ok(matches[0].overlap.includes("golden"));
});

test("matchSkills returns nothing when no skill description overlaps the task", () => {
  assert.deepEqual(matchSkills("Update the marketing landing page copy", SKILLS), []);
});

test("selectExecutionProvider surfaces the best-matching skill in why, without letting it override real availability/quota routing", () => {
  const result = selectExecutionProvider({
    task: "Write Go tests for the golden file cases", adapters: ADAPTERS, skills: SKILLS
  });
  assert.equal(result.decision, "ROUTED");
  assert.equal(result.matchedSkills[0].name, "go-testing");
  assert.match(result.why, /matches skill "go-testing"/);
});
