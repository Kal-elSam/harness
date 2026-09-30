import { basename } from "node:path";
import { resolveProjectRoot } from "../architect/architect-store.js";
import { resolveHomeDir } from "../paths.js";
import { inspectEngramIntegration } from "../integrations/engram-evidence.js";
import { readProjectStrategy } from "../conversation/project-strategy-store.js";
import { getSession, isValidSessionId } from "../conversation/session-registry.js";
import { listProviderUsage } from "../runtime/usage-store.js";
import { resolveAssignmentAvailability } from "../conversation/assignment-availability.js";
import { explainTeamDecision } from "../conversation/team-decision.js";
import { buildUsageModel, formatSubscriptionUsageSegments } from "../conversation/usage-summary.js";
import { createConversationService } from "../conversation/service.js";
import { readCodexUsage } from "../observability/codex-usage.js";
import { readClaudeUsage } from "../observability/claude-usage.js";
import { readOpenCodeUsage } from "../observability/opencode-usage.js";
import { readCachedUsage, writeCachedUsage, readCachedAvailability, writeCachedAvailability } from "./workspace-cache.js";
import { deriveTeamPresentation } from "../conversation/team-presentation.js";
import { readAvailabilityRecovery } from "../conversation/availability-recovery-store.js";

export const KAIRO_WORKSPACE_SNAPSHOT_SCHEMA = "kairo.workspace-shell/v1";

/** Spanish availability label for the Project proposal table — never replaces model identity. */
function availabilityLabel(state) {
  if (state === "available") return "usable";
  if (state === "blocked") return "bloqueado";
  if (state === "checking") return "verificando";
  return "desconocido";
}

function compactAssignment(entry, intelligence) {
  const model = entry?.model ?? null;
  const availability = rowAvailability(model, intelligence);
  return {
    role: entry?.role ?? "Unknown role",
    model: model?.displayName ?? model?.modelId ?? "Unavailable",
    via: model?.adapterId ?? "unknown",
    reason: explainTeamDecision(entry),
    availability: {
      state: availability.state,
      label: availabilityLabel(availability.state),
      warning: availability.warning ?? null
    }
  };
}

function workspaceSession(session) {
  if (!session) return { state: "unbound" };
  return {
    id: session.id,
    title: session.title ?? null,
    mode: session.mode ?? "ask",
    state: "bound"
  };
}

/** Stable herd id for one agent — a slug of the role name, never a random
 * or session-scoped value, so attention state can be tracked per role
 * across refreshes. */
