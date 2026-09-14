// Real, evidence-only ProjectProfile: what Kairo can actually detect about
// THIS project (stack, commands, git recency, Graphify/CodeGraph/Engram
// availability, docs) — never a value invented for a signal that couldn't
// be collected. Every heavy detector here is REUSED from where it already
// exists in this codebase (detectProject, resolveGitHeadSha, probeGraphify,
// inspectEngramIntegration) rather than reimplemented, so this module stays
// a thin composition layer, not a second copy of that logic.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { detectProject } from "../../project-detection.js";
import { resolveGitHeadSha, probeGraphify, scrubGitOverrideEnv } from "../observability/graphify-probe.js";
import { inspectEngramIntegration } from "../integrations/engram-evidence.js";

export const PROJECT_PROFILE_SCHEMA = "kairo.project-profile/v1";

const SDD_DOC = "docs/ai/spec-driven-development.md";
const TDD_DOC = "docs/ai/test-driven-development.md";
const AGENTS_DOC = "AGENTS.md";

/**
 * Real recent-history hotspots: which files changed most often in the last
 * 90 days, via `git log --name-only` — bounded, fail-soft (never throws;
 * returns an empty list for a non-git or history-less project). This is
 * the ONLY new detector this module adds rather than reusing — everything
 * else composes an existing real function.
 * @param {string} cwd
 * @returns {Array<{path: string, changes: number}>}
 */
export function detectGitHotspots(cwd, { spawn = spawnSync, timeoutMs = 5000, env = process.env, limit = 5 } = {}) {
  try {
    const cleanEnv = scrubGitOverrideEnv(env);
    const result = spawn("git", ["log", "--since=90.days", "--name-only", "--pretty=format:"], {
      cwd, encoding: "utf8", timeout: timeoutMs, env: cleanEnv, maxBuffer: 10 * 1024 * 1024
    });
    if (result.status !== 0) return [];
    const counts = new Map();
    for (const line of String(result.stdout ?? "").split("\n")) {
      const path = line.trim();
      if (!path) continue;
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([path, changes]) => ({ path, changes }));
  } catch {
    return [];
  }
}

/**
 * Real risks Kairo can actually detect — never a guessed or generic risk.
 * @param {object} project - detectProject() result
 * @param {string} root
 * @returns {Array<{kind: string, detail: string}>}
 */
function detectRisks(project, root) {
  const risks = [];
  if (project.commands.test === "Not configured") risks.push({ kind: "no-test-command", detail: "No real test script detected in package.json." });
  if (project.commands.lint === "Not configured" && project.commands.typeCheck === "Not configured") {
    risks.push({ kind: "no-static-checks", detail: "No real lint or typecheck script detected." });
  }
  if (existsSync(resolve(root, ".env"))) risks.push({ kind: "env-file-present", detail: ".env present at project root — never read into evidence without explicit consent." });
  return risks;
}

/**
 * Real, detected role requirements — derived strictly from what
 * detectProject actually found (a real build/test/lint command), never
 * from a guess about what a "typical" project needs. Explorer/Architect
 * stay baseline (every real project needs investigation + planning);
 * Builder/Tester/Reviewer only appear when their real command exists.
 * @param {object} project - detectProject() result
 * @returns {Array<{role: string, capabilities: string[], reason: string}>}
 */
function detectRoleRequirements(project) {
  const requirements = [
    { role: "Explorer", capabilities: ["reasoning", "instructionFollowing"], reason: "Baseline investigation role for every real project." },
    { role: "Architect", capabilities: ["reasoning", "coding", "instructionFollowing"], reason: "Baseline planning role for every real project." }
  ];
  if (project.commands.build !== "Not configured" || project.stack !== "Unknown") {
    requirements.push({ role: "Builder", capabilities: ["coding", "softwareExecution", "terminalExecution", "instructionFollowing"], reason: "Real stack/build command detected." });
  }
  if (project.commands.test !== "Not configured") {
    requirements.push({ role: "Tester", capabilities: ["coding", "terminalExecution"], reason: `Real test command detected: ${project.commands.test}` });
    requirements.push({ role: "Debugger", capabilities: ["reasoning", "coding", "terminalExecution", "softwareExecution"], reason: "Real test command implies real failures to debug." });
  }
  if (project.commands.lint !== "Not configured" || project.commands.typeCheck !== "Not configured") {
    requirements.push({ role: "Reviewer", capabilities: ["reasoning", "coding"], reason: "Real lint/typecheck command detected." });
  }
  return requirements;
}

