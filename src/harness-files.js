import { constants } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { renderTemplate } from "./text-template.js";

export const MODES = new Set(["minimal", "standard", "enterprise"]);

const TEXT_EXTENSIONS = new Set([".md", ".mdc", ".json", ".yml", ".yaml", ".sample", ".sh", ".mjs"]);

const MINIMAL_WHITELIST = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  "AGENT.md",
  "docs/ai/architecture.md",
  "docs/ai/harness.md",
  "docs/ai/testing.md",
  "docs/ai/git-workflow.md",
  "docs/ai/memory.md",
  "docs/ai/context-graph.md",
  ".cursor/rules/core.mdc",
  ".cursor/rules/testing.mdc",
  ".cursor/rules/git.mdc",
  ".github/copilot-instructions.md",
  "setup-agent-links.sh"
]);

const STANDARD_EXCLUDED_PREFIXES = [
  "evals/",
  ".github/workflows/",
  ".opencode/loops/",
  ".gentle-ai/loops/",
  "scripts/harness/"
];

export const COMPATIBILITY_LINKS = [
  ["CLAUDE.md", "AGENTS.md"],
  ["GEMINI.md", "AGENTS.md"],
  [".claude/CLAUDE.md", "../AGENTS.md"],
  [".agent/AGENTS.md", "../AGENTS.md"],
  [".windsurfrules", "AGENTS.md"]
];

export async function listTemplateFiles(packageRoot, mode) {
  if (!MODES.has(mode)) {
    throw new Error(`Invalid mode "${mode}". Use minimal, standard, or enterprise.`);
  }

  const templateRoot = resolve(packageRoot, "repo-template");
  const absolutePaths = await listFilesRecursive(templateRoot);

  return absolutePaths
    .map((sourcePath) => ({ sourcePath, relativePath: normalizePath(relative(templateRoot, sourcePath)) }))
    .filter(({ relativePath }) => shouldInstall(relativePath, mode));
}

async function listFilesRecursive(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFilesRecursive(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }

  return files;
}

function shouldInstall(relativePath, mode) {
  if (mode === "enterprise") return true;
  if (mode === "minimal") return MINIMAL_WHITELIST.has(relativePath);
  return !STANDARD_EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

export function normalizePath(filePath) {
  return sep === "/" ? filePath : filePath.split(sep).join("/");
}

export function isTextFile(filePath) {
  return TEXT_EXTENSIONS.has(filePath.slice(filePath.lastIndexOf(".")));
}

export async function pathExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function renderFileContent(sourcePath, project) {
  if (isTextFile(sourcePath)) {
    const text = await readFile(sourcePath, "utf8");
    return Buffer.from(renderTemplate(text, project), "utf8");
  }

  return readFile(sourcePath);
}
