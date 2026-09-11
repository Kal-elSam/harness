// Pure, dependency-free logic for the `kairo start` interactive cockpit.
// Kept separate from the pi-tui rendering so it can be unit tested without a terminal.

/**
 * @typedef {object} CockpitRow
 * @property {string} taskId
 * @property {string|null} taskText - the real task description, never the noisy taskId slug
 * @property {string} planState - one of the PLAN_STATES values (draft/awaiting_approval/approved/rejected/failed)
 * @property {string} approval - "approved" | "rejected" | "not_decided"
 * @property {string} execState - "not_started" | "reserved" | "running" | "done" | "failed" | ...
 * @property {boolean} execActive
 * @property {string|null} execMessage
 * @property {string|null} planProvider - who planned it (e.g. "codex"); real, never inferred
 * @property {string|null} planModel - explicit model if one was requested; null means provider default
 * @property {string|null} execProvider - who is/was executing it (e.g. "claude")
 */

/**
 * Maps a conversation-service snapshot's timeline into display rows.
 * @param {Array<object>} timeline - conversation snapshot().timeline entries
 * @returns {CockpitRow[]}
 */
export function buildTaskRows(timeline) {
  if (!Array.isArray(timeline)) return [];
  return timeline.map((plan) => ({
    taskId: plan.taskId,
    taskText: plan.taskText ?? null,
    planState: plan.state,
    approval: plan.approval ?? "not_decided",
    execState: plan.execution?.state ?? "not_started",
    execActive: plan.execution?.active === true,
    execMessage: plan.execution?.message ?? null,
    planProvider: plan.provider ?? null,
    planModel: plan.model ?? null,
    execProvider: plan.execution?.provider ?? null
  }));
}

/**
 * Derives an honest lifecycle phase from real plan/execution state — never
 * a phase Kairo can't actually distinguish today (e.g. no "REVIEWING" step
 * exists in the data model, so it's not offered).
 * @param {CockpitRow|null} row
 * @returns {"IDLE"|"WAITING APPROVAL"|"REJECTED"|"READY"|"IMPLEMENTING"|"COMPLETE"|"ERROR"|"PLANNING"}
 */
export function derivePhase(row) {
  if (!row) return "IDLE";
  if (row.execActive) return "IMPLEMENTING";
  if (row.execState === "done") return "COMPLETE";
  if (row.execState === "failed" || row.planState === "failed") return "ERROR";
  if (row.planState === "rejected") return "REJECTED";
  if (row.planState === "approved") return "READY";
  if (row.planState === "awaiting_approval") return "WAITING APPROVAL";
  return "PLANNING";
}

/**
 * Clamps a selection index into the valid range for the given rows array.
 * @param {number} index
 * @param {number} length
 * @returns {number}
 */
export function clampSelection(index, length) {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  if (index > length - 1) return length - 1;
  return index;
}

/**
 * Formats a single row as one display line.
 * @param {CockpitRow} row
 * @param {{selected?: boolean}} [options]
 * @returns {string}
 */
export function formatRowText(row, { selected = false } = {}) {
  const marker = selected ? ">" : " ";
  const planState = String(row.planState ?? "").padEnd(18);
  const execState = String(row.execState ?? "").padEnd(12);
  return `${marker} ${planState} ${execState} ${row.taskId}`;
}

/**
 * Returns the header line matching formatRowText's column layout.
 * @returns {string}
 */
export function headerLine() {
  return `  ${"PLAN".padEnd(18)} ${"EXECUTION".padEnd(12)} TASK`;
}

/**
 * Maps a row's plan/execution state to a card tone (see ./card.js CARD_TONE)
 * so its rendered line's left rail reflects its state at a glance.
 * @param {CockpitRow} row
 * @returns {"info"|"success"|"warning"|"error"}
 */
export function rowTone(row) {
  if (row.execState === "failed" || row.planState === "rejected") return "error";
  if (row.execActive || row.execState === "running" || row.planState === "awaiting_approval") return "warning";
  if (row.planState === "approved" || row.execState === "done") return "success";
  return "info";
}

/**
 * Returns whether a given action key is currently available for a row (or with no row selected).
 * @param {"approve"|"reject"|"execute"|"cancel"} action
 * @param {CockpitRow|null} row
 * @returns {boolean}
 */
export function isActionAvailable(action, row) {
  if (!row) return false;
  if (action === "approve" || action === "reject") return row.planState === "awaiting_approval";
  if (action === "execute") return row.planState === "approved" && row.execState === "not_started";
  if (action === "cancel") return row.execActive === true;
  return false;
}

/**
 * Builds the key-hint bar text for the current selection.
 * @param {CockpitRow|null} row
 * @returns {string}
 */
export function keyHintsLine(row) {
  const hints = ["up/down select", "enter view plan", "r refresh", "q quit"];
  if (isActionAvailable("approve", row)) hints.push("a approve");
  if (isActionAvailable("reject", row)) hints.push("j reject");
  if (isActionAvailable("execute", row)) hints.push("x execute");
  if (isActionAvailable("cancel", row)) hints.push("c cancel");
  return hints.join("  |  ");
}
