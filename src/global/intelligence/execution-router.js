// Task -> provider/model routing. Deliberately NOT a black box: every
// decision is traceable to the exact keywords that matched and the exact
// real availability/quota data that ruled a candidate in or out. This is a
// heuristic keyword classifier, not a learned model — do not oversell it as
// "AI routing" in any UI copy that surfaces its output.
//
// Distinct from `intelligence/router.js`, which selects among model
// *backends* (Ollama/Zen/OpenRouter) for a different purpose — this module
// selects among Kairo's execution adapters (codex/claude/opencode-go/
// opencode-zen/cursor) for running an approved task.

const REPETITIVE_KEYWORDS = [
  "rename", "boilerplate", "mock", "fixture", "typo", "lint", "format",
  "docstring", "comment", "changelog", "readme", "scaffold", "stub"
];
const REASONING_KEYWORDS = [
  "architecture", "design", "investigate", "root cause", "race condition",
  "refactor", "security", "performance", "algorithm", "diagnose", "why does",
  "tradeoff", "evaluate"
];
const MULTI_FILE_KEYWORDS = [
  "integrate", "multi-file", "across", "backend and frontend", "full feature",
  "migrate", "end to end", "end-to-end", "wire up", "plumb"
];
const QUESTION_WORDS = [
  "qué", "que", "cómo", "como", "cuál", "cual", "cuáles", "por qué", "porque",
  "quién", "quien", "dónde", "donde", "cuándo", "cuando",
  "what", "how", "why", "which", "who", "where", "when",
  "is ", "are ", "does ", "do ", "can ", "could ", "should ", "explain", "explica", "describe"
];
const ACTION_VERBS = [
  "implementa", "implement", "agrega", "add", "crea", "create", "arregla", "fix",
  "refactoriza", "refactor", "migra", "migrate", "actualiza", "update", "elimina", "remove",
  "borra", "delete", "cambia", "change", "escribe", "write", "rename", "renombra",
  "integra", "integrate", "corrige", "wire up", "build", "construye"
];

/**
 * A read-only heuristic — never a model call — for whether a prompt reads
 * like a question/exploration rather than a change request. Deliberately
 * conservative: an action verb anywhere in the text always wins (so "explain
 * this, then fix the bug" still routes as a task), and anything not clearly
 * question-shaped falls back to "task" (today's existing behavior), so this
 * can only ever remove work Kairo used to do wrong, never add new
 * uncertainty to what already worked.
 * @param {string} text
 */
export function isLikelyQuestion(text) {
  const normalized = String(text ?? "").trim().toLowerCase();
  if (!normalized) return false;
  if (ACTION_VERBS.some((verb) => normalized.includes(verb))) return false;
  if (normalized.endsWith("?")) return true;
  return QUESTION_WORDS.some((word) => normalized.startsWith(word));
}

const RISK_KEYWORDS = [
  "auth", "authentication", "payment", "security", "production", "credential",
  "secret", "delete", "drop table", "migration", "billing", "pii"
];

/** Matches in the order they actually appear in the text, so a "why" built from them reads naturally. */
/**
 * Matches a task against the project's real skill catalog (name +
 * description, read by skill-catalog.js from each SKILL.md — never
 * guessed from a bare folder name). Word-overlap only, sorted by overlap
 * size — surfaced as transparent evidence in the routing "why", not (yet)
 * a factor that changes which provider is picked; that needs more design
 * than a simple overlap heuristic should be trusted with.
 * @param {string} taskText
 * @param {Array<{name: string, description: string}>} skills
 */
export function matchSkills(taskText, skills = []) {
  const taskWords = new Set(String(taskText ?? "").toLowerCase().split(/\W+/).filter((word) => word.length > 3));
  const matches = [];
  for (const skill of skills) {
    const descriptionWords = String(skill.description ?? "").toLowerCase().split(/\W+/).filter((word) => word.length > 3);
    const overlap = descriptionWords.filter((word) => taskWords.has(word));
    if (overlap.length > 0) matches.push({ name: skill.name, overlap: [...new Set(overlap)] });
  }
  return matches.sort((a, b) => b.overlap.length - a.overlap.length);
}

function countMatches(text, keywords) {
  return keywords
    .map((keyword) => ({ keyword, index: text.indexOf(keyword) }))
    .filter((entry) => entry.index !== -1)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.keyword);
}

/**
 * Pure keyword classifier — no model call, no network, deterministic and
 * fast enough to run on every task submission. Returns which keywords
 * actually matched (not just a score) so the router's "why" can quote them.
 * @param {string} taskText
 */
