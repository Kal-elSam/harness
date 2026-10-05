/**
 * Prelaunch admission for productive delegated runs with authorized writes.
 * Separate from Bootstrap Analysis isolation (sandbox-exec / verified reads).
 *
 * Policy (product): writes may occur inside the bound cwd/worktree; outside is
 * forbidden. Permission tokens ≠ containment evidence. Unverified write-floor
 * adapters are not launched. Source-declared floors may launch only when their
 * listed conditions hold; they are not Bootstrap-class verified_effective.
 *
 * Kernel WorkResult stays a result seam — admission failure is throw / no run,
 * never a fabricated WorkResult.
 */
import { normalizePermissions } from "./run-permissions.js";

export const WRITE_CONTAINMENT_STATUS = Object.freeze({
  /** Empirically proven effective workspace write floor (none yet). */
  VERIFIED_EFFECTIVE: "verified_effective",
  /** Adapter source maps normal launch to an explicit workspace write sandbox. */
  SOURCE_DECLARED: "source_declared",
  /** No declared workspace write floor for productive implementation. */
  UNVERIFIED: "unverified",
  /** Adapter only supports read-only / review — not authorized-write runs. */
  READ_ONLY_ONLY: "read_only_only"
});

/**
 * @typedef {object} DelegatedWriteAdmissionEntry
 * @property {string} adapterId
 * @property {string} status
 * @property {boolean} mayLaunchAuthorizedWrite
 * @property {boolean} verifiedEffective
 * @property {string[]} conditions
 * @property {string} evidence
 * @property {string} blockedReason
 */

/** @type {Readonly<Record<string, DelegatedWriteAdmissionEntry>>} */
export const DELEGATED_WRITE_ADMISSION = Object.freeze({
  codex: Object.freeze({
    adapterId: "codex",
    status: WRITE_CONTAINMENT_STATUS.SOURCE_DECLARED,
    mayLaunchAuthorizedWrite: true,
    verifiedEffective: false,
    conditions: Object.freeze([
      "cwd is a non-empty string (project or execution worktree treePath)",
      "empty/normal permissions map to --sandbox workspace-write --approve-for-me",
      "yolo / dangerously-* requires allowUnsafePermissions (or cockpit unsafe confirm)",
      "must not claim Bootstrap sandbox-exec / verified isolation evidence"
    ]),
    evidence:
      "src/global/runtime/execution-adapters/codex.js buildCodexPermissionsArgs; "
      + "test/codex-execution-adapter.test.js; test/delegated-execution-containment.test.js",
    blockedReason: null
  }),
  claude: Object.freeze({
    adapterId: "claude",
    status: WRITE_CONTAINMENT_STATUS.UNVERIFIED,
    mayLaunchAuthorizedWrite: false,
    verifiedEffective: false,
    conditions: Object.freeze([]),
    evidence:
      "buildClaudeLaunch uses --permission-mode auto without a declared workspace write floor",
    blockedReason:
      "Claude has no verified or source-declared workspace write containment for delegated implementation"
  }),
  cursor: Object.freeze({
    adapterId: "cursor",
    status: WRITE_CONTAINMENT_STATUS.UNVERIFIED,
    mayLaunchAuthorizedWrite: false,
    verifiedEffective: false,
    conditions: Object.freeze([]),
    evidence: "cursor-agent launch has no declared workspace-write sandbox mapping",
    blockedReason:
      "Cursor has no verified or source-declared workspace write containment for delegated implementation"
  }),
  opencode: Object.freeze({
    adapterId: "opencode",
    status: WRITE_CONTAINMENT_STATUS.UNVERIFIED,
    mayLaunchAuthorizedWrite: false,
    verifiedEffective: false,
    conditions: Object.freeze([]),
    evidence: "opencode run has no declared workspace-write sandbox mapping",
    blockedReason:
      "OpenCode has no verified or source-declared workspace write containment for delegated implementation"
  }),
  pi: Object.freeze({
    adapterId: "pi",
    status: WRITE_CONTAINMENT_STATUS.READ_ONLY_ONLY,
    mayLaunchAuthorizedWrite: false,
    verifiedEffective: false,
    conditions: Object.freeze([
      "read-only runs may launch with permissions [\"read-only\"] only (review / inspect)"
    ]),
    evidence: "ADAPTER_PERMISSION_MODES.pi = [read-only]; buildPiPermissionsArgs",
    blockedReason:
      "Pi supports read-only review containment only — not authorized-write delegated implementation"
  })
});

