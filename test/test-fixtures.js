import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProject } from "../src/project-detection.js";

export async function createFixturePackageRoot() {
  const packageRoot = await mkdtemp(join(tmpdir(), "harness-pkg-"));
  const templateRoot = join(packageRoot, "repo-template");

  await mkdir(join(templateRoot, "docs", "ai"), { recursive: true });
  await mkdir(join(templateRoot, "evals"), { recursive: true });

  await writeFile(join(templateRoot, "AGENTS.md"), "# [PROJECT_NAME]\n");
  await writeFile(join(templateRoot, "docs", "ai", "harness.md"), "harness doc\n");
  await writeFile(join(templateRoot, "docs", "ai", "memory.md"), "memory doc\n");
  await writeFile(join(templateRoot, "docs", "extra.md"), "extra doc\n");
  await writeFile(join(templateRoot, "evals", "README.md"), "evals doc\n");

  return packageRoot;
}

export async function createProjectRoot() {
  const root = await mkdtemp(join(tmpdir(), "harness-project-"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "demo-app" }));
  return root;
}

export async function createProject() {
  const root = await createProjectRoot();
  return detectProject(root);
}
