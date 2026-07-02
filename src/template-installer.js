import { constants } from "node:fs";
import { access, copyFile, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { renderTemplate } from "./text-template.js";

const MODES = new Set(["minimal", "standard", "enterprise"]);
const TEXT_EXTENSIONS = new Set([".md", ".mdc", ".json", ".yml", ".yaml", ".sample", ".sh", ".mjs"]);

export async function installHarness({ project, packageRoot, mode, force = false, dryRun = false }) {
  if (!MODES.has(mode)) {
    throw new Error(`Invalid mode "${mode}". Use minimal, standard, or enterprise.`);
  }

  const templateRoot = resolve(packageRoot, "repo-template");
  const files = await listFiles(templateRoot);
  const selectedFiles = files.filter((filePath) => shouldInstall(relative(templateRoot, filePath), mode));
  const result = { mode, created: [], skipped: [], updated: [] };

  for (const sourcePath of selectedFiles) {
    const relativePath = normalizePath(relative(templateRoot, sourcePath));
    const destinationPath = resolve(project.root, relativePath);
    const exists = await pathExists(destinationPath);

    if (exists && !force) {
      result.skipped.push(relativePath);
      continue;
    }

    if (!dryRun) {
      await mkdir(dirname(destinationPath), { recursive: true });

      if (isTextFile(sourcePath)) {
        const content = await readFile(sourcePath, "utf8");
        await writeFile(destinationPath, renderTemplate(content, project), "utf8");
      } else {
        await copyFile(sourcePath, destinationPath);
      }
    }

    result[exists ? "updated" : "created"].push(relativePath);
  }

  await createCompatibilityLinks(project.root, { force, dryRun, result });
  return result;
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }

  return files;
}

function shouldInstall(relativePath, mode) {
  if (mode === "enterprise") return true;

  if (mode === "minimal") {
    return [
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
    ].includes(relativePath);
  }

  return !relativePath.startsWith("evals/")
    && !relativePath.startsWith(".github/workflows/")
    && !relativePath.startsWith(".opencode/loops/")
    && !relativePath.startsWith(".gentle-ai/loops/")
    && !relativePath.startsWith("scripts/harness/");
}

function normalizePath(filePath) {
  return sep === "/" ? filePath : filePath.split(sep).join("/");
}

function isTextFile(filePath) {
  return TEXT_EXTENSIONS.has(filePath.slice(filePath.lastIndexOf(".")));
}

async function pathExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function createCompatibilityLinks(root, { force, dryRun, result }) {
  const links = [
    ["CLAUDE.md", "AGENTS.md"],
    ["GEMINI.md", "AGENTS.md"],
    [".claude/CLAUDE.md", "../AGENTS.md"],
    [".agent/AGENTS.md", "../AGENTS.md"],
    [".windsurfrules", "AGENTS.md"]
  ];

  for (const [linkPath, target] of links) {
    const destination = resolve(root, linkPath);
    const exists = await pathExists(destination);

    if (exists && !force) continue;

    if (!dryRun) {
      await mkdir(dirname(destination), { recursive: true });
      if (exists) continue;
      try {
        await symlink(target, destination);
      } catch {
        await writeFile(destination, `Compatibility pointer. Source of truth: ${target}\n`, "utf8");
      }
    }

    if (!exists) result.created.push(linkPath);
  }
}