function agentId(role) {
  const slug = String(role ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "unknown-role";
}

/**
 * The herd state for one agent, derived ONLY from the team row's real
 * availability — this snapshot never invents its own liveness rule.
 * - `blocked`: resolveAssignmentAvailability said blocked (fail-closed
 *   attention signal; never presented as available).
 * - `idle`: assignment available with no active run for that role.
 * - `unknown`: still checking, or the probe failed / produced no evidence.
 * `working`/`done` are deliberately NEVER emitted here: the snapshot
 * inputs expose no per-role run signal yet (see H3 in
 * odd/tasks/herd-shell-layout.md) — claiming them would be fabrication.
 * @param {object} availability - a team row's `availability`
 */
function agentState(availability) {
  if (availability?.state === "blocked") return "blocked";
  if (availability?.state === "available") return "idle";
  return "unknown";
}

/**
 * The herd agents — one entry per team row, in strategy order (Project
 * Analyst, Orchestrator, then project-team roles). Same facts as
 * `team.rows`, reshaped for attention ordering (blocked first happens at
 * render, see workspace-widget.js); no second recommendation.
 * Additive `why` / `availability` feed the Project proposal table
 * (por qué / disponibilidad) without replacing provider · model identity.
 * @param {object} team - the `workspaceTeam` value
 */
function workspaceAgents(team) {
  return (team?.rows ?? []).map((row) => ({
    id: agentId(row.role),
    label: row.role ?? "Unknown role",
    role: row.role ?? "Unknown role",
    provider: row.via ?? "unknown",
    model: row.model ?? "no eligible option",
    state: agentState(row.availability),
    stateReason: row.availability?.warning ?? null,
    why: row.reason ?? null,
    availability: availabilityLabel(row.availability?.state)
  }));
}

/**
 * The herd spaces — minimum viable: the current project plus the bound
 * session (short id + mode). Never an invented multi-repo list: exactly
 * these two entries, with the session entry honestly `unbound` when no
 * host binding exists.
 * @param {object} project - the snapshot's `project`
 * @param {object} session - the snapshot's `session`
 */
function workspaceSpaces(project, session) {
  const spaces = [{
    kind: "project",
    label: project?.label ?? project?.root ?? "unknown",
    root: project?.root ?? null
  }];
  if (session?.state === "bound") {
    spaces.push({ kind: "session", id: String(session.id).slice(0, 8), mode: session.mode ?? "ask", state: "bound" });
  } else {
    spaces.push({ kind: "session", state: "unbound" });
  }
  return spaces;
}

/**
 * Availability for one team row, computed ONLY through the real,
 * moved `resolveAssignmentAvailability` — this widget never invents its
 * own eligibility rule. `intelligence` distinguishes three real states:
 * - `undefined` (not passed at all): the live Kairo probe hasn't run yet
 *   for this render — honestly `checking`, never `available`.
 * - `null` (explicitly passed): the probe ran and failed/produced no
 *   usable data — `unknown`, never `available`.
 * - an object: the real `modelIntelligence` shape
 *   (`eligibility`/`claudeEntitlement`/`cursorAccess`) — compute the real
 *   `available`/`blocked` state from it.
 * @param {object|null|undefined} model
 * @param {object|null|undefined} intelligence
 */
function rowAvailability(model, intelligence) {
  if (intelligence === undefined) return { state: "checking", warning: null };
  if (intelligence === null) return { state: "unknown", warning: null };
  const { available, warning } = resolveAssignmentAvailability(model, intelligence);
  if (available) return { state: "available", warning: warning ?? null };
  // A provider window limit (checkCandidate's structured `limit`) rides
  // along so notices can group every role hit by the same provider window.
  const limit = intelligence?.eligibility?.[model?.adapterId]?.limit ?? null;
  return { state: "blocked", warning: warning ?? null, ...(limit ? { limit } : {}) };
}

function teamRow(role, model, intelligence, entry = null) {
  return {
    role,
    model: model?.displayName ?? model?.modelId ?? "no eligible option",
    via: model?.adapterId ?? "unknown",
    accessMode: model?.accessMode ?? null,
    availability: rowAvailability(model, intelligence),
    reason: entry ? explainTeamDecision(entry) : null
  };
}

/**
 * The full, ordered team roster — Project Analyst, Orchestrator, then
 * every project-team role, exactly Kairo's own real strategy order. Never
 * a second recommendation: every role/model pair is read straight off the
 * persisted ProjectStrategy.
 * @param {object} strategy
 * @param {object|null|undefined} intelligence
 */
function workspaceTeamRows(strategy, intelligence) {
  const rows = [
    teamRow("Project Analyst", strategy.bootstrapAnalyst ?? null, intelligence),
    teamRow("Orchestrator", strategy.orchestrator ?? null, intelligence)
  ];
  for (const entry of strategy.projectTeam ?? []) {
    rows.push(teamRow(entry?.role ?? "Unknown role", entry?.model ?? null, intelligence, entry));
  }
  return rows;
}

/**
 * @param {object} strategy
 * @param {object|null|undefined} intelligence
 * @param {{value: object, savedAt: number}|null} [cache] - the last-known
 *   availability cache (see workspace-cache.js's readCachedAvailability).
 *   Used ONLY while `intelligence` hasn't resolved yet (`undefined`) or
 *   explicitly failed (`null`) — real live data always wins once it
 *   arrives (see the P01.2 "Design": "replaced by fresh data when it
 *   arrives... failures keep the cached value marked stale").
 * @param {number} [now]
 */
function workspaceTeam(strategy, intelligence, cache = null, now = Date.now()) {
  if (!strategy) return { state: "not_analyzed", assignments: [], rows: [], presentation: deriveTeamPresentation(null) };
  const useCache = intelligence === undefined || intelligence === null;
  const cachedIntelligence = useCache && cache?.value ? cache.value : intelligence;
  const base = {
    state: strategy.status ?? "unknown",
    assignments: (strategy.projectTeam ?? []).map((entry) => compactAssignment(entry, cachedIntelligence)),
    rows: workspaceTeamRows(strategy, cachedIntelligence)
  };
  // Additive presentation state (presentation only; never touches the
  // stored assignments). Current validation needs a LIVE probe: a cache
  // shown while the probe is pending is `verifying`, a failed one `blocked`.
  const probe = intelligence === undefined ? "pending" : intelligence === null ? "failed" : "live";
  base.presentation = deriveTeamPresentation(strategy, { rows: base.rows, probe });
  if (useCache && cache?.value) {
    return { ...base, cached: true, cacheAgeMs: Math.max(0, now - cache.savedAt) };
  }
  return base;
}

/**
 * The always-visible subscription usage summary — Codex/Claude/OpenCode Go,
 * same real text `formatSubscriptionUsageSegments` gives the legacy
 * cockpit's compact USAGE bar. Same three-state contract as team
 * availability (see `rowAvailability`'s own doc): `undefined` -> the live
 * probe hasn't run yet (`checking`), `null` -> it ran and failed/produced
 * no usable data (`unknown`, never a fabricated line), an object -> the
 * real `usage`/`providers` facts from that one conversation-service
 * snapshot call.
 * @param {object|null|undefined} intelligence
 * @param {{value: object, savedAt: number}|null} [cache] - the last-known
 *   usage cache (see workspace-cache.js's readCachedUsage). Used ONLY
 *   while `intelligence` hasn't resolved yet (`undefined`) or explicitly
 *   failed (`null`) — real live data always wins once it arrives.
 * @param {number} [now]
 */
function workspaceSubscriptions(intelligence, cache = null, now = Date.now()) {
  if (intelligence === undefined || intelligence === null) {
    if (cache?.value) {
      const usage = { usage: cache.value.usage, providers: cache.value.providers };
      return {
        state: "cached",
        segments: formatSubscriptionUsageSegments(usage),
        usageModel: buildUsageModel(usage),
        cacheAgeMs: Math.max(0, now - cache.savedAt)
      };
    }
    return { state: intelligence === null ? "unknown" : "checking", segments: [], usageModel: [] };
  }
  const usage = { usage: intelligence.usage, providers: intelligence.providers };
  return {
    state: "ready",
    segments: formatSubscriptionUsageSegments(usage),
    // Additive: the same structured providers -> windows model
    // formatSubscriptionUsageSegments' text is built from (see
    // usage-summary.js), so the Pi widget can bar-render it directly
    // instead of re-parsing `segments`.
    usageModel: buildUsageModel(usage)
  };
}

/**
 * Pure host view model. It exposes existing Kairo facts without creating a
 * second recommendation, quota, or memory policy in the Pi integration.
 *
 * `usageIntelligence` and `availabilityIntelligence` are the P01.2 split:
 * team availability and subscription usage resolve from two INDEPENDENT
 * live sources (usage is ~5s, the full availability probe is ~20s — see
 * loadKairoUsageData vs loadKairoLiveData), so each is read from its own
 * argument instead of one shared `intelligence` object. Both default to
 * the legacy `intelligence` argument for back-compat with callers that
 * still pass one combined value (e.g. the P01.1 snapshot tests).
 */
export function buildKairoWorkspaceSnapshot({
  projectRoot,
  session = null,
  strategy = null,
  usage = [],
  engram = null,
  intelligence,
  usageIntelligence = intelligence,
  availabilityIntelligence = intelligence,
  usageCache = null,
  availabilityCache = null,
  now = Date.now()
} = {}) {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    throw new Error("Kairo workspace snapshot requires a project root.");
  }
  const project = { root: projectRoot, label: basename(projectRoot) || projectRoot };
  const sessionValue = workspaceSession(session);
  const team = workspaceTeam(strategy, availabilityIntelligence, availabilityCache, now);
  return {
    schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
    project,
    session: sessionValue,
    team,
    usage: Array.isArray(usage) ? usage : [],
    subscriptions: workspaceSubscriptions(usageIntelligence, usageCache, now),
    memory: { status: engram?.status ?? "unknown" },
    // Additive herd contract (H1): same team/session facts, reshaped for
    // attention ordering — old consumers keep reading team/session untouched.
    agents: workspaceAgents(team),
    spaces: workspaceSpaces(project, sessionValue)
  };
}

