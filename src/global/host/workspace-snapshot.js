import { basename } from "node:path";
import { resolveProjectRoot } from "../architect/architect-store.js";
import { resolveHomeDir } from "../paths.js";
import { inspectEngramIntegration } from "../integrations/engram-evidence.js";
import { readProjectStrategy } from "../conversation/project-strategy-store.js";
import { getSession, isValidSessionId } from "../conversation/session-registry.js";
import { listProviderUsage } from "../runtime/usage-store.js";
import { resolveAssignmentAvailability } from "../conversation/assignment-availability.js";
import { buildUsageModel, formatSubscriptionUsageSegments } from "../conversation/usage-summary.js";
import { createConversationService } from "../conversation/service.js";
import { readCodexUsage } from "../observability/codex-usage.js";
import { readClaudeUsage } from "../observability/claude-usage.js";
import { readOpenCodeUsage } from "../observability/opencode-usage.js";

export const KAIRO_WORKSPACE_SNAPSHOT_SCHEMA = "kairo.workspace-shell/v1";

function compactAssignment(entry) {
  const model = entry?.model ?? null;
  return {
    role: entry?.role ?? "Unknown role",
    model: model?.displayName ?? model?.modelId ?? "Unavailable",
    via: model?.adapterId ?? "unknown"
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
  return { state: available ? "available" : "blocked", warning: warning ?? null };
}

function teamRow(role, model, intelligence) {
  return {
    role,
    model: model?.displayName ?? model?.modelId ?? "no eligible option",
    via: model?.adapterId ?? "unknown",
    accessMode: model?.accessMode ?? null,
    availability: rowAvailability(model, intelligence)
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
    rows.push(teamRow(entry?.role ?? "Unknown role", entry?.model ?? null, intelligence));
  }
  return rows;
}

function workspaceTeam(strategy, intelligence) {
  if (!strategy) return { state: "not_analyzed", assignments: [], rows: [] };
  return {
    state: strategy.status ?? "unknown",
    assignments: (strategy.projectTeam ?? []).map(compactAssignment),
    rows: workspaceTeamRows(strategy, intelligence)
  };
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
 */
function workspaceSubscriptions(intelligence) {
  if (intelligence === undefined) return { state: "checking", segments: [], usageModel: [] };
  if (intelligence === null) return { state: "unknown", segments: [], usageModel: [] };
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
  availabilityIntelligence = intelligence
} = {}) {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    throw new Error("Kairo workspace snapshot requires a project root.");
  }
  return {
    schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
    project: { root: projectRoot, label: basename(projectRoot) || projectRoot },
    session: workspaceSession(session),
    team: workspaceTeam(strategy, availabilityIntelligence),
    usage: Array.isArray(usage) ? usage : [],
    subscriptions: workspaceSubscriptions(usageIntelligence),
    memory: { status: engram?.status ?? "unknown" }
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
  availabilityIntelligence = intelligence
} = {}, deps = {}) {
  const resolveRoot = deps.resolveProjectRoot ?? resolveProjectRoot;
  const homeDir = (deps.resolveHomeDir ?? resolveHomeDir)();
  const projectRoot = await resolveRoot(cwd);
  const readStrategy = deps.readProjectStrategy ?? readProjectStrategy;
  const readUsage = deps.listProviderUsage ?? listProviderUsage;
  const inspectMemory = deps.inspectEngramIntegration ?? inspectEngramIntegration;
  const readSession = deps.getSession ?? getSession;

  if (sessionId != null && !isValidSessionId(sessionId)) {
    throw new Error(`Invalid Kairo host session id "${sessionId}".`);
  }

  const [strategy, usage, session] = await Promise.all([
    readStrategy(homeDir, projectRoot),
    readUsage(homeDir),
    sessionId == null ? null : readSession(homeDir, projectRoot, sessionId)
  ]);

  return buildKairoWorkspaceSnapshot({
    projectRoot,
    strategy,
    usage,
    session,
    engram: inspectMemory({ homeDir }),
    usageIntelligence,
    availabilityIntelligence
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
