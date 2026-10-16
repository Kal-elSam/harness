import { ROLE_REGISTRY, activateCatalogRoles } from "../intelligence/role-registry.js";
// The real Bootstrap Analyst step: a chosen real model actually reads the
// project (via askProvider — the same real, read-only, no-file-write path
// ASK mode already uses; never a new execution surface) and returns a
// structured ProjectAnalysis, validated against a real schema before
// anything downstream trusts it. An invalid or unparseable response is
// rejected outright — no ProjectStrategy is ever built from it.
//
// The deterministic step (deriveRoleRequirements) then turns that
// validated analysis into real RoleNeed[] — sanitized against the known
// capability vocabulary. Analyst-justified roles drive NEW suggested teams;
// the mechanical floor (Explorer/Architect + command-detected roles from
// project-profile.js) is only a safety net when the analyst yields zero
// valid needs, so strategy can still form. Never rewrites an ACTIVE team.

import { BOOTSTRAP_ANALYST_PROFILE, formatFocusAreas } from "./bootstrap-analyst-profile.js";
import { DEMAND_ASSESSMENT_CATEGORIES, assessmentCapabilityAdditions } from "../intelligence/role-demand.js";

// A category without any verified citation counts at most this level (S35).
const UNVERIFIED_CATEGORY_MAX_LEVEL = 2;

// v2 adds `demandAssessment` (S35). v1 responses (no assessment) still parse.
export const PROJECT_ANALYSIS_SCHEMA_V1 = "kairo.project-analysis/v1";
export const PROJECT_ANALYSIS_SCHEMA = "kairo.project-analysis/v2";

// The only real capabilities the scoring engine (capability-scoring.js)
// actually understands — any other token in the analyst's own output is
// dropped rather than trusted, so a hallucinated capability name can never
// corrupt scoring (worst case: a role with zero recognized capabilities
// simply never activates — fails closed, not open).
const KNOWN_CAPABILITIES = new Set(["reasoning", "coding", "terminalExecution", "softwareExecution", "instructionFollowing", "agenticExecution", "responseTime"]);
export const KNOWN_ROLES = new Set(Object.keys(ROLE_REGISTRY));

/**
 * The real, limited context package the Bootstrap Analyst receives — never
 * the whole repo dumped in, and never anything the analyst could mistake
 * for permission to write: just what project-profile.js already collected
 * read-only (stack, real build/test/lint commands, real git hotspots,
 * real workflow docs present). The analyst can still read further real
 * files on its own (it runs inside `cwd`), but this is its starting brief.
 * @param {object} profile - computeProjectProfile() result
 * @param {object} [analystProfile]
 * @param {string|object|null} [snapshotReport] - what the sanitized snapshot excluded (C17); included when present
 * @returns {string}
 */
