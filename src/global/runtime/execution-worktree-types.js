export const EXECUTION_WORKTREE_SCHEMA = "kairo.execution-worktree/v1";

// pending: registered, git worktree add not yet confirmed.
// active: at least one role has a real run in progress inside the worktree.
// ready_for_review: all roles finished; a real preview/merge is possible.
// applying: a confirmed merge is in flight against the real project.
// applied / discarded: terminal, successful/abandoned outcomes.
// interrupted: Kairo restarted mid-operation — see recovery, never guessed.
export const WORKTREE_STATES = Object.freeze({
  PENDING: "pending",
  ACTIVE: "active",
  READY_FOR_REVIEW: "ready_for_review",
  APPLYING: "applying",
  APPLIED: "applied",
  DISCARDED: "discarded",
  INTERRUPTED: "interrupted"
});

export const ACTIVE_WORKTREE_STATES = new Set([
  WORKTREE_STATES.PENDING,
  WORKTREE_STATES.ACTIVE,
  WORKTREE_STATES.READY_FOR_REVIEW,
  WORKTREE_STATES.APPLYING
]);

export function isActiveWorktreeState(state) {
  return ACTIVE_WORKTREE_STATES.has(state);
}

/** Same shape as run-types.js's own createRunId — an opaque, sortable-enough, collision-resistant local id, never a real git ref name. */
export function createWorktreeId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `wt_${timestamp}_${random}`;
}