/**
 * Reads the established Kairo sources of truth for the Pi host. It never
 * selects a "latest" session: only an explicit host binding may expose one.
 * `intelligence` is forwarded as-is to `buildKairoWorkspaceSnapshot` (see
 * its own doc for the checking/unknown/real three-state contract) — this
 * loader never computes availability itself, only reads Kairo's other
 * sources of truth.
 */
export async function loadKairoWorkspaceSnapshot({
  cwd,
  sessionId = null,
  intelligence,
  usageIntelligence = intelligence,
  availabilityIntelligence = intelligence,
  usageCache: explicitUsageCache,
  availabilityCache: explicitAvailabilityCache
} = {}, deps = {}) {
  const resolveRoot = deps.resolveProjectRoot ?? resolveProjectRoot;
  const homeDir = (deps.resolveHomeDir ?? resolveHomeDir)();
  const projectRoot = await resolveRoot(cwd);
  const readStrategy = deps.readProjectStrategy ?? readProjectStrategy;
  const readUsage = deps.listProviderUsage ?? listProviderUsage;
  const inspectMemory = deps.inspectEngramIntegration ?? inspectEngramIntegration;
  const readSession = deps.getSession ?? getSession;
  const readUsageCacheImpl = deps.readCachedUsage ?? readCachedUsage;
  const writeUsageCacheImpl = deps.writeCachedUsage ?? writeCachedUsage;
  const readAvailabilityCacheImpl = deps.readCachedAvailability ?? readCachedAvailability;
  const writeAvailabilityCacheImpl = deps.writeCachedAvailability ?? writeCachedAvailability;

  if (sessionId != null && !isValidSessionId(sessionId)) {
    throw new Error(`Invalid Kairo host session id "${sessionId}".`);
  }

  const [strategy, usage, session] = await Promise.all([
    readStrategy(homeDir, projectRoot),
    readUsage(homeDir),
    sessionId == null ? null : readSession(homeDir, projectRoot, sessionId)
  ]);

  // P01.2 last-known cache: while a side hasn't resolved yet (`undefined`)
  // or explicitly failed (`null`), read its last-known cache so the very
  // first render can show it dim with its age instead of a blank
  // "checking" state — see workspace-cache.js's own doc. A caller-supplied
  // `usageCache`/`availabilityCache` (e.g. one already read by the host
  // for an earlier phase this same refresh) short-circuits a redundant
  // disk read.
  const usageCache = explicitUsageCache !== undefined
    ? explicitUsageCache
    : usageIntelligence == null ? await readUsageCacheImpl(homeDir).catch(() => null) : null;
  const availabilityCache = explicitAvailabilityCache !== undefined
    ? explicitAvailabilityCache
    : availabilityIntelligence == null ? await readAvailabilityCacheImpl(homeDir, projectRoot).catch(() => null) : null;

  // A freshly resolved live value (never `undefined`/`null`) becomes the
  // new last-known cache. A still-pending probe or an explicit failure
  // never overwrites the existing cache — see the P01.2 "Design": "a
  // failed refresh keeps the cached value marked stale, never presented
  // as fresh".
  if (usageIntelligence != null) await writeUsageCacheImpl(homeDir, usageIntelligence).catch(() => {});
  if (availabilityIntelligence != null) await writeAvailabilityCacheImpl(homeDir, projectRoot, availabilityIntelligence).catch(() => {});

  return buildKairoWorkspaceSnapshot({
    projectRoot,
    strategy,
    usage,
    session,
    engram: inspectMemory({ homeDir }),
    usageIntelligence,
    availabilityIntelligence,
    usageCache,
    availabilityCache
  });
}

