import { existsSync } from "node:fs";
import { readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { detectProject } from "../../project-detection.js";

const PRIVATE_PATH_PATTERNS = [
  /^\.env(\.|$)/i,
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)secrets?\//i,
  /(^|\/)credentials?\./i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)id_rsa/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.netrc$/i
];

const STABLE_DOC_CANDIDATES = [
  "AGENTS.md",
  "docs/ai/harness.md",
  "docs/ai/architecture.md",
  "docs/ai/conventions.md",
  "docs/ai/testing.md",
  "docs/ai/spec-driven-development.md",
  "docs/ai/test-driven-development.md",
  "docs/ai/provider-routing.md",
  "docs/ai/model-policy.md",
  "docs/ai/context-budget.md"
];

const DEFAULT_STABLE_BUDGET = 6000;
const DEFAULT_REQUEST_BUDGET = 4000;
const TRUNCATION_MARKER = "\n…[truncated]";

export async function compileContextPack({
  workspaceRoot,
  task = null,
  relevantPaths = [],
  includePrivate = false,
  stableBudgetTokens = DEFAULT_STABLE_BUDGET,
  requestBudgetTokens = DEFAULT_REQUEST_BUDGET
} = {}) {
  const root = resolve(workspaceRoot ?? process.cwd());
  const workspaceRealRoot = await resolveWorkspaceRoot(root);
  const project = await detectProject(root);
  const evidence = [];

  const stableBudget = createBudget(stableBudgetTokens);
  let agentsMd = null;
  const stableDocs = [];

  for (const candidate of STABLE_DOC_CANDIDATES) {
    const content = await readEvidenceFile(
      root,
      workspaceRealRoot,
      candidate,
      evidence,
      stableBudget,
      { includePrivate, category: "stable" }
    );
    if (!content) continue;
    if (candidate === "AGENTS.md") {
      agentsMd = content;
    } else {
      stableDocs.push({ path: candidate, content: content.text, truncated: content.truncated });
    }
  }

  const skills = await listSkillIds(root, evidence);
  const graphify = await detectGraphify(root, evidence);
  const engram = await detectEngramHints(root, evidence);

  const requestBudget = createBudget(requestBudgetTokens);
  const requestFiles = [];
  const seenPaths = new Set();

  for (const filePath of relevantPaths) {
    const rel = relative(root, resolve(root, filePath)).replace(/\\/g, "/") || ".";
    if (seenPaths.has(rel)) {
      evidence.push({
        kind: "deduped_path",
        path: rel,
        reason: "Duplicate path skipped"
      });
      continue;
    }
    seenPaths.add(rel);

    const content = await readEvidenceFile(
      root,
      workspaceRealRoot,
      rel,
      evidence,
      requestBudget,
      { includePrivate, category: "request" }
    );
    if (content) {
      requestFiles.push({ path: rel, content: content.text, truncated: content.truncated });
    }
  }

  const stable = {
    project: {
      name: project.name,
      purpose: project.purpose,
      stack: project.stack,
      architecturePattern: project.architecturePattern,
      packageManager: project.packageManager,
      commands: project.commands,
      detectedAdapters: project.detectedAdapters
    },
    agentsMd: agentsMd?.text ?? null,
    docs: stableDocs,
    skills,
    sdd: Boolean(stableDocs.find((doc) => doc.path.includes("spec-driven"))),
    tdd: Boolean(stableDocs.find((doc) => doc.path.includes("test-driven"))),
    graphify,
    engram
  };

  const perRequest = { task, files: requestFiles };
  const systemPrompt = buildSystemPrompt(stable, perRequest);
  const estimatedTokens = estimateTokens(systemPrompt);

  return {
    version: 1,
    workspaceRoot: root,
    stable,
    perRequest,
    evidence,
    systemPrompt,
    estimatedTokens,
    budgets: {
      stableBudgetTokens,
      requestBudgetTokens,
      stableUsedTokens: stableBudget.used,
      requestUsedTokens: requestBudget.used
    },
    privacy: {
      includePrivate,
      excludedPrivate: evidence
        .filter((entry) => entry.kind === "excluded_private")
        .map((entry) => entry.path)
    }
  };
}

export function isPrivatePath(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  return PRIVATE_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function createBudget(limitTokens) {
  return {
    limit: Math.max(0, Number(limitTokens) || 0),
    used: 0,
    remaining() {
      return Math.max(0, this.limit - this.used);
    },
    consume(tokens) {
      this.used += tokens;
    }
  };
}

async function listSkillIds(root, evidence) {
  const skillRoots = [
    join(root, "docs", "skills"),
    join(root, ".cursor", "skills"),
    join(root, ".codex", "skills"),
    join(root, ".claude", "skills")
  ];

  const ids = new Set();
  for (const skillRoot of skillRoots) {
    if (!existsSync(skillRoot)) continue;
    evidence.push({ kind: "skills_root", path: relative(root, skillRoot) });
    try {
      const entries = await readdir(skillRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) ids.add(entry.name);
      }
    } catch {
      // ignore unreadable skill roots
    }
  }

  return [...ids].sort();
}

async function detectGraphify(root, evidence) {
  const reportPath = join(root, "graphify-out", "GRAPH_REPORT.md");
  const graphPath = join(root, "graphify-out", "graph.json");
  const present = existsSync(reportPath) || existsSync(graphPath);
  if (present) {
    evidence.push({ kind: "graphify", path: "graphify-out" });
  }
  return { present, report: existsSync(reportPath), graph: existsSync(graphPath) };
}