export function classifyTask(taskText) {
  const text = String(taskText ?? "").toLowerCase();
  const repetitive = countMatches(text, REPETITIVE_KEYWORDS);
  const reasoning = countMatches(text, REASONING_KEYWORDS);
  const multiFile = countMatches(text, MULTI_FILE_KEYWORDS);
  const risk = countMatches(text, RISK_KEYWORDS);
  return {
    repetitive, reasoning, multiFile, risk,
    repetitionScore: repetitive.length,
    reasoningScore: reasoning.length,
    multiFileScore: multiFile.length,
    riskScore: risk.length
  };
}

/**
 * @param {string} adapterId - "codex" | "claude" | "opencode-go" | "opencode-zen" | "cursor"
 * @param {ReturnType<typeof import("../runtime/execution-adapters/index.js").inspectExecutionAdapters>} adapters
 */
function findAdapter(adapterId, adapters) {
  const baseId = adapterId.startsWith("opencode") ? "opencode" : adapterId;
  return adapters.find((adapter) => adapter.id === baseId) ?? null;
}

/** @param {object|null} usageEntry - a codex/claude usage-probe result (primary/secondary windows) */
function remainingPercent(usageEntry) {
  return usageEntry?.primary?.remainingPercent ?? null;
}

// Below this real remaining-quota percentage, a provider is treated as
// exhausted for automatic routing — conserved for the tests explicitly
// listed as this increment's scope, not a newly-invented number.
export const MIN_QUOTA_PERCENT = 5;

// A softer, earlier heads-up threshold — strictly above MIN_QUOTA_PERCENT,
// so the human sees a warning before a provider actually gets excluded,
// never after. Display-only: it never affects checkCandidate's own
// eligibility verdict (see CockpitView's own status-bar consumer).
export const LOW_QUOTA_WARN_PERCENT = 20;

/**
 * The single eligibility policy shared by execution routing, ask routing,
 * and the FIT widget — one candidate is judged the same way everywhere, so
 * a provider that FIT recommends is guaranteed to actually be launchable.
 * Real availability/launchability/quota only; never a capability judgment
 * (that's scoreAvailableModels' job, applied only to survivors of this).
 * @param {string} adapterId - "codex" | "claude" | "opencode-go" | "opencode-zen" | "cursor"
 * @param {{adapters: object[], codexUsage?: object|null, claudeUsage?: object|null, opencodeGoUsage?: object|null, cursorManualQuota?: {manualExhausted: boolean, reason?: string|null}|null}} context -
 *   `cursorManualQuota` is the human-reported override (see
 *   runtime/usage-store.js's `cursor.json` record, set via
 *   `/project cursor exhausted|available`) — Cursor exposes no real,
 *   zero-cost local quota read (its CLI has no usage/billing subcommand
 *   and a successful `-p` call only reports per-request token counts, not
 *   remaining account balance), so unlike Codex/Claude/OpenCode Go this is
 *   never auto-detected, only ever what the human last told Kairo.
 * @returns {{ok: boolean, reason: string|null}}
 * @param {{requireLaunchable?: boolean}} [options] - `requireLaunchable: false`
 *   is for AI TEAM's recommendation surface only (service.js's snapshot()):
 *   it lets opencode-go be named as a real, accessible option — you do
 *   have the model via the Go subscription — without claiming Kairo can
 *   safely auto-execute through it yet (see opencode.js's checkAvailability
 *   for why: no per-event way to prove a run didn't silently bill Zen).
 *   Cursor no longer needs this exemption: its own execution adapter
 *   (execution-adapters/cursor.js) builds a real, auditable non-interactive
 *   launch and Cursor's own docs support headless/CI use, so real task
 *   routing now judges it exactly like Codex/Claude — same launchable gate,
 *   no special case. Real task routing (selectExecutionProvider/
 *   selectAskProvider) always uses the default `true` — it must never pick
 *   something guaranteed to fail at launch (run-manager.js's own
 *   launchable gate would reject it).
 */
