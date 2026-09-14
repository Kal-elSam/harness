// The real Bootstrap Analyst step: a chosen real model actually reads the
// project (via askProvider — the same real, read-only, no-file-write path
// ASK mode already uses; never a new execution surface) and returns a
// structured ProjectAnalysis, validated against a real schema before
// anything downstream trusts it. An invalid or unparseable response is
// rejected outright — no ProjectStrategy is ever built from it.
//
// The deterministic step (deriveRoleRequirements) then turns that
// validated analysis into real RoleNeed[] — sanitized against the known
// capability vocabulary, unioned with the project's own mechanical floor
// (real test/lint/build commands, already computed by project-profile.js)
// so a thin or low-confidence analysis can never leave the project with
// literally zero real role requirements.

export const PROJECT_ANALYSIS_SCHEMA = "kairo.project-analysis/v1";

// The only real capabilities the scoring engine (capability-scoring.js)
// actually understands — any other token in the analyst's own output is
// dropped rather than trusted, so a hallucinated capability name can never
// corrupt scoring (worst case: a role with zero recognized capabilities
// simply never activates — fails closed, not open).
const KNOWN_CAPABILITIES = new Set(["reasoning", "coding", "terminalExecution", "softwareExecution", "instructionFollowing"]);
const KNOWN_ROLES = new Set(["Explorer", "Architect", "Builder", "Debugger", "Tester", "Reviewer"]);

/**
 * The real, limited context package the Bootstrap Analyst receives — never
 * the whole repo dumped in, and never anything the analyst could mistake
 * for permission to write: just what project-profile.js already collected
 * read-only (stack, real build/test/lint commands, real git hotspots,
 * real workflow docs present). The analyst can still read further real
 * files on its own (it runs inside `cwd`), but this is its starting brief.
 * @param {object} profile - computeProjectProfile() result
 * @returns {string}
 */
export function buildAnalystPrompt(profile) {
  const lines = [
    "You are Kairo's Bootstrap Analyst. Investigate this real project, READ-ONLY — never propose or make any file change.",
    "You may read real files in this working directory to inform your answer, but do not modify anything.",
    "",
    "## Known real evidence",
    `Project: ${profile.projectName}`,
    `Stack: ${profile.stack.join(", ") || "unknown"}`,
    `Architecture pattern: ${profile.architecture?.pattern ?? "unknown"}`,
    `Build command: ${profile.quality.buildCommand ?? "none detected"}`,
    `Test command: ${profile.quality.testCommand ?? "none detected"}`,
    `Lint/typecheck: ${profile.quality.lintCommand ?? profile.quality.typeCheckCommand ?? "none detected"}`,
    `Real git hotspots (most-changed files, last 90 days): ${profile.hotspots.map((h) => h.path).join(", ") || "none"}`,
    `Workflow docs present: ${profile.workflowCapabilities.join(", ") || "none"}`,
    `Known risks: ${profile.risks.map((r) => r.detail).join("; ") || "none"}`,
    "",
    "## Task",
    "Respond with ONLY one JSON object (no prose, no markdown fences) matching exactly this shape:",
    JSON.stringify({
      architectureTraits: ["string"], complexitySignals: ["string"], criticalAreas: ["string"],
      contextNeeds: ["string"], workflowNeeds: ["string"],
      recommendedRoleNeeds: [{
        role: "Explorer|Architect|Builder|Debugger|Tester|Reviewer",
        capabilities: ["reasoning|coding|terminalExecution|softwareExecution|instructionFollowing"],
        reason: "string", evidence: ["real file path you actually read that supports THIS role need"]
      }],
      uncertainties: ["string"], evidenceReferences: ["string"]
    }, null, 2),
    "",
    "Every field must reflect something you actually observed in this project — never invent a trait, risk, or role need you have no real evidence for. If you're not sure about something, put it in `uncertainties` instead of guessing.",
    "Each recommendedRoleNeeds entry's own `evidence` must list the real file path(s) you actually read that support THAT SPECIFIC role need — a role need with no real evidence of its own will be discarded, even if other fields in this response are well-supported."
  ];
  return lines.join("\n");
}

/**
 * Extracts and validates a ProjectAnalysis from the analyst's raw text
 * response. Fails closed: any parse failure or shape mismatch returns
 * `{valid: false}`, never a partially-trusted guess.
 * @param {string} rawText
 * @returns {{valid: true, analysis: object}|{valid: false, error: string}}
 */
