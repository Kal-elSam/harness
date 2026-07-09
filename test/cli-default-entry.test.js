import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-default-entry-home-"));

  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# user-owned content\n");
  }

  return homeDir;
}

function runHarness(args, { homeDir = null, cwd = packageRoot } = {}) {
  return spawnSync(process.execPath, [harnessBin, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(homeDir ? { HARNESS_HOME: homeDir } : {})
    }
  });
}

test("bare harness --dry-run writes nothing", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const statePath = join(homeDir, ".harness", "state.json");

  const cli = runHarness(["--dry-run"], { homeDir });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Dry run: nothing was written/);
  assert.equal(existsSync(statePath), false);
});

test("bare harness non-TTY fails without consent and writes nothing", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const statePath = join(homeDir, ".harness", "state.json");

  const cli = runHarness([], { homeDir });
  assert.notEqual(cli.status, 0, cli.stderr);
  assert.match(cli.stderr, /Non-interactive shell requires/);
  assert.equal(existsSync(statePath), false);
});

test("bare harness --scope=workspace --dry-run routes to workspace init", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "harness-default-entry-workspace-"));

  try {
    const cli = runHarness(["--scope=workspace", "--dry-run"], { cwd: workspaceDir });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /scope: workspace/);
    assert.match(cli.stdout, /plan/);
    assert.equal(existsSync(join(workspaceDir, ".harness", "manifest.json")), false);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("kairo install --dry-run keeps technical install flow", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const statePath = join(homeDir, ".harness", "state.json");

  const cli = runHarness(["install", "--dry-run", "--agents", "cursor"], { homeDir });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Kairo Runtime global install plan/);
  assert.match(cli.stdout, /Dry run: nothing was written/);
  assert.equal(existsSync(statePath), false);
});