/**
 * A real, deterministic fingerprint of the profile's own inputs (git HEAD
 * when available, plus the real detected commands/stack) — changes exactly
 * when the real evidence behind the profile changes, which is what
 * ProjectStrategy's STALE detection compares against. Never a random id.
 */
function computeFingerprint({ headSha, project }) {
  const basis = JSON.stringify({ headSha: headSha ?? "no-git", stack: project.stack, commands: project.commands });
  return createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

/**
 * Composes every real detector above into one ProjectProfile — strictly
 * read-only, no file writes, no provider calls. `confidence` reflects how
 * much REAL evidence was actually collected, never the profile's own
 * apparent completeness — a project with no git history and a minimal
 * package.json genuinely IS "low" confidence, not something to round up.
 * @param {{cwd: string}} args
 * @param {object} [deps] - injectable for tests
 * @returns {Promise<object>} ProjectProfile
 */
export async function computeProjectProfile({ cwd }, deps = {}) {
  const detectProjectImpl = deps.detectProject ?? detectProject;
  const resolveGitHeadShaImpl = deps.resolveGitHeadSha ?? resolveGitHeadSha;
  const probeGraphifyImpl = deps.probeGraphify ?? probeGraphify;
  const inspectEngramImpl = deps.inspectEngramIntegration ?? inspectEngramIntegration;
  const detectGitHotspotsImpl = deps.detectGitHotspots ?? detectGitHotspots;

  const root = resolve(cwd);
  const project = await detectProjectImpl(root);
  const headSha = resolveGitHeadShaImpl(root);
  const graphify = await probeGraphifyImpl({ cwd: root, headSha });
  const engram = inspectEngramImpl();
  const codegraphPresent = existsSync(resolve(root, ".codegraph"));
  const hotspots = headSha ? detectGitHotspotsImpl(root) : [];

  const sdd = existsSync(resolve(root, SDD_DOC));
  const tdd = existsSync(resolve(root, TDD_DOC));
  const agentsDoc = existsSync(resolve(root, AGENTS_DOC));

  const workflowCapabilities = [];
  if (sdd) workflowCapabilities.push("sdd");
  if (tdd) workflowCapabilities.push("tdd");

  const evidence = [
    { kind: "package-manifest", detail: `packageManager=${project.packageManager}` },
    { kind: "git-head", detail: headSha ? `HEAD=${headSha.slice(0, 12)}` : "not a git repository (or HEAD unresolved)" },
    { kind: "graphify", detail: `state=${graphify.state}` },
    { kind: "codegraph", detail: codegraphPresent ? ".codegraph/ present" : ".codegraph/ absent" },
    { kind: "engram", detail: `status=${engram.status}` },
    { kind: "agents-doc", detail: agentsDoc ? "AGENTS.md present" : "AGENTS.md absent" }
  ];

  // Real, honest tiers — never rounded up because the profile LOOKS
  // complete. High requires git history (real recency signal) AND at
  // least one real code-intelligence integration actually available.
  let confidence = "low";
  const hasCodeIntelligence = graphify.state === "available" || codegraphPresent || engram.status === "configured";
  if (headSha && project.stack !== "Unknown") {
    confidence = hasCodeIntelligence ? "high" : "medium";
  }

  return {
    schema: PROJECT_PROFILE_SCHEMA,
    projectName: project.name,
    fingerprint: computeFingerprint({ headSha, project }),
    stack: [project.stack],
    architecture: { pattern: project.architecturePattern },
    quality: {
      testCommand: project.commands.test !== "Not configured" ? project.commands.test : null,
      lintCommand: project.commands.lint !== "Not configured" ? project.commands.lint : null,
      typeCheckCommand: project.commands.typeCheck !== "Not configured" ? project.commands.typeCheck : null,
      buildCommand: project.commands.build !== "Not configured" ? project.commands.build : null
    },
    risks: detectRisks(project, root),
    hotspots,
    workflowCapabilities,
    roleRequirements: detectRoleRequirements(project),
    evidence,
    confidence
  };
}
