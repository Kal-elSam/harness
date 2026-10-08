/**
 * Strict verified-write containment floor for delegated runs.
 *
 * Applied ONLY when callers opt in (`requireVerifiedWriteContainment: true`).
 * Ordinary startRun / prepareRun paths do not call this — no incidental block.
 *
 * Under the strict floor:
 * - Only `verified_effective` may launch (source_declared ≠ verified).
 * - force/yolo (and aliases) are rejected even with unsafe consent.
 * - Failure is throw / no run — never a fabricated WorkResult.
 *
 * Separate from Bootstrap Analysis isolation (sandbox-exec).
 */
import { normalizePermissions } from "./run-permissions.js";

export const WRITE_CONTAINMENT_STATUS = Object.freeze({
  /** Empirically proven effective workspace write floor — sole launch status under the strict floor. */
  VERIFIED_EFFECTIVE: "verified_effective",
  /** Adapter source maps normal launch to a write sandbox — evidence only, NOT admission under the strict floor. */
  SOURCE_DECLARED: "source_declared",
  /** No declared workspace write floor. */
  UNVERIFIED: "unverified",
  /** Adapter only supports read-only / review. */
  READ_ONLY_ONLY: "read_only_only"
});

const UNSAFE_BYPASS = new Set(["force", "yolo"]);

/**
 * @typedef {object} DelegatedWriteAdmissionEntry
 * @property {string} adapterId
 * @property {string} status
 * @property {boolean} verifiedEffective
 * @property {string[]} conditions
 * @property {string} evidence
 * @property {string|null} blockedReason
 */

/** @type {Readonly<Record<string, DelegatedWriteAdmissionEntry>>} */
export const DELEGATED_WRITE_ADMISSION = Object.freeze({
  codex: Object.freeze({
    adapterId: "codex",
    status: WRITE_CONTAINMENT_STATUS.SOURCE_DECLARED,
    verifiedEffective: false,
    conditions: Object.freeze([
      "effective canary: in-cwd write succeeds; absolute path outside cwd denied",
      "auto-approval / native config behavior accounted for in that canary",
      "under the strict floor: no force/yolo bypass even with consent",
      "source_declared --approve-for-me (provider workspace-write) mapping is not sufficient alone"
    ]),
    evidence:
      "source mapping only today: execution-adapters/codex.js → --approve-for-me "
      + "(installed CLI workspace-write posture; see test/codex-execution-adapter.test.js). "
      + "No verified_effective canary recorded yet. OS wrap helpers in codex-delegated-sandbox.js "
      + "are unevaluated for admission.",
    blockedReason:
      "Codex write containment is source_declared only — not verified_effective; strict floor will not launch"
  }),
  claude: Object.freeze({
    adapterId: "claude",
    status: WRITE_CONTAINMENT_STATUS.UNVERIFIED,
    verifiedEffective: false,
    conditions: Object.freeze([]),
    evidence: "no declared workspace-write floor on buildClaudeLaunch",
    blockedReason:
      "Claude has no verified_effective workspace write containment for the strict floor"
  }),
  cursor: Object.freeze({
    adapterId: "cursor",
    status: WRITE_CONTAINMENT_STATUS.UNVERIFIED,
    verifiedEffective: false,
    conditions: Object.freeze([]),
    evidence: "no declared workspace-write sandbox mapping on cursor-agent launch",
    blockedReason:
      "Cursor has no verified_effective workspace write containment for the strict floor"
  }),
  opencode: Object.freeze({
    adapterId: "opencode",
    status: WRITE_CONTAINMENT_STATUS.UNVERIFIED,
    verifiedEffective: false,
    conditions: Object.freeze([]),
    evidence: "no declared workspace-write sandbox mapping on opencode run",
    blockedReason:
      "OpenCode has no verified_effective workspace write containment for the strict floor"
  }),
  pi: Object.freeze({
    adapterId: "pi",
    status: WRITE_CONTAINMENT_STATUS.READ_ONLY_ONLY,
    verifiedEffective: false,
    conditions: Object.freeze([
      "ordinary read-only runs use permissions [\"read-only\"] outside this strict write floor"
    ]),
    evidence: "ADAPTER_PERMISSION_MODES.pi = [read-only]",
    blockedReason:
      "Pi is read_only_only — not eligible for the strict authorized-write floor"
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
 * Strict floor assert — call only when requireVerifiedWriteContainment is true.
 * source_declared is never treated as verified_effective.
 */
export function assertDelegatedWriteAdmission(agentId, {
  cwd = null,
  permissions = []
} = {}) {
  const entry = getDelegatedWriteAdmission(agentId);
  const normalized = normalizePermissions(permissions);

  if (normalized.some((token) => UNSAFE_BYPASS.has(token))) {
    throw new DelegatedWriteAdmissionError(
      `Strict verified-write floor forbids force/yolo bypass on "${entry.adapterId}" `
      + "(even with --allow-unsafe-permissions / cockpit unsafe confirm).",
      {
        code: "delegated_write_bypass_forbidden",
        details: {
          adapterId: entry.adapterId,
          status: entry.status,
          verifiedEffective: entry.verifiedEffective,
          permissions: normalized
        }
      }
    );
  }

  if (typeof cwd !== "string" || cwd.trim() === "") {
    throw new DelegatedWriteAdmissionError(
      `Strict verified-write floor for "${entry.adapterId}" requires a non-empty cwd.`,
      {
        code: "delegated_write_admission_cwd_required",
        details: { adapterId: entry.adapterId, status: entry.status }
      }
    );
  }

  const isVerified = entry.status === WRITE_CONTAINMENT_STATUS.VERIFIED_EFFECTIVE
    && entry.verifiedEffective === true;

  if (!isVerified) {
    throw new DelegatedWriteAdmissionError(
      entry.blockedReason
        ?? `Strict verified-write floor denied "${entry.adapterId}" `
        + `(status=${entry.status}; source_declared is not verified_effective).`,
      {
        code: "delegated_write_admission_denied",
        details: {
          adapterId: entry.adapterId,
          status: entry.status,
          verifiedEffective: entry.verifiedEffective === true,
          requireVerifiedWriteContainment: true
        }
      }
    );
  }

  return {
    ...entry,
    launchKind: "authorized_write_verified",
    verifiedEffective: true
  };
}