export class DelegatedWriteAdmissionError extends Error {
  constructor(message, { code = "delegated_write_admission_denied", details = null } = {}) {
    super(message);
    this.name = "DelegatedWriteAdmissionError";
    this.code = code;
    this.details = details;
  }
}

function baseAdapterId(agentId) {
  const id = String(agentId ?? "");
  if (id === "opencode" || id.startsWith("opencode-")) return "opencode";
  return id;
}

export function getDelegatedWriteAdmission(agentId) {
  const id = baseAdapterId(agentId);
  const entry = DELEGATED_WRITE_ADMISSION[id];
  if (!entry) {
    throw new DelegatedWriteAdmissionError(
      `No delegated write admission entry for adapter "${agentId}".`,
      { code: "delegated_write_admission_unknown", details: { agentId } }
    );
  }
  return entry;
}

export function listDelegatedWriteAdmissionMatrix() {
  return Object.values(DELEGATED_WRITE_ADMISSION).map((entry) => ({ ...entry }));
}

/**
 * Fail closed before spawn: unverified write floors do not launch.
 * Pi read-only is allowed as a non-write path. Codex source_declared launches
 * only when cwd is present (conditions otherwise enforced by permission authority
 * + adapter launch mapping).
 */
export function assertDelegatedWriteAdmission(agentId, {
  cwd = null,
  permissions = []
} = {}) {
  const entry = getDelegatedWriteAdmission(agentId);
  const normalized = normalizePermissions(permissions);

  if (entry.status === WRITE_CONTAINMENT_STATUS.READ_ONLY_ONLY) {
    if (normalized.length === 1 && normalized[0] === "read-only") {
      return { ...entry, launchKind: "read_only" };
    }
    throw new DelegatedWriteAdmissionError(
      entry.blockedReason
        ?? `Adapter "${entry.adapterId}" cannot launch authorized-write delegated runs.`,
      {
        code: "delegated_write_admission_denied",
        details: {
          adapterId: entry.adapterId,
          status: entry.status,
          verifiedEffective: entry.verifiedEffective,
          permissions: normalized
        }
      }
    );
  }

  if (!entry.mayLaunchAuthorizedWrite || entry.status === WRITE_CONTAINMENT_STATUS.UNVERIFIED) {
    throw new DelegatedWriteAdmissionError(
      entry.blockedReason
        ?? `Delegated write admission denied for "${entry.adapterId}" (status=${entry.status}).`,
      {
        code: "delegated_write_admission_denied",
        details: {
          adapterId: entry.adapterId,
          status: entry.status,
          verifiedEffective: entry.verifiedEffective,
          mayLaunchAuthorizedWrite: entry.mayLaunchAuthorizedWrite
        }
      }
    );
  }

  if (typeof cwd !== "string" || cwd.trim() === "") {
    throw new DelegatedWriteAdmissionError(
      `Delegated write admission for "${entry.adapterId}" requires a non-empty cwd `
      + "(project or execution worktree treePath).",
      {
        code: "delegated_write_admission_cwd_required",
        details: { adapterId: entry.adapterId, status: entry.status }
      }
    );
  }

  return {
    ...entry,
    launchKind: "authorized_write",
    verifiedEffective: entry.verifiedEffective === true
  };
}
