import test from "node:test";
import assert from "node:assert/strict";
import {
  checkCandidate, classifyEffort, classifyTask, isLikelyQuestion, matchSkills, selectAskProvider, selectExecutionProvider
} from "../src/global/intelligence/execution-router.js";

const CLAUDE_CATALOG = {
  claude: {
    models: [
      { id: "claude-opus-5", isDefault: false },
      { id: "claude-sonnet-5", isDefault: true },
      { id: "claude-haiku-4-5", isDefault: false }
    ]
  }
};

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
  assert.equal(result.rejectedCandidates[0].reason, "Codex usage window is limited (2% left)");
});

test("REGRESSION: a provider whose secondary (weekly) window is nearly exhausted is excluded, even when its primary (5h) window looks healthy", () => {
  const result = checkCandidate("codex", {
    adapters: ADAPTERS,
    codexUsage: { primary: { remainingPercent: 97 }, secondary: { remainingPercent: 2 } }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "Codex usage window is limited (2% left)");
});

test("REGRESSION: ASK order prefers the provider whose WORST window (5h or weekly) has more headroom, not just its primary window", () => {
  const result = selectAskProvider({
    adapters: ADAPTERS,
    // Codex's 5h looks great but its weekly is nearly gone; Claude's 5h
    // is worse but its weekly has real headroom — Claude should go
    // first since its worst window still beats Codex's worst window.
    codexUsage: { primary: { remainingPercent: 97 }, secondary: { remainingPercent: 9 } },
    claudeUsage: { primary: { remainingPercent: 66 }, secondary: { remainingPercent: 21 } },
    catalogs: CLAUDE_CATALOG,
    taskText: "donde estamos parados?"
  });
  assert.equal(result.decision, "ROUTED");
  assert.equal(result.provider, "claude");
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

test("classifyEffort: short and simple is light, reasoning/risk keywords always win regardless of length, otherwise standard", () => {
  assert.equal(classifyEffort("what does this project do?"), "light");
  assert.equal(classifyEffort("why?"), "light");
  assert.equal(classifyEffort("why does auth break under load?"), "heavy");
  assert.equal(classifyEffort("is it safe to store a payment credential here?"), "heavy");
  const longButSimple = "explain, in plain terms, roughly what this whole codebase is trying to accomplish for a new teammate joining today";
  assert.ok(longButSimple.length > 100);
  assert.equal(classifyEffort(longButSimple), "standard");
});

test("classifyEffort: a mechanical multi-file task (rename/boilerplate spanning many files) is NOT heavy — spread isn't complexity", () => {
  // Real repro of the reported bug: multi-file signal alone used to force "heavy"
  // even for a purely mechanical rename, which real-world capability doesn't need.
  assert.equal(classifyEffort("Rename this DTO field across 15 files"), "light");
  // But real integration/architecture scope, not dominated by repetition, stays heavy.
  assert.equal(classifyEffort("Integrate the new billing API across the backend and frontend"), "heavy");
  assert.equal(classifyEffort("Wire up SSO across web and mobile"), "heavy");
});

test("selectAskProvider picks Haiku for a simple question and Opus for a reasoning-heavy one, from the real catalog — never a fabricated model id", () => {
  const simple = selectAskProvider({ adapters: ADAPTERS, catalogs: CLAUDE_CATALOG, taskText: "what is this project about?" });
  assert.equal(simple.provider, "claude");
  assert.equal(simple.model, "claude-haiku-4-5");
  assert.match(simple.why, /light effort/);

  const heavy = selectAskProvider({ adapters: ADAPTERS, catalogs: CLAUDE_CATALOG, taskText: "why does auth break under a race condition?" });
  assert.equal(heavy.model, "claude-opus-5");
  assert.match(heavy.why, /heavy effort/);
});

test("selectAskProvider falls back to the provider's default model when the catalog has no model for that effort tier", () => {
  const noHaiku = selectAskProvider({
    adapters: ADAPTERS,
    catalogs: { claude: { models: [{ id: "claude-opus-5", isDefault: true }] } },
    taskText: "what is this?"
  });
  assert.equal(noHaiku.model, "claude-opus-5");
});

test("selectAskProvider never picks a tiered model for a provider with no cost/size signal in its real catalog (e.g. codex)", () => {
  const result = selectAskProvider({
    adapters: ADAPTERS.map((a) => (a.id === "claude" ? { ...a, available: false, reason: "not logged in" } : a)),
    catalogs: { codex: { models: [{ id: "gpt-6-astra", isDefault: true }] } },
    taskText: "what is this project about?"
  });
  assert.equal(result.provider, "codex");
  assert.equal(result.model, "gpt-6-astra");
});

test("selectAskProvider picks whichever provider has more real remaining quota, when both are known", () => {
  const codexAhead = selectAskProvider({
    adapters: ADAPTERS,
    codexUsage: { primary: { remainingPercent: 90 } },
    claudeUsage: { primary: { remainingPercent: 20 } },
    catalogs: { codex: { models: [{ id: "gpt-6-astra", isDefault: true }] } }
  });
  assert.equal(codexAhead.provider, "codex");
  assert.match(codexAhead.why, /more real quota remaining/);

  const claudeAhead = selectAskProvider({
    adapters: ADAPTERS,
    codexUsage: { primary: { remainingPercent: 10 } },
    claudeUsage: { primary: { remainingPercent: 80 } },
    catalogs: CLAUDE_CATALOG
  });
  assert.equal(claudeAhead.provider, "claude");
  assert.match(claudeAhead.why, /more real quota remaining/);
});

test("selectAskProvider keeps the claude-first default when either side's quota is unknown, instead of guessing", () => {
  const oneUnknown = selectAskProvider({
    adapters: ADAPTERS,
    codexUsage: { primary: { remainingPercent: 90 } },
    claudeUsage: null,
    catalogs: CLAUDE_CATALOG
  });
  assert.equal(oneUnknown.provider, "claude");
  assert.doesNotMatch(oneUnknown.why, /more real quota remaining/);
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

test("checkCandidate always excludes opencode-zen from real task routing (PAYG risk), regardless of adapter status", () => {
  const zen = checkCandidate("opencode-zen", { adapters: [{ id: "opencode", available: true, launchable: true }] });
  assert.equal(zen.ok, false);
  assert.match(zen.reason, /PAYG/);
});

test("checkCandidate treats cursor as a real automatic candidate for real task routing (requireLaunchable: true, the default) — Cursor's own execution adapter builds a real, auditable non-interactive launch", () => {
  const cursor = checkCandidate("cursor", { adapters: [{ id: "cursor", available: true, launchable: true }] });
  assert.equal(cursor.ok, true, "a genuinely available and launchable Cursor candidate must be real task-routable, exactly like Codex/Claude — real per-model quota is judged separately (see cursor-entitlement.js), never here");
});

test("checkCandidate rejects cursor for real task routing when it genuinely isn't launchable yet — same launchable gate as codex/claude, no special case", () => {
  const cursor = checkCandidate("cursor", { adapters: [{ id: "cursor", available: true, launchable: false, reason: "Cursor agent CLI busy" }] });
  assert.equal(cursor.ok, false);
  assert.match(cursor.reason, /Cursor agent CLI busy/);
});

test("checkCandidate rejects opencode-go when any real window is rate-limited, even with other windows healthy", () => {
  const adapters = [{ id: "opencode", available: true, launchable: true, reason: null }];
  const limited = checkCandidate("opencode-go", {
    adapters,
    opencodeGoUsage: { windows: [
      { name: "rolling", remainingPercent: 100, status: "ok" },
      { name: "monthly", remainingPercent: 0, status: "rate-limited" }
    ] }
  });
  assert.equal(limited.ok, false);
  assert.match(limited.reason, /rate-limited/);

  const healthy = checkCandidate("opencode-go", {
    adapters,
    opencodeGoUsage: { windows: [{ name: "rolling", remainingPercent: 80, status: "ok" }] }
  });
  assert.equal(healthy.ok, true);
});

test("checkCandidate still applies the real codex/claude quota floor unchanged", () => {
  const adapters = [{ id: "codex", available: true, launchable: true, reason: null }];
  const low = checkCandidate("codex", { adapters, codexUsage: { primary: { remainingPercent: 2 } } });
  assert.equal(low.ok, false);
  assert.match(low.reason, /window is limited/);
  assert.doesNotMatch(low.reason, /exhaust/i);
});

test("REGRESSION: checkCandidate treats opencode-go as a real automatic candidate — same launchable gate for both recommendation and real task routing now, no more leniency", () => {
  const adapters = [{ id: "opencode", available: true, launchable: true, reason: null }];
  const strict = checkCandidate("opencode-go", { adapters });
  assert.equal(strict.ok, true, "a genuinely available and launchable Go candidate must be real task-routable too");

  const notLaunchable = [{ id: "opencode", available: true, launchable: false, reason: "opencode not launchable yet" }];
  const forRecommendation = checkCandidate("opencode-go", { adapters: notLaunchable }, { requireLaunchable: false });
  assert.equal(forRecommendation.ok, false, "opencode-go no longer gets a pass on launchability just because this is the recommendation surface");
});

test("checkCandidate({requireLaunchable: false}) never loosens codex/claude/zen — there are no exceptions left", () => {
  const adapters = [{ id: "codex", available: true, launchable: false, reason: "codex not launchable" }];
  const codex = checkCandidate("codex", { adapters }, { requireLaunchable: false });
  assert.equal(codex.ok, false);
  const zen = checkCandidate("opencode-zen", { adapters }, { requireLaunchable: false });
  assert.equal(zen.ok, false);
});

test("checkCandidate({requireLaunchable: false}) judges cursor exactly the same way as real task routing now — no more special recommendation-only leniency", () => {
  const adapters = [{ id: "cursor", available: true, launchable: false, reason: "not launchable yet" }];
  const forRecommendation = checkCandidate("cursor", { adapters }, { requireLaunchable: false });
  assert.equal(forRecommendation.ok, false, "cursor no longer gets a pass on launchability just because this is the recommendation surface — it's a real automatic candidate now, judged like codex/claude");
});

test("checkCandidate({requireLaunchable: false}) still requires cursor to be genuinely available — unavailable is never silently recommended", () => {
  const adapters = [{ id: "cursor", available: false, launchable: false, reason: "Cursor agent CLI \"cursor-agent\" is not on PATH. Install Cursor CLI." }];
  const result = checkCandidate("cursor", { adapters }, { requireLaunchable: false });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not on PATH/);
});

test("REGRESSION: checkCandidate no longer gates Cursor on any manual quota flag — real per-model quota moved to cursor-entitlement.js/resolveProjectRoute's per-model entitlement check", () => {
  const adapters = [{ id: "cursor", available: true, launchable: true, reason: null }];
  const result = checkCandidate("cursor", { adapters }, { requireLaunchable: false });
  assert.equal(result.ok, true, "adapter-level availability/launchability only — identical treatment to codex/claude/opencode-go now");
});

test("selectExecutionProvider sizes the model to the task's real effort too — a trivial fix doesn't get Claude's biggest model", () => {
  const trivial = selectExecutionProvider({
    task: "Fix the button color", adapters: ADAPTERS, catalogs: CLAUDE_CATALOG
  });
  assert.equal(trivial.provider, "claude");
  assert.equal(trivial.model, "claude-haiku-4-5");
  assert.match(trivial.why, /light effort/);

  const complex = selectExecutionProvider({
    task: "Investigate why sessions are duplicated under concurrent payment requests",
    adapters: ADAPTERS, catalogs: CLAUDE_CATALOG
  });
  // "payment" is a risk keyword combined with reasoning scope, so this actually needs approval —
  // proves risk gating still fires before model-effort sizing ever runs.
  assert.equal(complex.decision, "WAIT_FOR_APPROVAL");

  const genuinelyComplex = selectExecutionProvider({
    task: "Wire up the new pagination component across the table views, it's a fairly involved integration",
    adapters: ADAPTERS, catalogs: CLAUDE_CATALOG
  });
  assert.equal(genuinelyComplex.provider, "claude");
  assert.equal(genuinelyComplex.model, "claude-opus-5");
  assert.match(genuinelyComplex.why, /heavy effort/);
});

test("selectExecutionProvider picks OpenCode Go's real cheapest/median model by real cost, for light/standard effort", () => {
  const opencodeGoCatalog = {
    opencodeGo: {
      status: "measured",
      models: [
        { id: "deepseek-v4-flash", costInputPerMTok: 0.15 },
        { id: "deepseek-v4-pro", costInputPerMTok: 0.66 },
        { id: "glm-5.3", costInputPerMTok: 1.2 }
      ]
    }
  };
  const adapters = ADAPTERS.map((a) => (a.id === "opencode" ? { ...a, launchable: true, reason: null } : a));

  const light = selectExecutionProvider({ task: "Fix the typo in the readme", adapters, catalogs: opencodeGoCatalog });
  assert.equal(light.provider, "opencode-go");
  assert.equal(light.model, "deepseek-v4-flash"); // cheapest real option

  // Purely repetitive keywords, long enough to clear the "light" length
  // threshold, with no reasoning/risk/multi-file keyword — stays "standard".
  const standard = selectExecutionProvider({
    task: "Rename this old variable and fix the leftover typo, then update the changelog and the readme boilerplate stub",
    adapters, catalogs: opencodeGoCatalog
  });
  assert.equal(standard.provider, "opencode-go");
  assert.equal(standard.model, "deepseek-v4-pro"); // real median-cost option
});

test("REGRESSION: Spanish authentication, billing, and recovery-credential terms raise the risk signal", () => {
  assert.deepEqual(classifyTask("¿Por qué falla la autenticación cuando hay mucha carga?").risk, ["autentica"]);
  assert.deepEqual(classifyTask("Integra la nueva API de facturación en el backend y el frontend").risk, ["facturacion"]);
  assert.deepEqual(
    classifyTask("Elige dónde guardar el código de recuperación del usuario en la tabla de perfil").risk,
    ["codigo de recuperacion"]
  );
  assert.deepEqual(classifyTask("Procesa los pagos pendientes y revisa el cobro").risk, ["pago", "cobro"]);
  assert.deepEqual(classifyTask("Cambia la contraseña y las credenciales del admin").risk, ["contrasena", "credencial"]);
  assert.deepEqual(classifyTask("Revisa la autorización del endpoint").risk, ["autorizacion"]);
  assert.equal(classifyEffort("¿Por qué falla la autenticación cuando hay mucha carga?"), "heavy");
  assert.equal(classifyEffort("Guarda el código de recuperación"), "heavy");
});

test("Spanish risk terms match with or without accents", () => {
  for (const [accented, plain] of [
    ["autenticación", "autenticacion"],
    ["facturación", "facturacion"],
    ["contraseña", "contrasena"],
    ["código de recuperación", "codigo de recuperacion"],
  ]) {
    assert.deepEqual(classifyTask(`Revisa ${plain}`).risk, classifyTask(`Revisa ${accented}`).risk, plain);
    assert.equal(classifyTask(`Revisa ${plain}`).riskScore, 1, plain);
  }
});

test("Spanish risk terms only match at a word start — innocuous phrases stay risk-free", () => {
  for (const text of [
    "Se apagó el contenedor de pruebas",
    "Apago el servidor local",
    "Agrega paginación a la tabla",
    "Actualiza la página de inicio",
    "Sube la cobertura de tests",
    "Cambia el autor del commit",
  ]) {
    assert.deepEqual(classifyTask(text).risk, [], text);
  }
});

test("a Spanish risk + reasoning task needs approval exactly like its English twin", () => {
  const english = selectExecutionProvider({ task: "Refactor the authentication flow", adapters: ADAPTERS });
  const spanish = selectExecutionProvider({ task: "Refactoriza el flujo de autenticación", adapters: ADAPTERS });
  assert.equal(english.decision, "WAIT_FOR_APPROVAL");
  assert.equal(spanish.decision, "WAIT_FOR_APPROVAL");
  assert.match(spanish.why, /autentica/);
});

test("English risk matching is unchanged by the Spanish list", () => {
  assert.deepEqual(classifyTask("Migrate the production authentication database schema").risk, ["production", "auth", "authentication"]);
  assert.deepEqual(classifyTask("Refactor the authentication flow").risk, ["auth", "authentication"]);
  assert.deepEqual(classifyTask("Store the secret in the vault").risk, ["secret"]);
});

test("mixed English and Spanish risk terms keep their order of appearance, even after emoji", () => {
  assert.deepEqual(classifyTask("🔒🔒 revisa el pago 🔒 before production").risk, ["pago", "production"]);
  // Each astral character is two UTF-16 units; folding must not shift the
  // Spanish index ahead of an earlier English match.
  assert.deepEqual(classifyTask(`${"🔒".repeat(12)} production pago`).risk, ["production", "pago"]);
});

test("REGRESSION: English recovery codes raise the risk signal (the Jev pilot's only measured under-provision)", () => {
  const task = "Choose where to store the user's recovery code in the profile table, then update the form to use it while keeping other fields unchanged.";
  assert.deepEqual(classifyTask(task).risk, ["recovery code"]);
  assert.equal(classifyEffort(task), "heavy");
  assert.deepEqual(classifyTask("Rotate the recovery codes for all users").risk, ["recovery code"]);
  assert.equal(classifyEffort("Rotate the recovery codes for all users"), "heavy");
});

test("known false positive, accepted: error-recovery logic also matches 'recovery code'", () => {
  // Lexical matching cannot tell a 2FA recovery code from error-recovery
  // logic. Accepted on purpose: this over-provisions and may ask for
  // approval, which is cheap. Missing a credential under-provisions it and
  // auto-routes it, which is the expensive error.
  const result = selectExecutionProvider({ task: "Refactor the error recovery code in the parser", adapters: ADAPTERS });
  assert.deepEqual(result.profile.risk, ["recovery code"]);
  assert.equal(result.decision, "WAIT_FOR_APPROVAL");
});

test("REGRESSION: a window-limited Codex/Claude is reported as a temporary window limit, never as exhausted tokens", () => {
  const codex = checkCandidate("codex", {
    adapters: ADAPTERS,
    codexUsage: {
      primary: { name: "5h", remainingPercent: 60, resetsAtIso: "2026-09-24T02:00:00.000Z" },
      secondary: { name: "weekly", remainingPercent: 2, resetsAtIso: "2026-09-30T00:00:00.000Z" }
    }
  });
  assert.equal(codex.ok, false);
  assert.equal(codex.reason, "Codex weekly window is limited (2% left, resets 2026-09-30T00:00:00.000Z)");
  assert.deepEqual(codex.limit, { provider: "codex", window: "weekly", remainingPercent: 2, resetsAt: "2026-09-30T00:00:00.000Z" });

  const claude = checkCandidate("claude", {
    adapters: ADAPTERS,
    claudeUsage: { primary: { label: "Current session", remainingPercent: 1, resetsAt: "Sep 13 at 7:59am" } }
  });
  assert.equal(claude.reason, "Claude Current session window is limited (1% left, resets Sep 13 at 7:59am)");
  assert.deepEqual(claude.limit, { provider: "claude", window: "Current session", remainingPercent: 1, resetsAt: "Sep 13 at 7:59am" });

  for (const result of [codex, claude]) assert.doesNotMatch(result.reason, /exhaust/i);
});

test("an OpenCode Go rate limit carries the same structured window limit", () => {
  const result = checkCandidate("opencode-go", {
    adapters: [{ id: "opencode", available: true, launchable: true, reason: null }],
    opencodeGoUsage: { windows: [
      { name: "rolling", remainingPercent: 100, status: "ok" },
      { name: "monthly", remainingPercent: 0, status: "rate-limited", resetsAt: "2026-10-01T00:00:00Z" }
    ] }
  });
  assert.equal(result.reason, "OpenCode Go monthly window is rate-limited (resets 2026-10-01T00:00:00Z)");
  assert.deepEqual(result.limit, { provider: "opencode-go", window: "monthly", remainingPercent: 0, resetsAt: "2026-10-01T00:00:00Z" });
});

test("non-window ineligibility carries no window limit", () => {
  const zen = checkCandidate("opencode-zen", { adapters: [{ id: "opencode", available: true, launchable: true }] });
  assert.equal(zen.limit, undefined);
  const healthy = checkCandidate("codex", { adapters: ADAPTERS, codexUsage: { primary: { name: "5h", remainingPercent: 80 } } });
  assert.deepEqual(healthy, { ok: true, reason: null });
});