/**
 * Obtains Kairo's real, live data for the host's second render phase —
 * team availability (eligibility, Claude entitlement, Cursor access) AND
 * subscription usage (`usage`/`providers`) — from ONE call to the
 * conversation service's own snapshot, the same real probe the legacy
 * cockpit uses. Deliberately one snapshot() call for both: the probe
 * itself is the slow part, never worth paying twice in the same refresh.
 * This is a SEPARATE call from `loadKairoWorkspaceSnapshot`, called only
 * for the host's second render phase, never blocking the first,
 * immediate `checking` render.
 *
 * Fails closed: a thrown probe or a snapshot with no real eligibility
 * data returns `null` (never a fabricated "everything's fine" empty
 * object) — the caller then renders every team row `unknown` and the
 * subscriptions line `unknown`, never `available`/real numbers.
 * @param {{cwd?: string}} [args]
 * @param {{createConversationService?: typeof createConversationService}} [deps]
 * @returns {Promise<{eligibility: object, claudeEntitlement: object, cursorAccess: object, usage: object, providers: object}|null>}
 */
/**
 * Runs automatic team recovery (conversation/team-recovery.js) for this
 * project with live provider probes. Never throws: an unexpected failure is
 * reported as `{outcome: "error", reason}` so the Pi host can say so without
 * breaking its refresh.
 * @param {{cwd: string}} args
 * @param {{createConversationService?: typeof createConversationService}} [deps]
 */
