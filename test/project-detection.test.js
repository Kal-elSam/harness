import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProject } from "../src/project-detection.js";

test("detects package metadata and pnpm commands", async () => {
  const root = await mkdtemp(join(tmpdir(), "sgs-harness-"));

  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "demo-app",
    description: "Demo app",
    scripts: {
      test: "vitest",
      build: "vite build"
    },
    dependencies: {
      vite: "latest"
    }
  }));
  await writeFile(join(root, "pnpm-lock.yaml"), "");

  const project = await detectProject(root);

  assert.equal(project.name, "demo-app");
  assert.equal(project.packageManager, "pnpm");
  assert.equal(project.stack, "Vite");
  assert.equal(project.commands.test, "pnpm test");
});
