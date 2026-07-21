import {
  REVIEW_SEVERITIES,
  ReviewSnapshotError,
  assertReviewPathSafe,
  createFindingId
} from "./review-types.js";

export const REVIEW_VALIDATION_ERROR_CODES = Object.freeze({
  INVALID_OUTPUT: "invalid_output",
  INVALID_FINDING: "invalid_finding",
  PATH_OUT_OF_SCOPE: "path_out_of_scope"
});

const SEVERITY_SET = new Set(Object.values(REVIEW_SEVERITIES));
const FORBIDDEN_RECEIPT_KEYS = new Set([
  "prompt", "diff", "transcript", "raw", "rawOutput", "stdout", "stderr"
]);

export class ReviewValidationError extends Error {
  constructor(message, { code, details = null } = {}) {
    super(message);
    this.name = "ReviewValidationError";
    this.code = code;
    this.details = details;
  }
}

function asObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReviewValidationError(`Invalid ${label}: expected object.`, {
      code: REVIEW_VALIDATION_ERROR_CODES.INVALID_OUTPUT
    });
  }
  return value;
}

function normalizeLine(line) {
  if (line == null || line === "") return null;
  if (!Number.isInteger(line) || line < 1) {
    throw new ReviewValidationError(`Invalid finding line "${line}".`, {
      code: REVIEW_VALIDATION_ERROR_CODES.INVALID_FINDING,
      details: { line }
    });
  }
  return line;
}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ReviewValidationError(`Finding missing ${field}.`, {
      code: REVIEW_VALIDATION_ERROR_CODES.INVALID_FINDING,
      details: { field }
    });
  }
  return value.trim();
}

/**
 * Fail-closed parse of agent review JSON against a snapshot scope.
 * Never accepts paths outside snapshot.files.
 */
export function validateReviewOutput(raw, snapshot) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ReviewValidationError(`Broken review JSON: ${error.message}`, {
        code: REVIEW_VALIDATION_ERROR_CODES.INVALID_OUTPUT
      });
    }
  }

  const body = asObject(parsed, "review output");
  const findingsIn = Array.isArray(body.findings) ? body.findings : null;
  if (!findingsIn) {
    throw new ReviewValidationError("Review output missing findings array.", {
      code: REVIEW_VALIDATION_ERROR_CODES.INVALID_OUTPUT
    });
  }

  const allowed = new Set((snapshot?.files ?? []).map((f) => f.path));
  const findings = [];

  for (const entry of findingsIn) {
    const item = asObject(entry, "finding");
    const severity = requireNonEmptyString(item.severity, "severity").toLowerCase();
    if (!SEVERITY_SET.has(severity)) {
      throw new ReviewValidationError(`Unknown severity "${item.severity}".`, {
        code: REVIEW_VALIDATION_ERROR_CODES.INVALID_FINDING,
        details: { severity: item.severity }
      });
    }

    let path;
    try {
      path = assertReviewPathSafe(requireNonEmptyString(item.path, "path"));
    } catch (error) {
      if (error instanceof ReviewSnapshotError) {
        throw new ReviewValidationError(error.message, {
          code: REVIEW_VALIDATION_ERROR_CODES.INVALID_FINDING,
          details: error.details
        });
      }
      throw error;
    }

    if (!allowed.has(path)) {
      throw new ReviewValidationError(`Finding path "${path}" is outside the review snapshot.`, {
        code: REVIEW_VALIDATION_ERROR_CODES.PATH_OUT_OF_SCOPE,
        details: { path }
      });
    }

    const title = requireNonEmptyString(item.title, "title");
    const problem = requireNonEmptyString(item.problem, "problem");
    const recommendation = requireNonEmptyString(item.recommendation, "recommendation");
    const line = normalizeLine(item.line);
    const id = createFindingId({ severity, title, path, line, problem });

    findings.push({ id, severity, title, path, line, problem, recommendation });
  }

  const warnings = Array.isArray(body.warnings)
    ? body.warnings.filter((w) => typeof w === "string" && w.trim()).map((w) => w.trim())
    : [];

  return {
    findings,
    warnings,
    model: typeof body.model === "string" ? body.model : null,
    usage: sanitizeUsage(body.usage)
  };
}

function sanitizeUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  return {
    inputTokens: Number.isFinite(usage.inputTokens) ? usage.inputTokens : null,
    outputTokens: Number.isFinite(usage.outputTokens) ? usage.outputTokens : null,
    totalTokens: Number.isFinite(usage.totalTokens) ? usage.totalTokens : null,
    cost: Number.isFinite(usage.cost) ? usage.cost : null
  };
}

/** Strip forbidden keys before persistence. */
export function assertReceiptSecretFree(receipt) {
  const body = asObject(receipt, "receipt");
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_RECEIPT_KEYS.has(key)) {
      throw new ReviewValidationError(`Receipt must not include "${key}".`, {
        code: REVIEW_VALIDATION_ERROR_CODES.INVALID_OUTPUT,
        details: { key }
      });
    }
  }
  return body;
}