export async function recoverKairoProjectTeam({ cwd } = {}, deps = {}) {
  const createService = deps.createConversationService ?? createConversationService;
  try {
    return await createService({ enableProviderProbes: true }).recoverProjectTeam({ cwd });
  } catch (error) {
    return { outcome: "error", reason: error?.message ?? String(error) };
  }
}

/** Approve / reject a pending recovery proposal from the Pi host (the
 * `kairo-team-approve` / `kairo-team-reject` commands). Never throw: an
 * unexpected failure is reported as `{outcome: "error", reason}` so the
 * Pi host can say so without breaking its refresh. Approval re-verifies
 * and activates; rejection only closes — see team-recovery.js. */
export async function approveKairoRecovery({ cwd } = {}, deps = {}) {
  const createService = deps.createConversationService ?? createConversationService;
  try {
    return await createService({ enableProviderProbes: true }).approveRecoveryProposal({ cwd });
  } catch (error) {
    return { outcome: "error", reason: error?.message ?? String(error) };
  }
}

export async function rejectKairoRecovery({ cwd } = {}, deps = {}) {
  const createService = deps.createConversationService ?? createConversationService;
  try {
    return await createService({ enableProviderProbes: true }).rejectRecoveryProposal({ cwd });
  } catch (error) {
    return { outcome: "error", reason: error?.message ?? String(error) };
  }
}

/** Read the pending recovery record for this project (null when none) —
 * how a fresh process (restart) still sees a proposal made before it: the
 * cause (`affected`) and the suggested team live on the record, never in
 * memory. Returns null on any read failure: no record is never an error,
 * only "nothing pending". */
export async function readPendingKairoRecovery({ cwd = process.cwd() } = {}, deps = {}) {
  try {
    const resolveRoot = deps.resolveProjectRoot ?? resolveProjectRoot;
    const homeDir = (deps.resolveHomeDir ?? resolveHomeDir)();
    const projectRoot = await resolveRoot(cwd);
    const read = deps.readAvailabilityRecovery ?? readAvailabilityRecovery;
    return await read(homeDir, projectRoot);
  } catch {
    return null;
  }
}

