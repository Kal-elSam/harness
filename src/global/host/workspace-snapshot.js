import { basename } from "node:path";
import { resolveProjectRoot } from "../architect/architect-store.js";
import { resolveHomeDir } from "../paths.js";
import { inspectEngramIntegration } from "../integrations/engram-evidence.js";
import { readProjectStrategy } from "../conversation/project-strategy-store.js";
import { getSession, isValidSessionId } from "../conversation/session-registry.js";
import { listProviderUsage } from "../runtime/usage-store.js";

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

function workspaceTeam(strategy) {
  if (!strategy) return { state: "not_analyzed", assignments: [] };
  return {
    state: strategy.status ?? "unknown",
    assignments: (strategy.projectTeam ?? []).map(compactAssignment)
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
  engram = null
} = {}) {
  if (typeof projectRoot !== "string" || projectRoot.trim() === "") {
    throw new Error("Kairo workspace snapshot requires a project root.");
  }
  return {
    schema: KAIRO_WORKSPACE_SNAPSHOT_SCHEMA,
    project: { root: projectRoot, label: basename(projectRoot) || projectRoot },
    session: workspaceSession(session),
    team: workspaceTeam(strategy),
    usage: Array.isArray(usage) ? usage : [],
    memory: { status: engram?.status ?? "unknown" }
  };
}

/**
 * Reads the established Kairo sources of truth for the Pi host. It never
 * selects a "latest" session: only an explicit host binding may expose one.
 */
export async function loadKairoWorkspaceSnapshot({ cwd, sessionId = null } = {}, deps = {}) {
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
    engram: inspectMemory({ homeDir })
  });
}