export function checkCandidate(adapterId, { adapters, codexUsage, claudeUsage, opencodeGoUsage, cursorManualQuota }, { requireLaunchable = true } = {}) {
  // Zen carries real PAYG/billing risk (see conversation/service.js's
  // capabilities.openCodeExecution) — never an automatic pick, regardless
  // of what its real catalog/benchmarks might otherwise say.
  if (adapterId === "opencode-zen") return { ok: false, reason: "OpenCode Zen is excluded from automatic routing (PAYG risk)" };

  const adapter = findAdapter(adapterId, adapters);
  if (!adapter) return { ok: false, reason: `${adapterId}: no adapter found` };
  if (!adapter.available) return { ok: false, reason: adapter.reason ?? `${adapterId}: not available` };
  // "launchable" means safe for Kairo to invoke programmatically — every
  // real adapter is now judged the same way for both recommendation and
  // execution; no adapter keeps a special exemption anymore (Cursor and
  // OpenCode Go both dropped theirs once their real adapters proved out).
  if (!adapter.launchable) return { ok: false, reason: adapter.reason ?? `${adapterId}: not launchable yet` };

  if (adapterId === "codex") {
    const left = remainingPercent(codexUsage);
    if (left != null && left < MIN_QUOTA_PERCENT) return { ok: false, reason: `Codex quota nearly exhausted (${left}% left)` };
  }
  if (adapterId === "claude") {
    const left = remainingPercent(claudeUsage);
    if (left != null && left < MIN_QUOTA_PERCENT) return { ok: false, reason: `Claude quota nearly exhausted (${left}% left)` };
  }
  if (adapterId === "opencode-go") {
    const windows = opencodeGoUsage?.go?.windows ?? opencodeGoUsage?.windows ?? [];
    // A cap being hit blocks real requests regardless of other windows
    // having headroom — any rate-limited window is real evidence of that,
    // so it's the conservative (fail-closed) reading, not a guess.
    const limited = windows.find((window) => window.status === "rate-limited");
    if (limited) return { ok: false, reason: `OpenCode Go ${limited.name} window is rate-limited` };
  }
  // Cursor: only ever the human's own last word (see this function's own
  // doc) — never fabricated from a guess. Applies to BOTH the
  // recommendation path AND real task routing now that Cursor is a real
  // automatic candidate — a human-reported "out of credits" must block
  // an actual launch, not just a suggestion.
  if (adapterId === "cursor" && cursorManualQuota?.manualExhausted) {
    return { ok: false, reason: cursorManualQuota.reason ?? "Cursor marked out of credits (manual, via /project cursor exhausted)" };
  }
  return { ok: true, reason: null };
}

/** Picks the provider's default model from its real catalog; null (never a guessed id) if none is marked default. */
function defaultModelFor(adapterId, catalogs) {
  const catalogKey = adapterId === "opencode-go" ? "opencodeGo" : adapterId === "opencode-zen" ? "opencodeZen" : adapterId;
  const catalog = catalogs?.[catalogKey];
  if (!catalog || catalog.status === "unknown") return null;
  const models = catalog.models ?? [];
  return models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? null;
}

// Short with no reasoning/risk signal doesn't need the account's biggest
// model — "what does this project do?" or "fix the button color" shouldn't
// burn the same model as "why is there a race condition in the auth flow?".
const LIGHT_TASK_MAX_LENGTH = 100;

/**
 * How much model capability a task (question OR real execution work)
 * actually needs. Reuses classifyTask()'s real keyword signal rather than
 * a separate heuristic — anything that reads as reasoning-heavy or touches
 * a risk keyword still deserves a capable model even if it's short ("why
 * does auth break?"). Governs which MODEL a provider uses, independent of
 * which PROVIDER gets picked (candidateOrder's job) — a trivial fix still
 * goes to whichever provider the task shape favors, just with its
 * cheapest adequate model instead of automatically reaching for the top.
 * @param {string} taskText
 * @returns {"light"|"standard"|"heavy"}
 */
export function classifyEffort(taskText) {
  const text = String(taskText ?? "");
  const profile = classifyTask(text);
  // Reasoning or risk always means real complexity, regardless of length —
  // "why does auth break?" is short but not trivial. Multi-file/integration
  // scope counts too, UNLESS it's dominated by repetition: "rename this DTO
  // field across 15 files" spans many files but is mechanical, not complex
  // — the repetition signal is real evidence the multi-file spread doesn't
  // make it harder, just wider.
  if (profile.reasoningScore > 0 || profile.riskScore > 0) return "heavy";
  if (profile.multiFileScore > 0 && profile.multiFileScore > profile.repetitionScore) return "heavy";
  if (text.trim().length <= LIGHT_TASK_MAX_LENGTH) return "light";
  return "standard";
}

