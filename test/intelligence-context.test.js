import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compileContextPack,
  isPrivatePath,
  estimateTokens
} from "../src/global/intelligence/index.js";

test("isPrivatePath flags env and credential files", () => {
  assert.equal(isPrivatePath(".env"), true);
  assert.equal(isPrivatePath(".env.local"), true);
  assert.equal(isPrivatePath("secrets/token.txt"), true);
  assert.equal(isPrivatePath("src/cli.js"), false);
});

test("context pack excludes private files without consent", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-ctx-"));
  await writeFile(join(root, "AGENTS.md"), "# Agents\nUse TDD.\n", "utf8");
  await writeFile(join(root, ".env"), "SECRET=1\n", "utf8");
  await writeFile(join(root, "notes.md"), "relevant note\n", "utf8");
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "ctx-demo",
    description: "demo",
    scripts: { test: "node --test" }
  }), "utf8");

  const pack = await compileContextPack({
    workspaceRoot: root,
    task: "explain architecture",
    relevantPaths: [".env", "notes.md"],
    includePrivate: false
  });

  assert.equal(pack.privacy.excludedPrivate.includes(".env"), true);
  assert.ok(pack.perRequest.files.some((file) => file.path === "notes.md"));
  assert.equal(pack.perRequest.files.some((file) => file.path === ".env"), false);
  assert.ok(pack.estimatedTokens > 0);
  assert.equal(pack.stable.project.name, "ctx-demo");
});

test("context pack includes private files only with consent", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-ctx-priv-"));
  await writeFile(join(root, ".env"), "SECRET=1\n", "utf8");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "priv" }), "utf8");

  const pack = await compileContextPack({
    workspaceRoot: root,
    relevantPaths: [".env"],
    includePrivate: true
  });

  assert.ok(pack.perRequest.files.some((file) => file.path === ".env"));
  assert.equal(pack.privacy.excludedPrivate.length, 0);
});

test("context pack prefers relevant evidence over dumping the repo", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-ctx-budget-"));
  await mkdir(join(root, "docs", "ai"), { recursive: true });
  await writeFile(join(root, "AGENTS.md"), "constitution\n", "utf8");
  await writeFile(join(root, "docs", "ai", "harness.md"), "harness flow\n", "utf8");
  await writeFile(join(root, "docs", "ai", "architecture.md"), "arch\n", "utf8");
  await writeFile(join(root, "noise.txt"), "x".repeat(20000), "utf8");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "budget" }), "utf8");

  const pack = await compileContextPack({
    workspaceRoot: root,
    relevantPaths: ["docs/ai/architecture.md"],
    stableBudgetTokens: 500
  });

  assert.ok(pack.stable.agentsMd.includes("constitution"));
  assert.ok(pack.perRequest.files.some((file) => file.path === "docs/ai/architecture.md"));
  assert.equal(pack.perRequest.files.some((file) => file.path === "noise.txt"), false);
  assert.ok(estimateTokens(pack.systemPrompt) <= pack.estimatedTokens + 50);
});

test("context pack rejects traversal and symlink escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-ctx-contain-"));
  const outside = await mkdtemp(join(tmpdir(), "kairo-ctx-outside-"));
  await writeFile(join(outside, "secret.txt"), "outside secret\n", "utf8");
  await symlink(join(outside, "secret.txt"), join(root, "linked.txt"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "containment" }), "utf8");

  const pack = await compileContextPack({
    workspaceRoot: root,
    relevantPaths: ["../kairo-ctx-outside-does-not-exist/secret.txt", "linked.txt"]
  });

  assert.equal(pack.perRequest.files.length, 0);
  assert.equal(
    pack.evidence.filter((entry) => entry.kind === "rejected_outside_workspace").length,
    2
  );
});

test("stable docs and symlinked files use the same privacy checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-ctx-symlink-"));
  await mkdir(join(root, "docs", "ai"), { recursive: true });
  await writeFile(join(root, ".env"), "TOP_SECRET=1\n", "utf8");
  await symlink(join(root, ".env"), join(root, "notes.md"));
  await symlink(join(root, ".env"), join(root, "docs", "ai", "model-policy.md"));
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "privacy" }), "utf8");

  const pack = await compileContextPack({
    workspaceRoot: root,
    relevantPaths: ["notes.md"],
    includePrivate: false
  });

  assert.equal(pack.perRequest.files.length, 0);
  assert.equal(pack.stable.docs.some((doc) => doc.path.endsWith("model-policy.md")), false);
  assert.ok(pack.privacy.excludedPrivate.includes("notes.md"));
  assert.ok(pack.evidence.some((entry) => entry.kind === "excluded_private" && entry.path.endsWith("model-policy.md")));
});