export function parseProjectAnalysis(rawText) {
  const match = String(rawText ?? "").match(/\{[\s\S]*\}/);
  if (!match) return { valid: false, error: "No JSON object found in the analyst's response." };
  let parsed;
  try {
    parsed = JSON.parse(match[0]);
  } catch (error) {
    return { valid: false, error: `Analyst response is not valid JSON: ${error.message}` };
  }
  const arrayFields = ["architectureTraits", "complexitySignals", "criticalAreas", "contextNeeds", "workflowNeeds", "uncertainties", "evidenceReferences"];
  for (const field of arrayFields) {
    if (!Array.isArray(parsed[field])) return { valid: false, error: `Missing or invalid real array field "${field}".` };
  }
  if (!Array.isArray(parsed.recommendedRoleNeeds)) return { valid: false, error: 'Missing or invalid real array field "recommendedRoleNeeds".' };
  for (const need of parsed.recommendedRoleNeeds) {
    if (typeof need?.role !== "string" || !Array.isArray(need.capabilities)) {
      return { valid: false, error: "Each recommendedRoleNeeds entry needs a real role (string) and capabilities (array)." };
    }
  }
  return {
    valid: true,
    analysis: {
      schema: PROJECT_ANALYSIS_SCHEMA,
      architectureTraits: parsed.architectureTraits.map(String),
      complexitySignals: parsed.complexitySignals.map(String),
      criticalAreas: parsed.criticalAreas.map(String),
      contextNeeds: parsed.contextNeeds.map(String),
      workflowNeeds: parsed.workflowNeeds.map(String),
      // `evidence` defaults to an empty array when the analyst omits it —
      // never invented, and a role need with no evidence of its own
      // fails the real per-entry gate in deriveRoleRequirements below,
      // exactly as if it had cited nothing real.
      recommendedRoleNeeds: parsed.recommendedRoleNeeds.map((need) => ({
        role: String(need.role), capabilities: need.capabilities.map(String),
        reason: typeof need.reason === "string" ? need.reason : null,
        evidence: Array.isArray(need.evidence) ? need.evidence.map(String) : []
      })),
      uncertainties: parsed.uncertainties.map(String),
      evidenceReferences: parsed.evidenceReferences.map(String)
    }
  };
}

function normalizePath(path) {
  return String(path ?? "").trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * Whether a single cited path corresponds to a real file the analyst
 * actually had access to (the sanitized snapshot's real copied-file
 * list) — a citation to a path that was never even in the snapshot is a
 * real, checkable signal the analyst may be describing exploration it
 * didn't actually do, not evidence it observed. Matching is real-path-
 * based but tolerant of how a model might phrase a reference (a leading
 * "./", or citing just the tail of a longer real path) — an exact
 * string mismatch alone never disqualifies a real match.
 * @param {string} reference
 * @param {string[]} realFilePaths
 * @returns {boolean}
 */
function referenceMatchesRealFile(reference, realFilePaths) {
  const ref = normalizePath(reference);
  if (!ref) return false;
  return realFilePaths.some((path) => path === ref || path.endsWith(`/${ref}`) || ref.endsWith(`/${path}`));
}

/**
 * Checks which of a list of citations correspond to a real file — used
 * both for the analysis's own top-level evidenceReferences (informational)
 * and, per-entry, for each recommendedRoleNeeds' own `evidence` (see
 * deriveRoleRequirements, which is the one that actually gates on this).
 * @param {string[]} references
 * @param {string[]} realFilePaths - the sanitized snapshot's real copiedFiles
 * @returns {{verified: string[], unverified: string[]}}
 */
export function validateReferences(references, realFilePaths) {
  const real = realFilePaths.map(normalizePath);
  const verified = [];
  const unverified = [];
  for (const raw of references) {
    (referenceMatchesRealFile(raw, real) ? verified : unverified).push(raw);
  }
  return { verified, unverified };
}

/** Back-compat alias — validates the analysis's own top-level evidenceReferences. @deprecated prefer validateReferences for the per-RoleNeed gate in deriveRoleRequirements. */
export function validateEvidenceReferences(analysis, realFilePaths) {
  return validateReferences(analysis.evidenceReferences, realFilePaths);
}

/**
 * Deterministically derives real roleRequirements from a validated
 * ProjectAnalysis, unioned with the project's own mechanical floor (real
 * build/test/lint commands — see project-profile.js's detectRoleRequirements)
 * so a thin or low-confidence analysis can never leave a real project with
 * zero role requirements. The analyst's own role/capability tokens are
 * sanitized against the known vocabulary first — an unrecognized one is
 * dropped, never trusted as-is.
 *
 * Evidence is checked PER role need, not once for the whole analysis: a
 * recommendedRoleNeeds entry is only trusted when at least one of ITS OWN
 * `evidence` citations verifies against a real file the analyst actually
 * had access to — a single well-evidenced role need can no longer
 * "vouch for" every other, unrelated role need in the same response.
 * @param {object} analysis - parseProjectAnalysis().analysis
 * @param {Array<{role: string, capabilities: string[], reason: string}>} mechanicalFloor - profile.roleRequirements (the pre-existing command-based detection)
 * @param {string[]} [realFilePaths] - the sanitized snapshot's real copiedFiles; omit only when no real file list is available (falls back to trusting each role need's vocabulary alone, matching this function's pre-sanitized-snapshot behavior)
 * @returns {Array<{role: string, capabilities: string[], reason: string}>}
 */
export function deriveRoleRequirements(analysis, mechanicalFloor, realFilePaths = null) {
  const byRole = new Map(mechanicalFloor.map((requirement) => [requirement.role, { ...requirement }]));
  for (const need of analysis.recommendedRoleNeeds) {
    if (!KNOWN_ROLES.has(need.role)) continue;
    const capabilities = need.capabilities.filter((c) => KNOWN_CAPABILITIES.has(c));
    if (!capabilities.length) continue;
    // Real-evidence-per-recommendation gate: this specific role need is
    // only trusted when it cites at least one real file of its own.
    if (realFilePaths && !(need.evidence ?? []).some((ref) => referenceMatchesRealFile(ref, realFilePaths))) continue;
    const existing = byRole.get(need.role);
    if (existing) {
      existing.capabilities = [...new Set([...existing.capabilities, ...capabilities])];
      existing.reason = `${existing.reason} Bootstrap Analyst: ${need.reason ?? "real project analysis"}.`;
    } else {
      byRole.set(need.role, { role: need.role, capabilities, reason: `Bootstrap Analyst: ${need.reason ?? "real project analysis"}.` });
    }
  }
  return [...byRole.values()];
}
