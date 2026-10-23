// A real, local, pattern-based secret scanner — never network I/O, never
// a provider call. This is the local step of "repo real -> escaneo local
// de secretos -> snapshot temporal sanitizado -> analista sobre snapshot
// read-only": nothing containing a matched secret should ever reach a
// remote model provider unredacted.
//
// Honest limitation, stated plainly rather than implied: pattern/regex
// matching (the same approach tools like gitleaks/detect-secrets use)
// catches well-known secret SHAPES and generic "key/secret/token =
// <long string>" assignments — it does NOT catch every possible secret
// (a custom internal token format with no recognizable shape can still
// slip through). This is a real, meaningful reduction in exposure, never
// a guarantee of zero leakage — treat it as a mandatory floor, not a
// substitute for the user's own judgment about what's sensitive.

const SECRET_PATTERNS = [
  { name: "aws-access-key-id", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "google-api-key", pattern: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "github-token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "slack-token", pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/g },
  { name: "private-key-block", pattern: /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g },
  { name: "jwt", pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // The generic catch-all: a variable/key name that reads like a secret,
  // assigned a long opaque string — this is what actually catches a
  // hardcoded provider key (Azure, OpenAI, a custom API key) with no
  // other recognizable shape, which is exactly what the real crm finding was.
  { name: "generic-credential-assignment", pattern: /(?:api[_-]?key|secret|token|password|passwd|credential|auth[_-]?key)\s*[:=]\s*["']([A-Za-z0-9_\-/+=]{16,})["']/gi }
];

/**
 * Scans real text content for known secret shapes. Never mutates, never
 * touches disk — pure, so it's cheap to run over every file a sanitized
 * snapshot is about to include.
 * @param {string} text
 * @returns {Array<{name: string, index: number, length: number}>}
 */
export function scanTextForSecrets(text) {
  const findings = [];
  for (const { name, pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      findings.push({ name, index: match.index, length: match[0].length });
      if (match[0].length === 0) pattern.lastIndex += 1; // guard against zero-width matches looping forever
    }
  }
  return findings;
}

/**
 * Replaces every matched secret span with a fixed-width redaction marker
 * (never a value derived from the real secret, and never just deleted —
 * deleting could shift surrounding real code in a way that misleads the
 * analyst about the file's real structure).
 * @param {string} text
 * @returns {{text: string, redactedCount: number}}
 */
export function redactSecrets(text) {
  const findings = scanTextForSecrets(text).sort((a, b) => a.index - b.index);
  if (!findings.length) return { text, redactedCount: 0 };
  let result = "";
  let cursor = 0;
  for (const finding of findings) {
    if (finding.index < cursor) continue; // overlapping match already covered
    result += text.slice(cursor, finding.index);
    result += "[REDACTED-SECRET]";
    cursor = finding.index + finding.length;
  }
  result += text.slice(cursor);
  return { text: result, redactedCount: findings.length };
}
