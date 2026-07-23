import {
  REVIEW_SEVERITIES,
  ReviewSnapshotError,
  assertReviewPathSafe,
  createFindingId
} from "./review-types.js";

export const REVIEW_VALIDATION_ERROR_CODES = Object.freeze({
  INVALID_OUTPUT: "invalid_output",
  INVALID_FINDING: "invalid_finding",
  PATH_OUT_OF_SCOPE: "path_out_of_scope",
  FORBIDDEN_FIELD: "forbidden_field",
  RECEIPT_EXISTS: "receipt_exists"
});

const SEVERITY_SET = new Set(Object.values(REVIEW_SEVERITIES));
const FORBIDDEN_KEYS = new Set([
  "prompt", "diff", "transcript", "raw", "rawOutput", "stdout", "stderr",
  "output", "message", "messages", "content", "secret", "secrets", "token", "apiKey"
]);

const RECEIPT_SHAPE = Object.freeze({
  version: "number",
  reviewId: "string",
  agentId: "string",
  model: "string?",
  state: "string",
  snapshot: {
    mode: "string",
    headSha: "string",
    base: "string?",
    commit: "string?",
    fingerprint: "string",
    totals: { fileCount: "number", changedLines: "number", diffBytes: "number" },
    files: [{ path: "string", sourcePath: "string?", status: "string", hash: "string", changedLines: "number" }],
    excluded: [{ path: "string", reason: "string" }]
  },
  findings: [{
    id: "string",
    severity: "string",
    title: "string",
    path: "string",
    line: "number?",
    problem: "string",
    recommendation: "string"
  }],
  warnings: ["string"],
  usage: {
    inputTokens: "number?",
    outputTokens: "number?",
    totalTokens: "number?",
    cost: "number?"
  },
  timings: { startedAt: "string?", finishedAt: "string?", durationMs: "number?" },
  cliVersion: "string?",
  createdAt: "string"
});

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

function isOptionalScalar(spec) {
  return typeof spec === "string" && spec.endsWith("?");
}

function scalarType(spec) {
  return isOptionalScalar(spec) ? spec.slice(0, -1) : spec;
}

function assertNoForbiddenKeys(value, path) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new ReviewValidationError(`Receipt must not include "${key}" at ${path}.`, {
        code: REVIEW_VALIDATION_ERROR_CODES.FORBIDDEN_FIELD,
        details: { key, path }
      });
    }
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

function assertMatchesShape(value, shape, path) {
  if (shape === null) {
    if (value !== null) {
      throw new ReviewValidationError(`Expected null at ${path}.`, {
        code: REVIEW_VALIDATION_ERROR_CODES.INVALID_OUTPUT, details: { path }
      });
    }
    return;
  }

  if (typeof shape === "string") {
    if (value == null) {
      if (isOptionalScalar(shape) || shape === "null") return;
      throw new ReviewValidationError(`Missing value at ${path}.`, {
        code: REVIEW_VALIDATION_ERROR_CODES.INVALID_OUTPUT, details: { path }
      });
    }
    const expected = scalarType(shape);
    if (expected === "number" && typeof value === "number" && Number.isFinite(value)) return;
    if (expected === "string" && typeof value === "string") return;
    throw new ReviewValidationError(`Invalid type at ${path}.`, {
      code: REVIEW_VALIDATION_ERROR_CODES.INVALID_OUTPUT, details: { path, expected }
    });
  }

  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) {
      throw new ReviewValidationError(`Expected array at ${path}.`, {
        code: REVIEW_VALIDATION_ERROR_CODES.INVALID_OUTPUT, details: { path }
      });
    }
    const itemShape = shape[0];
    value.forEach((entry, index) => assertMatchesShape(entry, itemShape, `${path}[${index}]`));
    return;
  }

  if (value == null) {
    // Optional object fields (usage/timings) may be null.
    return;
  }

  const body = asObject(value, path);
  const allowed = new Set(Object.keys(shape));
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw new ReviewValidationError(`Unexpected field "${key}" at ${path}.`, {
        code: REVIEW_VALIDATION_ERROR_CODES.FORBIDDEN_FIELD,
        details: { key, path }
      });
    }
  }
  for (const [key, childShape] of Object.entries(shape)) {
    if (!(key in body)) {
      throw new ReviewValidationError(`Missing field "${key}" at ${path}.`, {
        code: REVIEW_VALIDATION_ERROR_CODES.INVALID_OUTPUT, details: { path, key }
      });
    }
    assertMatchesShape(body[key], childShape, `${path}.${key}`);
  }
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
  assertNoForbiddenKeys(body, "output");
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
    assertNoForbiddenKeys(item, "finding");
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
  assertNoForbiddenKeys(usage, "usage");
  return {
    inputTokens: Number.isFinite(usage.inputTokens) ? usage.inputTokens : null,
    outputTokens: Number.isFinite(usage.outputTokens) ? usage.outputTokens : null,
    totalTokens: Number.isFinite(usage.totalTokens) ? usage.totalTokens : null,
    cost: Number.isFinite(usage.cost) ? usage.cost : null
  };
}

/** Recursive forbidden-key + allowlisted shape check before persistence. */
export function assertReceiptSecretFree(receipt) {
  const body = asObject(receipt, "receipt");
  assertNoForbiddenKeys(body, "receipt");
  assertMatchesShape(body, RECEIPT_SHAPE, "receipt");
  return body;
}