/**
 * On-demand availability revalidation for the ratatui host (U2c): re-runs
 * the SAME real conversation-service probe `loadKairoLiveData` uses, then
 * rebuilds the workspace snapshot from that fresh evidence — so the
 * sidebar/CTA reflect real provider state instead of the last-known cache.
 * Never invents a cause of its own: every row's `availability.warning`
 * comes straight from the real `eligibility[...].reason` text this call
 * received (see workspaceTeamRows / assignment-availability.js), the same
 * evidence a normal refresh would eventually show.
 *
 * Fails closed: a failed probe (`loadKairoLiveData` returns null) still
 * rebuilds the snapshot — from whatever last-known cache already exists —
 * and reports `ok: false` with a real reason, never a fabricated
 * "available" or a synthesized quota/funds cause.
 * @param {{cwd: string}} args
 * @param {object} [deps] - forwarded to both loadKairoLiveData and
 *   loadKairoWorkspaceSnapshot (their own DI shapes).
 * @returns {Promise<{ok: boolean, reason: string|null, snapshot: object}>}
 */
export async function revalidateKairoTeamAvailability({ cwd } = {}, deps = {}) {
  const loadLive = deps.loadKairoLiveData ?? loadKairoLiveData;
  const loadSnap = deps.loadKairoWorkspaceSnapshot ?? loadKairoWorkspaceSnapshot;
  const live = await loadLive({ cwd }, deps);
  const snapshot = await loadSnap({ cwd, intelligence: live }, deps);
  return {
    ok: live !== null,
    reason: live === null
      ? "Live availability probe failed — team status shown from the last-known state."
      : null,
    snapshot
  };
}

export async function loadKairoLiveData({ cwd } = {}, deps = {}) {
  const createService = deps.createConversationService ?? createConversationService;
  try {
    const service = createService({ enableProviderProbes: true });
    const snap = await service.snapshot({ cwd });
    const eligibility = snap?.modelIntelligence?.eligibility ?? {};
    if (Object.keys(eligibility).length === 0) return null;
    return {
      eligibility,
      claudeEntitlement: snap?.modelIntelligence?.claudeEntitlement ?? {},
      cursorAccess: snap?.modelIntelligence?.cursorAccess ?? {},
      usage: snap?.usage ?? {},
      providers: snap?.providers ?? {}
    };
  } catch {
    return null;
  }
}

/**
 * Loads real subscription usage ONLY, independent of team availability
 * (see loadKairoLiveData above) — the three usage readers (Codex, Claude,
 * OpenCode Go+Zen) run in parallel and typically resolve in ~5s combined,
 * far faster than the full conversation-service snapshot probe team
 * availability needs (~20s on the user's machine). Splitting these lets
 * the host render fresh usage without waiting on the slower availability
 * probe (see the P01.2 "Why" in odd/tasks/kairo-pi-parity.md).
 *
 * Same call shapes service.js's own snapshot() uses for these three
 * readers (readCodexUsage({cwd}), readClaudeUsage({}),
 * readOpenCodeUsage({})), so the numbers this loader produces match what
 * the service would produce for the same project.
 *
 * Each reader already fails closed on its own (returns a `status:
 * "unknown"` shape rather than throwing) — this loader additionally
 * guards against an unexpected throw from any one reader with `.catch`,
 * so one failed reader never prevents the other two from reporting.
 * @param {{cwd?: string}} [args]
 * @param {{readCodexUsage?: typeof readCodexUsage, readClaudeUsage?: typeof readClaudeUsage, readOpenCodeUsage?: typeof readOpenCodeUsage}} [deps]
 * @returns {Promise<{usage: {codex: object|null, claude: object|null, opencode: object|null}, providers: object}>}
 */
export async function loadKairoUsageData({ cwd = process.cwd() } = {}, deps = {}) {
  const readCodex = deps.readCodexUsage ?? readCodexUsage;
  const readClaude = deps.readClaudeUsage ?? readClaudeUsage;
  const readOpenCode = deps.readOpenCodeUsage ?? readOpenCodeUsage;
  const [codex, claude, opencode] = await Promise.all([
    readCodex({ cwd }).catch(() => null),
    readClaude({}).catch(() => null),
    readOpenCode({}).catch(() => null)
  ]);
  return { usage: { codex, claude, opencode }, providers: {} };
}