// Anthropic's own public model line naming (Haiku < Sonnet < Opus) is a
// real, documented capability ordering — not a guess — so it's safe to
// match against real catalog entries by name.
const CLAUDE_EFFORT_NAME_PATTERNS = { light: "haiku", standard: "sonnet", heavy: "opus" };

/**
 * Picks a real model id from the provider's actual catalog for the given
 * effort tier, falling back to the provider's own default when no matching
 * tier exists in that catalog (never a fabricated id).
 * @param {string} adapterId
 * @param {"light"|"standard"|"heavy"} effort
 * @param {object} catalogs
 */
function pickModelForEffort(adapterId, effort, catalogs) {
  if (adapterId === "claude") {
    const models = catalogs?.claude?.models ?? [];
    const pattern = CLAUDE_EFFORT_NAME_PATTERNS[effort];
    const tiered = pattern ? models.find((model) => model.id.toLowerCase().includes(pattern)) : null;
    if (tiered) return tiered.id;
  }
  // OpenCode Go's real catalog reports a real per-model cost
  // (costInputPerMTok) — no naming convention to trust here, but real
  // price is itself a real, ungamed signal: sort by it and pick the
  // cheapest/median/priciest model for light/standard/heavy. Codex and
  // Cursor's real catalogs carry neither a naming convention nor a cost
  // field (verified: id/displayName/isDefault/hidden only), so picking a
  // tier for them would be inventing data instead of reading it — they
  // keep using the provider's own default.
  if (adapterId === "opencode-go") {
    const withCost = (catalogs?.opencodeGo?.models ?? []).filter((model) => typeof model.costInputPerMTok === "number");
    if (withCost.length > 0) {
      const sorted = [...withCost].sort((a, b) => a.costInputPerMTok - b.costInputPerMTok);
      if (effort === "light") return sorted[0].id;
      if (effort === "heavy") return sorted[sorted.length - 1].id;
      return sorted[Math.floor((sorted.length - 1) / 2)].id;
    }
  }
  return defaultModelFor(adapterId, catalogs);
}

/**
 * Decides an ordered candidate list (most to least preferred) from the
 * classification alone — availability/quota filtering happens next, in
 * `selectExecutionProvider`. Kept separate so the "why this order" reasoning
 * stays inspectable.
 */
function candidateOrder(profile) {
  if (profile.riskScore > 0 && (profile.reasoningScore > 0 || profile.multiFileScore > 0)) {
    return { needsApproval: true, order: [] };
  }
  if (profile.reasoningScore >= profile.multiFileScore && profile.reasoningScore >= profile.repetitionScore && profile.reasoningScore > 0) {
    return { needsApproval: false, order: ["codex", "claude"] };
  }
  if (profile.multiFileScore > 0) {
    return { needsApproval: false, order: ["claude", "codex"] };
  }
  if (profile.repetitionScore > 0) {
    return { needsApproval: false, order: ["opencode-go", "claude"] };
  }
  // No signal either way — today's existing default behavior, not a guess.
  return { needsApproval: false, order: ["claude", "codex"] };
}

function reasonPhrase(adapterId, profile) {
  if (adapterId === "codex") return profile.reasoning.length ? `reasoning task (${profile.reasoning.join(", ")})` : "default planning provider";
  if (adapterId === "claude") return profile.multiFile.length ? `multi-file/integration task (${profile.multiFile.join(", ")})` : "default implementation provider";
  if (adapterId === "opencode-go") return `repetitive/low-risk task (${profile.repetitive.join(", ")})`;
  return adapterId;
}

/**
 * Orders ask candidates by real remaining quota so repeated questions don't
 * always burn the same account — but only when BOTH sides have a real
 * measured number; with either one unknown there's no honest comparison to
 * make, so it keeps today's existing claude-first default instead of
 * guessing which side "probably" has more room.
 * @param {number|null} codexRemaining
 * @param {number|null} claudeRemaining
 */
function pickAskOrder(codexRemaining, claudeRemaining) {
  if (codexRemaining == null || claudeRemaining == null) return { order: ["claude", "codex"], usedQuota: false };
  return codexRemaining >= claudeRemaining
    ? { order: ["codex", "claude"], usedQuota: true }
    : { order: ["claude", "codex"], usedQuota: true };
}

