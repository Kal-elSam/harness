import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs } from "../src/cli.js";
import {
  canUseOrchestratorShell,
  runOrchestratorShell,
  shouldOpenOrchestratorShell
} from "../src/global/orchestrator.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const kairoBin = join(packageRoot, "bin/kairo.js");

function runKairo(args, { homeDir = null, cwd = packageRoot } = {}) {
  return spawnSync(process.execPath, [kairoBin, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HARNESS_INK: "0",
      ...(homeDir ? { HARNESS_HOME: homeDir } : {})
    }
  });
}

test("bare kairo defaults to shell command", () => {
  const { command } = parseArgs([]);
  assert.equal(command, "shell");
});

test("bare kairo with setup flags still routes to setup", () => {
  const { command } = parseArgs(["--dry-run"]);
  assert.equal(command, "setup");
});

test("shouldOpenOrchestratorShell is true only for interactive TTY without flags", () => {
  const previousTerm = process.env.TERM;
  process.env.TERM = "xterm-256color";

  try {
    assert.equal(shouldOpenOrchestratorShell({ interactive: true }), true);
    assert.equal(shouldOpenOrchestratorShell({ interactive: false }), false);
    assert.equal(shouldOpenOrchestratorShell({ interactive: true, hasImplicitFlags: true }), false);
  } finally {
    if (previousTerm === undefined) {
      delete process.env.TERM;
    } else {
      process.env.TERM = previousTerm;
    }
  }
});

test("non-interactive shell fails fast without hanging", async () => {
  const packageManifest = { name: "@kal-elsam/kairo-runtime", version: "0.1.5" };

  await assert.rejects(
    () => runOrchestratorShell({
      packageRoot,
      packageManifest,
      workspaceRoot: packageRoot,
      interactive: false
    }),
    /Non-interactive shell requires an explicit command/
  );
});

test("non-interactive bare kairo preserves scriptable error behavior", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-shell-home-"));
  const statePath = join(homeDir, ".harness", "state.json");

  const cli = runKairo([], { homeDir });
  assert.notEqual(cli.status, 0, cli.stderr);
  assert.match(cli.stderr, /Non-interactive shell requires/);
  assert.equal(existsSync(statePath), false);
});

test("bare kairo --dry-run keeps setup scriptable flow", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-shell-dry-"));
  const statePath = join(homeDir, ".harness", "state.json");

  const cli = runKairo(["--dry-run"], { homeDir });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Dry run: nothing was written/);
  assert.equal(existsSync(statePath), false);
});

test("kairo orchestrator prints read-only diagnostics", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-shell-orch-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });

  const cli = runKairo(["orchestrator"], { homeDir });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /agent capability diagnostics/);
  assert.match(cli.stdout, /Cursor/);
});

test("canUseOrchestratorShell respects HARNESS_INK=0", () => {
  const previous = process.env.HARNESS_INK;
  process.env.HARNESS_INK = "0";

  try {
    assert.equal(canUseOrchestratorShell({ interactive: true }), false);
  } finally {
    if (previous === undefined) {
      delete process.env.HARNESS_INK;
    } else {
      process.env.HARNESS_INK = previous;
    }
  }
});

test("explicit install command remains compatible", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-shell-install-"));
  const statePath = join(homeDir, ".harness", "state.json");

  const cli = runKairo(["install", "--dry-run", "--agents", "cursor"], { homeDir });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /install plan/);
  assert.equal(existsSync(statePath), false);
});