async function detectEngramHints(root, evidence) {
  const memoryDoc = join(root, "docs", "ai", "memory.md");
  const present = existsSync(memoryDoc);
  if (present) {
    evidence.push({ kind: "engram_doc", path: "docs/ai/memory.md" });
  }
  return { documented: present };
}

async function readEvidenceFile(
  root,
  workspaceRealRoot,
  relativePath,
  evidence,
  budget,
  { includePrivate = false, category = "request" } = {}
) {
  const requested = resolve(root, relativePath);
  const requestedRelative = relative(root, requested).replace(/\\/g, "/") || ".";
  if (!isPathInside(root, requested)) {
    evidence.push({
      kind: "rejected_outside_workspace",
      path: requestedRelative,
      reason: "Path is outside workspaceRoot"
    });
    return null;
  }

  if (!existsSync(requested)) return null;

  const remaining = budget.remaining();
  if (remaining <= 0) {
    evidence.push({
      kind: "excluded_budget",
      path: requestedRelative,
      reason: `${category} budget exhausted`,
      tokens: 0
    });
    return null;
  }

  let target;
  try {
    target = await realpath(requested);
  } catch {
    evidence.push({ kind: "unreadable", path: requestedRelative });
    return null;
  }

  if (!isPathInside(workspaceRealRoot, target)) {
    evidence.push({
      kind: "rejected_outside_workspace",
      path: requestedRelative,
      reason: "Symlink target is outside workspaceRoot"
    });
    return null;
  }

  const targetRelative = relative(workspaceRealRoot, target).replace(/\\/g, "/") || ".";
  if ((isPrivatePath(requestedRelative) || isPrivatePath(targetRelative)) && !includePrivate) {
    evidence.push({
      kind: "excluded_private",
      path: requestedRelative,
      reason: "Private path excluded without consent"
    });
    return null;
  }

  try {
    const raw = await readFile(target, "utf8");
    const clipped = clipToTokenBudget(raw, remaining);
    budget.consume(clipped.tokens);
    evidence.push({
      kind: "file",
      path: requestedRelative,
      truncated: clipped.truncated,
      chars: clipped.text.length,
      tokens: clipped.tokens
    });
    return { text: clipped.text, truncated: clipped.truncated, tokens: clipped.tokens };
  } catch {
    evidence.push({ kind: "unreadable", path: requestedRelative });
    return null;
  }
}

function clipToTokenBudget(raw, maxTokens) {
  const maxChars = Math.max(0, maxTokens) * 4;
  if (raw.length <= maxChars) {
    return { text: raw, truncated: false, tokens: estimateTokens(raw) };
  }

  const marker = TRUNCATION_MARKER;
  if (marker.length >= maxChars) {
    const text = marker.slice(0, maxChars);
    return { text, truncated: true, tokens: estimateTokens(text) };
  }

  const bodyChars = maxChars - marker.length;
  const text = `${raw.slice(0, bodyChars)}${marker}`;
  return {
    text,
    truncated: true,
    tokens: estimateTokens(text)
  };
}

async function resolveWorkspaceRoot(root) {
  try {
    return await realpath(root);
  } catch {
    return root;
  }
}

function isPathInside(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${requirePathSeparator()}`));
}

function requirePathSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}

function buildSystemPrompt(stable, perRequest) {
  const lines = [
    "You are assisting inside Kairo Runtime harness governance.",
    "Prefer architecture before implementation, existing patterns, minimal diffs, tests/specs.",
    "Do not invent speculative code, unnecessary dependencies, or duplicate abstractions.",
    "Never request or echo secrets. Private files require explicit human consent.",
    "",
    "## Project",
    `Name: ${stable.project.name}`,
    `Purpose: ${stable.project.purpose}`,
    `Stack: ${stable.project.stack}`,
    `Architecture: ${stable.project.architecturePattern}`,
    `Package manager: ${stable.project.packageManager}`,
    `Commands: ${JSON.stringify(stable.project.commands)}`,
    `Adapters: ${(stable.project.detectedAdapters ?? []).join(", ") || "none"}`,
    ""
  ];

  if (stable.agentsMd) {
    lines.push("## AGENTS.md", stable.agentsMd, "");
  }

  if (stable.docs.length > 0) {
    lines.push("## Stable docs");
    for (const doc of stable.docs) {
      lines.push(`### ${doc.path}`, doc.content, "");
    }
  }

  if (stable.skills.length > 0) {
    lines.push(`## Skills available: ${stable.skills.join(", ")}`, "");
  }

  lines.push(
    `## SDD: ${stable.sdd ? "documented" : "not detected"}`,
    `## TDD: ${stable.tdd ? "documented" : "not detected"}`,
    `## Graphify: ${stable.graphify.present ? "present" : "absent"}`,
    `## Engram docs: ${stable.engram.documented ? "present" : "absent"}`,
    ""
  );

  if (perRequest.task) {
    lines.push("## Task", perRequest.task, "");
  }

  if (perRequest.files.length > 0) {
    lines.push("## Relevant files");
    for (const file of perRequest.files) {
      lines.push(`### ${file.path}`, file.content, "");
    }
  }

  return lines.join("\n");
}