export function buildAnalystPrompt(profile, analystProfile = BOOTSTRAP_ANALYST_PROFILE, snapshotReport = null) {
  const focusAreas = analystProfile.focusAreas;
  const reportText = snapshotReport == null || snapshotReport === "" ? null
    : typeof snapshotReport === "string" ? snapshotReport : JSON.stringify(snapshotReport, null, 2);
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
    ...(reportText ? ["", "## Snapshot report (what your read-only snapshot excludes)", reportText] : []),
    "",
    "## Investigation",
    `Focus areas: ${focusAreas.join(", ")}.`,
    "Before answering, investigate the real repository (read-only) for: the languages actually in use, the project structure and module boundaries, its dependencies, its constraints (tooling, runtime, compatibility, process), and its risks. " +
      `Weigh the real ${formatFocusAreas(focusAreas)} of what you read, not only file names.`,
    "Justify the team you suggest (recommendedRoleNeeds) with repo evidence: each role need must say why this project needs it and cite the real files you read.",
    "",
    "## Task",
    "Respond with ONLY one JSON object (no prose, no markdown fences) matching exactly this shape:",
    JSON.stringify({
      architectureTraits: ["string"], complexitySignals: ["string"], criticalAreas: ["string"],
      contextNeeds: ["string"], workflowNeeds: ["string"],
      recommendedRoleNeeds: [{
        role: [...KNOWN_ROLES].join("|"),
        capabilities: ["reasoning|coding|terminalExecution|softwareExecution|instructionFollowing"],
        reason: "string", evidence: ["real file path you actually read that supports THIS role need"]
      }],
      uncertainties: ["string"], evidenceReferences: ["string"],
      demandAssessment: {
        productPurpose: "short string: what the product is for, citing README/docs",
        riskCategories: Object.fromEntries(DEMAND_ASSESSMENT_CATEGORIES.map((name) => [name, { level: "integer 1-5", evidence: ["real file path you read that supports this level"] }]))
      }
    }, null, 2),
    "",
    "Every field must reflect something you actually observed in this project — never invent a trait, risk, or role need you have no real evidence for. If you're not sure about something, put it in `uncertainties` instead of guessing.",
    "",
    "## Demand assessment",
    "demandAssessment rates how demanding this product is, from what it DOES, not from its tooling: lint, tests or layered docs say nothing about demand. Rate each riskCategory 1-5 with the real files that prove it:",
    "- actionsAndSecurity: executes actions, system or OS access, permissions, auth, secrets.",
    "- money: payments, billing, financial correctness.",
    "- personalData: user or personal data handled, stored or sent out.",
    "- realtimeConcurrency: real-time behavior, concurrency, async ordering, shared state.",
    "- aiIntegration: LLM or AI calls, agent loops, model-driven decisions.",
    "- domainComplexity: depth of the business or technical domain.",
    "Level anchors: 1 = trivial static content; 2 = simple site or script with light logic; 3 = typical CRUD app; 4 = sensitive core (auth, payments, data pipelines, real-time) or an AI feature that drives behavior; 5 = autonomous agent executing system actions, or a financial core.",
    "A level of 3 or more needs at least one real file in `evidence`; a category with no verifiable citation is counted as at most level 2. Always fill productPurpose from the README/docs.",
    "If your snapshot lacks the source or docs needed to rate a category, SAY SO in `uncertainties` (name what is missing) and rate only what you can cite; never guess a high level.",
    "",
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
  const demandAssessment = parseDemandAssessment(parsed.demandAssessment);
  return {
    valid: true,
    analysis: {
      schema: demandAssessment ? PROJECT_ANALYSIS_SCHEMA : PROJECT_ANALYSIS_SCHEMA_V1,
      demandAssessment,
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

/** Shape-validates the analyst's demandAssessment; a malformed category is dropped, a malformed object yields null (never a partially-trusted guess). */
function parseDemandAssessment(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw.riskCategories;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const riskCategories = {};
  for (const name of DEMAND_ASSESSMENT_CATEGORIES) {
    const entry = source[name];
    if (!entry || !Number.isInteger(entry.level) || entry.level < 1 || entry.level > 5) continue;
    riskCategories[name] = { level: entry.level, evidence: Array.isArray(entry.evidence) ? entry.evidence.map(String) : [] };
  }
  if (!Object.keys(riskCategories).length) return null;
  return { productPurpose: typeof raw.productPurpose === "string" ? raw.productPurpose : null, riskCategories };
}

function normalizePath(path) {
  return String(path ?? "").trim().replace(/^\.\//, "").replace(/\/+$/, "");
}

/** Extract a leading citation path, without descriptions or line locators. */
function extractCitationPath(reference) {
  const leading = String(reference ?? "").trim().split(/:\s+|\s+\(|\s+[-—]\s*|\s+lines\b/i)[0];
  const path = leading.replace(/(?::\d+(?:-\d+)?|#L\d+)$/, "");
  return normalizePath(path);
}

/**
 * Whether a single cited path corresponds to a real file the analyst
 * actually had access to (the sanitized snapshot's real copied-file
 * list) — a citation to a path that was never even in the snapshot is a
 * real, checkable signal the analyst may be describing exploration it
 * didn't actually do, not evidence it observed. Matching is real-path-
 * based but tolerant of how a model might phrase a reference (a leading
 * "./", or citing just the tail of a longer real path) — an exact
 * string mismatch alone never disqualifies a real match. Descriptions and
 * trailing line locators are removed before applying the same match rule.
 * @param {string} reference
 * @param {string[]} realFilePaths
 * @returns {boolean}
 */
function referenceMatchesRealFile(reference, realFilePaths) {
  const ref = extractCitationPath(reference);
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
 * Verifies each assessed category's citations against the real snapshot files
 * (same matcher as role-need evidence). A category without a verified citation
 * counts at most level 2 (S35); low claims are never raised. Returns null when
 * there is no usable assessment, so callers fall back to the mechanical raise.
 * @param {object|null} assessment - parseProjectAnalysis().analysis.demandAssessment
 * @param {string[]|null} [realFilePaths] - snapshot copiedFiles; null trusts any non-empty citation
 * @returns {{productPurpose: string|null, categories: Record<string, {level: number, claimedLevel: number, capped: boolean, verifiedEvidence: string[], unverifiedEvidence: string[]}>}|null}
 */
export function verifyDemandAssessment(assessment, realFilePaths = null) {
  const source = assessment?.riskCategories;
  if (!source || typeof source !== "object") return null;
  const categories = {};
  for (const name of DEMAND_ASSESSMENT_CATEGORIES) {
    const entry = source[name];
    if (!entry || !Number.isInteger(entry.level) || entry.level < 1 || entry.level > 5) continue;
    const evidence = Array.isArray(entry.evidence) ? entry.evidence.map(String) : [];
    const { verified, unverified } = realFilePaths
      ? validateReferences(evidence, realFilePaths)
      : { verified: evidence.filter((ref) => ref.trim()), unverified: [] };
    const capped = verified.length === 0 && entry.level > UNVERIFIED_CATEGORY_MAX_LEVEL;
    categories[name] = {
      level: capped ? UNVERIFIED_CATEGORY_MAX_LEVEL : entry.level, claimedLevel: entry.level, capped,
      verifiedEvidence: verified, unverifiedEvidence: unverified
    };
  }
  if (!Object.keys(categories).length) return null;
  return { productPurpose: typeof assessment.productPurpose === "string" ? assessment.productPurpose : null, categories };
}

/** Adds the capabilities the verified assessment requires to roles already present (never creates a role). */
function applyAssessmentCapabilities(requirements, analysis, realFilePaths) {
  const verified = verifyDemandAssessment(analysis?.demandAssessment, realFilePaths);
  const additions = assessmentCapabilityAdditions(verified);
  if (!additions.length) return requirements;
  return requirements.map((requirement) => {
    const mine = additions.filter((addition) => addition.role === requirement.role);
    if (!mine.length) return requirement;
    const capabilities = [...new Set([...requirement.capabilities, ...mine.map((addition) => addition.capability)])];
    const note = [...new Set(mine.map((addition) => `${addition.category} ${addition.level} requires ${addition.capability}`))].join("; ");
    return { ...requirement, capabilities, reason: `${requirement.reason ? `${requirement.reason} ` : ""}Demand assessment: ${note}.` };
  });
}

/**
 * Deterministically derives real roleRequirements from a validated
 * ProjectAnalysis for a NEW suggested team build.
 *
 * Architect and Explorer are always retained from the mechanical baseline.
 * Analyst needs can extend their capabilities, never remove these roles.
 * Command- and stack-backed roles also remain; shared capabilities merge.
 * With no valid analyst needs, the full mechanical floor is retained.
 * This only affects new suggestions, never stored approved strategies.
 *
 * Evidence is checked PER role need, not once for the whole analysis: a
 * recommendedRoleNeeds entry is only trusted when at least one of ITS OWN
 * `evidence` citations verifies against a real file the analyst actually
 * had access to — a single well-evidenced role need can no longer
 * "vouch for" every other, unrelated role need in the same response.
 * @param {object} analysis - parseProjectAnalysis().analysis
 * @param {Array<{role: string, capabilities: string[], reason: string, source?: string}>} mechanicalFloor - profile.roleRequirements (the pre-existing command-based detection)
 * @param {string[]} [realFilePaths] - the sanitized snapshot's real copiedFiles; omit only when no real file list is available (falls back to trusting each role need's vocabulary alone, matching this function's pre-sanitized-snapshot behavior)
 * @returns {Array<{role: string, capabilities: string[], reason: string}>}
 */
export function deriveRoleRequirements(analysis, mechanicalFloor, realFilePaths = null) {
  const activatedFloor = activateCatalogRoles(mechanicalFloor ?? [], { demandAssessment: verifyDemandAssessment(analysis?.demandAssessment, realFilePaths) });
  const floorByRole = new Map(activatedFloor.map((requirement) => [requirement.role, { ...requirement }]));
  const byRole = new Map();
  for (const need of analysis.recommendedRoleNeeds ?? []) {
    if (!KNOWN_ROLES.has(need.role)) continue;
    const capabilities = need.capabilities.filter((c) => KNOWN_CAPABILITIES.has(c));
    if (!capabilities.length) continue;
    // Real-evidence-per-recommendation gate: this specific role need is
    // only trusted when it cites at least one real file of its own.
    if (realFilePaths && !(need.evidence ?? []).some((ref) => referenceMatchesRealFile(ref, realFilePaths))) continue;
    const floor = floorByRole.get(need.role);
    const mergedCapabilities = floor
      ? [...new Set([...floor.capabilities, ...capabilities])]
      : capabilities;
    const reason = floor
      ? `${floor.reason} Bootstrap Analyst: ${need.reason ?? "real project analysis"}.`
      : `Bootstrap Analyst: ${need.reason ?? "real project analysis"}.`;
    byRole.set(need.role, { role: need.role, capabilities: mergedCapabilities, reason });
  }
  // Empty analysis retains the full floor; valid analysis cannot remove
  // baseline investigation/planning or command-/stack-backed roles.
  if (byRole.size === 0) {
    return applyAssessmentCapabilities([...floorByRole.values()], analysis, realFilePaths);
  }
  for (const [role, floor] of floorByRole) {
    // "gap" (C17): Tester/Reviewer roles the project profile itself justified.
    if (!byRole.has(role) && (ROLE_REGISTRY[role]?.alwaysOn || ["command", "stack", "gap", "profile", "assessment"].includes(floor.source))) {
      byRole.set(role, floor);
    }
  }
  return applyAssessmentCapabilities(activateCatalogRoles([...byRole.values()]), analysis, realFilePaths);
}
