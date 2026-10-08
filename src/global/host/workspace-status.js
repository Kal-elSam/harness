/**
 * Pure status derivation for the Kairo workspace: one vocabulary
 * (draft / active / working / blocked) computed ONLY from the shared
 * operation outputs (`kairo_team` / `work` task rows, run states, the
 * strategy state). Nothing here reads disk, probes a provider or launches.
 *
 * Mapping table
 * -------------
 * team    strategy `suggested`|`draft` -> draft | `active` -> active
 *         | `stale` -> stale | `not_analyzed`|`none` -> none | other -> unknown
 *
 * agent   (first match wins, evidence only)
 *   working  a REAL non-terminal run (pending/starting/running) whose
 *            execution record names this role. Roles are never guessed from
 *            the provider: a legacy run without a role is not attributed.
 *   blocked  the role's latest run is interrupted / result_corrupt /
 *            evidence_unreadable (reason names the task), OR the team is
 *            stale, OR availability is blocked (reason from the shared read).
 *   draft    the team is a draft (nothing governs executions yet).
 *   active   the team is active, the role is available, no run.
 *   unknown  anything else (availability checking/unknown/absent, no team).
 *            `unknown` is never permission and never working.
 *
 * task    non-terminal run -> working
 *         interrupted | result_corrupt | evidence_unreadable | failed plan
 *                                      -> blocked (reason)
 *         completed run   -> done ONLY when `result_observed` is recorded
 *                            (nextTransition is later in the circuit or null);
 *                            otherwise unknown ("result not read yet")
 *         failed / cancelled run, rejected plan -> shown as such (terminal)
 *         reserved launch without a run record -> unknown
 *         draft | awaiting_approval | approved without a run -> draft
 */
import { ACTIVE_RUN_STATES } from "../runtime/run-types.js";

export const WORK_STATUS = Object.freeze({
  DRAFT: "draft", ACTIVE: "active", WORKING: "working", BLOCKED: "blocked"
});

const BLOCKING_RUN_STATES = new Set(["interrupted", "result_corrupt", "evidence_unreadable"]);
// Circuit steps that come BEFORE the result was observed.
const UNOBSERVED_NEXT = new Set(["delegated", "result_observed"]);

const TEAM_STATUS = {
  suggested: "draft", draft: "draft", active: "active", stale: "stale", not_analyzed: "none", none: "none"
};

/** @param {string|null|undefined} state a raw strategy state or the setup vocabulary */
export function deriveTeamStatus(state) {
  const status = TEAM_STATUS[state] ?? "unknown";
  const reasons = {
    draft: "Team is a draft; approve it to govern executions.",
    stale: "Team strategy is stale; re-analyze the project.",
    none: "Project not analyzed yet.",
    unknown: "Team state is unknown."
  };
  return { status, reason: reasons[status] ?? null };
}

const isActiveRun = (execution) => ACTIVE_RUN_STATES.has(execution?.state);

/** @param {{state?: string, execution?: object|null, error?: string|null, nextTransition?: string|null}} task */
export function deriveTaskStatus(task) {
  const execution = task?.execution ?? null;
  const runState = execution?.state ?? "not_started";
  if (isActiveRun(execution)) return { status: "working", reason: `Run is ${runState}.` };
  if (BLOCKING_RUN_STATES.has(runState)) {
    const label = runState === "interrupted" ? "interrupted" : runState === "result_corrupt" ? "corrupt" : "unreadable";
    return { status: "blocked", reason: `Run evidence is ${label}.` };
  }
  if (runState === "completed") {
    const observed = task?.nextTransition !== undefined && !UNOBSERVED_NEXT.has(task.nextTransition);
    return observed
      ? { status: "done", reason: "Result observed." }
      : { status: "unknown", reason: "Run completed; result not read yet." };
  }
  if (runState === "failed") return { status: "failed", reason: execution?.error ?? "Run failed." };
  if (runState === "cancelled") return { status: "cancelled", reason: "Run was cancelled." };
  if (runState === "reserved") return { status: "unknown", reason: "Launch reserved; no run record yet." };
  if (task?.state === "failed") return { status: "blocked", reason: task?.error ?? "Plan failed." };
  if (task?.state === "rejected") return { status: "rejected", reason: "Plan was rejected." };
  const reasons = {
    draft: "Plan is a draft.", awaiting_approval: "Plan awaits approval.", approved: "Plan approved; execution not confirmed."
  };
  return { status: "draft", reason: reasons[task?.state] ?? "Execution not confirmed." };
}

function latestRunTask(role, tasks) {
  const own = tasks.map((t, index) => ({ t, index })).filter(({ t }) => t?.execution?.role === role);
  own.sort((a, b) => String(a.t.execution.updatedAt ?? "").localeCompare(String(b.t.execution.updatedAt ?? "")) || a.index - b.index);
  return own.length ? own[own.length - 1].t : null;
}

/**
 * @param {{role: string, teamStatus: string, availability?: string, reason?: string|null, tasks?: object[]}} input
 *   `availability`: "available" | "blocked" | anything else = no evidence.
 */
export function deriveAgentStatus({ role, teamStatus, availability, reason = null, tasks = [] }) {
  const team = TEAM_STATUS[teamStatus] ?? teamStatus;
  const ownRuns = tasks.filter((t) => t?.execution?.role === role);
  const active = ownRuns.find((t) => isActiveRun(t.execution));
  if (active) return { status: "working", reason: `Running ${active.taskId}.` };
  const latest = latestRunTask(role, tasks);
  if (latest && BLOCKING_RUN_STATES.has(latest.execution.state)) {
    return { status: "blocked", reason: `Task ${latest.taskId} run is ${latest.execution.state}.` };
  }
  if (team === "stale") return { status: "blocked", reason: "Team strategy is stale." };
  if (availability === "blocked") return { status: "blocked", reason: reason ?? "Not available." };
  if (team === "draft") return { status: "draft", reason: "Team is a draft." };
  if (team === "active" && availability === "available") return { status: "active", reason: null };
  return { status: "unknown", reason: "No availability evidence." };
}

/** Normalizes the shared `kairo_team` roles into the availability shape the derivation reads. */
export function rolesFromPublicTeam(team) {
  return (team?.roles ?? []).map((r) => (r.eligible === true
    ? { role: r.role, availability: "available", reason: null }
    : { role: r.role, availability: "blocked", reason: r.blockedReason ?? "Not available." }));
}

/**
 * @param {{team: {state: string}, roles: {role: string, availability?: string, reason?: string|null}[], tasks: object[]}} input
 */
export function deriveWorkspaceStatus({ team, roles = [], tasks = [] }) {
  const base = deriveTeamStatus(team?.state);
  const agents = roles.map((r) => ({
    role: r.role,
    ...deriveAgentStatus({ role: r.role, teamStatus: base.status, availability: r.availability, reason: r.reason, tasks })
  }));
  const taskStatuses = tasks.map((t) => ({ taskId: t.taskId, ...deriveTaskStatus(t) }));
  return {
    team: {
      ...base,
      working: agents.filter((a) => a.status === "working").length,
      blocked: agents.filter((a) => a.status === "blocked").length
    },
    agents,
    tasks: taskStatuses
  };
}
