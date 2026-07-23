import { createHash } from "node:crypto";

export const REVIEW_SCOPE_MODES = Object.freeze({
  WORKING_TREE: "working-tree", BASE: "base", COMMIT: "commit"
});
export const REVIEW_SEVERITIES = Object.freeze({ HIGH: "high", MEDIUM: "medium", LOW: "low" });
export const REVIEW_STATES = Object.freeze({
  COMPLETED: "completed", FAILED: "failed", STALE: "stale", INVALID: "invalid"
});
export const REVIEW_EXIT_CODES = Object.freeze({ OK: 0, THRESHOLD: 1, ERROR: 2 });
export const REVIEW_AGENTS = Object.freeze({ CODEX: "codex", PI: "pi" });
export const REVIEW_LIMITS = Object.freeze({
  MAX_FILES: 100, MAX_CHANGED_LINES: 400, MAX_DIFF_BYTES: 256 * 1024
});
export const REVIEW_SNAPSHOT_ERROR_CODES = Object.freeze({
  NOT_A_GIT_REPO: "not_a_git_repo",
  INVALID_REF: "invalid_ref",
  INVALID_SCOPE: "invalid_scope",
  INVALID_PATH: "invalid_path",
  LIMIT_EXCEEDED: "limit_exceeded",
  PRIVATE_CONSENT_REQUIRED: "private_consent_required"
});

export class ReviewSnapshotError extends Error {
  constructor(message, { code, details = null } = {}) {
    super(message);
    this.name = "ReviewSnapshotError";
    this.code = code;
    this.details = details;
  }
}

export function resolveReviewScopeMode({ base = null, commit = null } = {}) {
  if (base && commit) {
    throw new ReviewSnapshotError("--base and --commit are mutually exclusive.", {
      code: REVIEW_SNAPSHOT_ERROR_CODES.INVALID_SCOPE
    });
  }
  if (base) return REVIEW_SCOPE_MODES.BASE;
  if (commit) return REVIEW_SCOPE_MODES.COMMIT;
  return REVIEW_SCOPE_MODES.WORKING_TREE;
}

export function createFindingId({ severity, title, path, line = null, problem }) {
  return createHash("sha256")
    .update([severity, title, path, line ?? "", problem].map(String).join("\0"))
    .digest("hex")
    .slice(0, 16);
}

export function canonicalFingerprint(parts) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

const PRIVATE_PATH_PATTERNS = [
  /^\.env(\.|$)/i, /(^|\/)\.env(\.|$)/i, /(^|\/)secrets?\//i, /(^|\/)credentials?\./i,
  /\.pem$/i, /\.key$/i, /(^|\/)id_rsa/i, /(^|\/)\.npmrc$/i, /(^|\/)\.netrc$/i
];

export function isReviewPrivatePath(relativePath) {
  return PRIVATE_PATH_PATTERNS.some((p) => p.test(String(relativePath ?? "").replace(/\\/g, "/")));
}

export function isBinaryContent(buffer) {
  return Buffer.isBuffer(buffer) && buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

export function assertReviewPathSafe(relativePath) {
  const raw = String(relativePath ?? "");
  const normalized = raw.replace(/\\/g, "/");
  if (
    !normalized || normalized.startsWith("/") || normalized.includes("\0")
    || normalized.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new ReviewSnapshotError(`Unsafe review path "${raw}".`, {
      code: REVIEW_SNAPSHOT_ERROR_CODES.INVALID_PATH, details: { path: raw }
    });
  }
  return normalized;
}

export function assertWithinReviewLimits({
  fileCount, changedLines, diffBytes, limits = REVIEW_LIMITS
} = {}) {
  const reasons = [];
  if (fileCount > limits.MAX_FILES) reasons.push(`files ${fileCount} > ${limits.MAX_FILES}`);
  if (changedLines > limits.MAX_CHANGED_LINES) {
    reasons.push(`changed lines ${changedLines} > ${limits.MAX_CHANGED_LINES}`);
  }
  if (diffBytes > limits.MAX_DIFF_BYTES) {
    reasons.push(`diff bytes ${diffBytes} > ${limits.MAX_DIFF_BYTES}`);
  }
  if (reasons.length === 0) return;
  throw new ReviewSnapshotError(`Review scope exceeds fail-closed limits (${reasons.join("; ")}).`, {
    code: REVIEW_SNAPSHOT_ERROR_CODES.LIMIT_EXCEEDED,
    details: { fileCount, changedLines, diffBytes, limits, reasons }
  });
}

export function requirePrivateConsent({
  includePrivate = false, privateConfirmed = false, privatePaths = []
} = {}) {
  if (!includePrivate || privatePaths.length === 0 || privateConfirmed) return;
  throw new ReviewSnapshotError(
    "Including private paths requires explicit consent (--include-private with --yes/--confirm, or interactive confirmation).",
    { code: REVIEW_SNAPSHOT_ERROR_CODES.PRIVATE_CONSENT_REQUIRED, details: { privatePaths } }
  );
}
