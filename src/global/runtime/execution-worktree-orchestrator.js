import { createRunId } from "./run-types.js";
import { startRun as startRunDefault } from "./run-manager.js";
import {
  beginRoleRun as beginRoleRunDefault,
  completeRoleRun as completeRoleRunDefault,
  markInterrupted,
  markReadyForReview as markReadyForReviewDefault
} from "./execution-worktree-manager.js";
import { readWorktreeState } from "./execution-worktree-store.js";
import { WORKTREE_STATES } from "./execution-worktree-types.js";
import { readTaskRecord } from "../architect/architect-store.js";

/**
 * Strict order — never parallel, never reordered. Debugger's real work
 * only makes sense against Builder's own real commit, and Tester's only
 * against both.
 */
const ROLE_CHAIN = Object.freeze(["Builder", "Debugger", "Tester"]);

const ROLE_INSTRUCTIONS = Object.freeze({
  Builder:
    "You are acting as the Builder role in this execution worktree. Implement the following "
    + "approved plan directly in the current working tree. Only edit real files — Kairo itself "
    + "owns every real commit; never run `git add` or `git commit` yourself.",
  Debugger:
    "You are acting as the Debugger role in this execution worktree. The Builder role's real "
    + "implementation of the following approved plan is already committed in the current working "
    + "tree. Review it for real bugs, edge cases, or deviations from the plan, and fix what you "
    + "find. Only edit real files — Kairo itself owns every real commit; never run `git add` or "
    + "`git commit` yourself.",
  Tester:
    "You are acting as the Tester role in this execution worktree. The Builder and Debugger "
    + "roles' real work on the following approved plan is already committed in the current "
    + "working tree. Write and run real tests that validate this implementation against the plan. "
    + "Only edit real files — Kairo itself owns every real commit; never run `git add` or `git "
    + "commit` yourself."
});

function buildRoleTask(role, planMarkdown) {
  return `${ROLE_INSTRUCTIONS[role]}\n\n${planMarkdown}`;
}

/**
 * Automatically chains Builder -> Debugger -> Tester inside one already-
 * created execution worktree — the real point of everything increments
 * 1-4 built: isolation (worktree), a trustworthy per-role transaction
 * (beginRoleRun/completeRoleRun), and a governed budget
 * (assertProviderNotExhausted, already wired into startRun itself) all
 * had to exist BEFORE this was safe to automate.
 *
 * Only ever drives a freshly-created worktree (real status PENDING, no
 * role has run yet) — this is a strict, from-scratch chain, not a
 * resumable one; a worktree that already progressed manually should keep
 * being driven manually via beginRoleRun/completeRoleRun/
 * markReadyForReview directly.
 *
 * Per role, in strict order: beginRoleRun, a real startRun pointed at the
 * worktree's own treePath (the same governed budget gate from
 * usage-manager.js already runs inside startRun itself — no separate
 * check needed here), then completeRoleRun once the real run reaches a
 * terminal state. The task text sent to each role's real agent run wraps
 * the same real, approved plan.md with a role-specific framing — the
 * plan itself is never split or rewritten, only presented differently.
 *
 * Any real failure — the run itself failing, completeRoleRun rejecting a
 * bad diff, or the run never even starting (a budget/preflight/adapter
 * failure before any real process existed) — stops the chain immediately
 * at that role. A never-started run has no run for completeRoleRun's own
 * checks to find, so this function marks the worktree INTERRUPTED itself
 * in that one case; every other real failure is already handled by
 * completeRoleRun's own existing logic. The next role is never attempted
 * once one fails.
 *
 * Only once all three roles complete does this call markReadyForReview
 * automatically — the one, explicit boundary automation stops at. Preview
 * and apply remain entirely manual, exactly as designed in increment 3:
 * a reviewed, confirmed `git merge --ff-only` is never automatic.
 * @param {object} args
 * @param {string} args.worktreeId
 * @param {string} args.homeDir
 * @param {string} args.agentId - the default execution-adapters/index.js provider for every role
 * @param {Partial<Record<"Builder"|"Debugger"|"Tester", string>>} [args.roleAgents] - per-role provider override
 * @param {string|null} [args.model]
 * @param {object|null} [args.profile] - the resolveProfile() shape ({profile, sources}), passed straight through to startRun
 * @param {string} [args.cliVersion]
 * @param {string[]} [args.permissions]
 * @param {boolean} [args.captureTranscript]
 * @param {Function} [args.spawnImpl] - forwarded to every real startRun call, see run-manager.js's own
 * @param {Function} [args.resolveAdapterImpl] - forwarded to every real startRun call, see run-manager.js's own
 */
export async function runOrchestratedChain({
  worktreeId,
  homeDir,
  agentId,
  roleAgents = {},
  model = null,
  profile = null,
  cliVersion,
  permissions = [],
  captureTranscript = false,
  spawnImpl,
  resolveAdapterImpl,
  startRunImpl = startRunDefault,
  beginRoleRunImpl = beginRoleRunDefault,
  completeRoleRunImpl = completeRoleRunDefault,
  markReadyForReviewImpl = markReadyForReviewDefault
}) {
  const initial = await readWorktreeState(homeDir, worktreeId);
  if (!initial) throw new Error(`Execution worktree "${worktreeId}" not found.`);
  if (initial.status !== WORKTREE_STATES.PENDING) {
    throw new Error(
      `Execution worktree "${worktreeId}" is ${initial.status}; runOrchestratedChain only drives a `
      + "freshly-created worktree from PENDING — a worktree already in progress must be driven manually."
    );
  }

  const record = await readTaskRecord(initial.projectRoot, initial.taskId);
  if (!record?.planMarkdown) {
    throw new Error(`Execution worktree "${worktreeId}" has no real approved plan text to orchestrate roles from.`);
  }

  const completedRoles = [];

  for (const role of ROLE_CHAIN) {
    const runId = createRunId();
    await beginRoleRunImpl({ worktreeId, role, runId, homeDir });

    try {
      const { completion } = await startRunImpl({
        homeDir,
        runId,
        agentId: roleAgents[role] ?? agentId,
        task: buildRoleTask(role, record.planMarkdown),
        cwd: initial.treePath,
        model,
        permissions,
        captureTranscript,
        cliVersion,
        profile,
        wait: true,
        ...(spawnImpl ? { spawnImpl } : {}),
        ...(resolveAdapterImpl ? { resolveAdapterImpl } : {})
      });
      await completion;
    } catch (error) {
      const worktreeNow = (await readWorktreeState(homeDir, worktreeId)) ?? initial;
      await markInterrupted(
        homeDir, worktreeNow,
        `Role "${role}" run "${runId}" could not be started: ${error.message ?? String(error)}`
      );
      throw new Error(`Orchestrated chain stopped at role "${role}": ${error.message ?? String(error)}`);
    }

    try {
      await completeRoleRunImpl({ worktreeId, role, runId, homeDir });
    } catch (error) {
      throw new Error(`Orchestrated chain stopped at role "${role}": ${error.message ?? String(error)}`);
    }

    completedRoles.push(role);
  }

  const ready = await markReadyForReviewImpl({ worktreeId, homeDir });
  return { worktree: ready, completedRoles };
}