/**
 * Routes a read-only question to a provider — deliberately NOT the same
 * risk/reasoning gating as selectExecutionProvider: a question ABOUT a
 * risky topic ("how does auth work here?") is itself completely safe,
 * unlike actually implementing changes to it, so this never returns
 * WAIT_FOR_APPROVAL. Just: is a real, quota-healthy, ask-capable provider
 * available, with its real default model.
 * @param {object} args
 * @param {object[]} args.adapters
 * @param {object|null} [args.codexUsage]
 * @param {object|null} [args.claudeUsage]
 * @param {object} [args.catalogs]
 * @param {string} [args.taskText] - the real question text, used only to size
 *   how much model capability it needs (see classifyEffort) — never to
 *   change which provider is picked or to gate on risk.
 */
export function selectAskProvider({ adapters, codexUsage = null, claudeUsage = null, catalogs = {}, taskText = "" }) {
  const effort = classifyEffort(taskText);
  const { order, usedQuota } = pickAskOrder(remainingPercent(codexUsage), remainingPercent(claudeUsage));
  const attempts = [];
  for (const adapterId of order) {
    const check = checkCandidate(adapterId, { adapters, codexUsage, claudeUsage });
    attempts.push({ adapterId, ...check });
    if (check.ok) {
      const quotaNote = usedQuota ? "; more real quota remaining" : "";
      return {
        decision: "ROUTED",
        provider: adapterId,
        model: pickModelForEffort(adapterId, effort, catalogs),
        why: `read-only question (${effort} effort${quotaNote})`,
        rejectedCandidates: attempts.filter((entry) => !entry.ok)
      };
    }
  }
  return {
    decision: "NO_PROVIDER_AVAILABLE",
    provider: null,
    model: null,
    why: `no ask-capable provider available: ${attempts.map((entry) => entry.reason).join("; ")}`,
    rejectedCandidates: attempts
  };
}

/**
 * The actual router: classification -> ordered candidates -> real
 * availability/quota filtering -> a real model id from a real catalog, or
 * an explicit WAIT_FOR_APPROVAL decision when risk is too high to route
 * automatically. Never returns a provider that failed its availability
 * check, and never returns a model id that isn't in that provider's real
 * catalog.
 *
 * @param {object} args
 * @param {string} args.task
 * @param {object[]} args.adapters - inspectExecutionAdapters() result
 * @param {object|null} [args.codexUsage]
 * @param {object|null} [args.claudeUsage]
 * @param {object} [args.catalogs] - { codex, opencodeGo, opencodeZen, cursor, claude } readXModels() results
 */
export function selectExecutionProvider({
  task, adapters, codexUsage = null, claudeUsage = null, opencodeGoUsage = null, catalogs = {}, skills = []
}) {
  const profile = classifyTask(task);
  const { needsApproval, order } = candidateOrder(profile);
  const matchedSkills = matchSkills(task, skills);
  const skillNote = matchedSkills.length > 0
    ? ` · matches skill "${matchedSkills[0].name}" (${matchedSkills[0].overlap.join(", ")})`
    : "";
  // Which provider handles the task and how capable a model it needs are
  // separate questions — a trivial fix still goes wherever the task shape
  // favors, just with the cheapest adequate model instead of always
  // reaching for the account's top one (e.g. Claude Opus/Fable for
  // "fix the button color").
  const effort = classifyEffort(task);

  if (needsApproval) {
    return {
      decision: "WAIT_FOR_APPROVAL",
      provider: null,
      model: null,
      why: `high risk (${profile.risk.join(", ")}) combined with reasoning/multi-file scope — routing automatically would be unsafe; a human should pick the provider.${skillNote}`,
      fallback: null,
      matchedSkills,
      profile
    };
  }

  const attempts = [];
  for (const adapterId of order) {
    const check = checkCandidate(adapterId, { adapters, codexUsage, claudeUsage, opencodeGoUsage });
    attempts.push({ adapterId, ...check });
    if (check.ok) {
      const model = pickModelForEffort(adapterId, effort, catalogs);
      const remaining = order.slice(order.indexOf(adapterId) + 1);
      return {
        decision: "ROUTED",
        provider: adapterId,
        model,
        why: `${reasonPhrase(adapterId, profile)} (${effort} effort)${skillNote}`,
        fallback: remaining[0] ?? null,
        rejectedCandidates: attempts.filter((entry) => !entry.ok),
        matchedSkills,
        profile
      };
    }
  }

  return {
    decision: "NO_PROVIDER_AVAILABLE",
    provider: null,
    model: null,
    why: `every candidate provider was unavailable: ${attempts.map((entry) => entry.reason).join("; ")}`,
    fallback: null,
    rejectedCandidates: attempts,
    matchedSkills,
    profile
  };
}
