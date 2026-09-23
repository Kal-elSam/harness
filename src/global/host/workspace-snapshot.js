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
 */
export function buildKairoWorkspaceSnapshot({
  projectRoot,
  session = null,
  strategy = null,
  usage = [],
  engram = null,
  intelligence
} = {}) {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    throw new Error("Kairo workspace snapshot requires a project root.");
  }
  return {
    schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
    project: { root: projectRoot, label: basename(projectRoot) || projectRoot },
    session: workspaceSession(session),
    team: workspaceTeam(strategy, intelligence),
    usage: Array.isArray(usage) ? usage : [],
    subscriptions: workspaceSubscriptions(intelligence),
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
export async function loadKairoWorkspaceSnapshot({ cwd, sessionId = null, intelligence } = {}, deps = {}) {
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
    intelligence
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
