import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseArgs } from "../src/cli.js";
import { routeInteractiveHost } from "../src/global/host/launch-gentle-shell.js";
import {
  kairoUiRebuildWatchPaths,
  launchRatatuiHost,
  releaseBinaryNeedsRebuild,
  resolveReleaseBinaryPath,
  resolveUiHost
} from "../src/global/host/launch-ratatui-host.js";

function okStat() {
  return { isDirectory: () => true };
}

function fakeCrateRoot() {
  const root = mkdtempSync(join(tmpdir(), "kairo-ratatui-crate-"));
  const crateDir = join(root, "crates", "kairo-ui");
  mkdirSync(crateDir, { recursive: true });
  writeFileSync(join(crateDir, "Cargo.toml"), "[package]\nname = \"kairo-ui\"\nversion = \"0.0.0\"\n");
  const sidecarDir = join(root, "src", "global", "host");
  mkdirSync(sidecarDir, { recursive: true });
  const sidecarScript = join(sidecarDir, "kairo-ui-rpc-stdio.js");
  writeFileSync(sidecarScript, "// test fixture\n");
  return { packageRoot: root, crateDir, sidecarScript };
}

test("resolveUiHost defaults to ratatui without flag or env", () => {
  assert.equal(resolveUiHost({ options: {}, env: {} }), "ratatui");
  assert.equal(resolveUiHost({ options: { ratatui: false, piHost: false }, env: {} }), "ratatui");
});

test("resolveUiHost opts into pi via --pi or KAIRO_UI_HOST=pi", () => {
  assert.equal(resolveUiHost({ options: { piHost: true }, env: {} }), "pi");
  assert.equal(resolveUiHost({ options: {}, env: { KAIRO_UI_HOST: "pi" } }), "pi");
  assert.equal(resolveUiHost({ options: {}, env: { KAIRO_UI_HOST: " Pi " } }), "pi");
});

test("resolveUiHost selects ratatui from --ratatui or KAIRO_UI_HOST", () => {
  assert.equal(resolveUiHost({ options: { ratatui: true }, env: {} }), "ratatui");
  assert.equal(resolveUiHost({ options: {}, env: { KAIRO_UI_HOST: "ratatui" } }), "ratatui");
  assert.equal(resolveUiHost({ options: {}, env: { KAIRO_UI_HOST: " Ratatui " } }), "ratatui");
});

test("resolveUiHost: --pi wins over --ratatui and env=ratatui", () => {
  assert.equal(
    resolveUiHost({
      options: { piHost: true, ratatui: true },
      env: { KAIRO_UI_HOST: "ratatui" }
    }),
    "pi"
  );
});

test("resolveUiHost: --legacy-cockpit wins over --pi, --ratatui and env", () => {
  assert.equal(
    resolveUiHost({
      options: { legacyCockpit: true, piHost: true, ratatui: true },
      env: { KAIRO_UI_HOST: "pi" }
    }),
    "cockpit"
  );
});

test("parseArgs accepts --ratatui; routeInteractiveHost returns ratatui for bare host", () => {
  const { command, options } = parseArgs(["--ratatui"]);
  assert.equal(command, "host");
  assert.equal(options.ratatui, true);
  assert.equal(routeInteractiveHost({ command, options, env: {} }), "ratatui");
});

test("parseArgs accepts --pi / --pi-host; default ui routes to ratatui", () => {
  assert.equal(parseArgs(["ui", "--ratatui"]).options.ratatui, true);
  assert.equal(parseArgs(["ui"]).options.ratatui, false);
  assert.equal(parseArgs(["ui"]).options.piHost, false);
  assert.equal(parseArgs(["ui", "--pi"]).options.piHost, true);
  assert.equal(parseArgs(["ui", "--pi-host"]).options.piHost, true);
  assert.equal(routeInteractiveHost({ command: "host", options: {}, env: {} }), "ratatui");
  assert.equal(
    routeInteractiveHost({ command: "host", options: { piHost: true }, env: {} }),
    "pi"
  );
});

test("routeInteractiveHost: --legacy-cockpit wins over --ratatui", () => {
  const { command, options } = parseArgs(["--legacy-cockpit", "--ratatui"]);
  assert.equal(routeInteractiveHost({ command, options, env: { KAIRO_UI_HOST: "ratatui" } }), "cockpit");
});

test("routeInteractiveHost: KAIRO_UI_HOST=pi selects pi; env ratatui stays ratatui", () => {
  assert.equal(
    routeInteractiveHost({ command: "host", options: {}, env: { KAIRO_UI_HOST: "pi" } }),
    "pi"
  );
  assert.equal(
    routeInteractiveHost({ command: "host", options: {}, env: { KAIRO_UI_HOST: "ratatui" } }),
    "ratatui"
  );
});

test("launchRatatuiHost spawns release binary with --bridge and project cwd", async () => {
  const { packageRoot, crateDir, sidecarScript } = fakeCrateRoot();
  const binaryPath = resolveReleaseBinaryPath(crateDir, {});
  mkdirSync(join(crateDir, "target", "release"), { recursive: true });
  writeFileSync(binaryPath, "");

  const calls = [];
  await launchRatatuiHost({
    cwd: "/abs/project",
    sessionId: "aaaaaaaa-0000-4000-8000-000000000001",
    interactive: true,
    platform: "darwin",
    packageRoot,
    crateDir,
    existsSyncImpl: (p) =>
      p === join(crateDir, "Cargo.toml") || p === binaryPath || p === sidecarScript,
    statImpl: okStat,
    cargoBuildImpl: async () => {
      calls.push("cargo");
      return { status: 0 };
    },
    spawnImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, binaryPath);
  assert.deepEqual(calls[0].args, ["--bridge"]);
  assert.equal(calls[0].options.cwd, "/abs/project");
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.stdio, "inherit");
  assert.equal(calls[0].options.env.KAIRO_SESSION_ID, "aaaaaaaa-0000-4000-8000-000000000001");
  assert.equal(calls[0].options.env.KAIRO_UI_RPC_SCRIPT, sidecarScript);
  assert.equal(calls[0].options.env.KAIRO_UI_NODE, process.execPath);
});

test("launchRatatuiHost builds once when release binary is missing, then spawns", async () => {
  const { packageRoot, crateDir, sidecarScript } = fakeCrateRoot();
  const binaryPath = resolveReleaseBinaryPath(crateDir, {});
  const seen = { cargo: 0, spawn: 0, binaryPresent: false };

  await launchRatatuiHost({
    cwd: "/abs/project",
    interactive: true,
    platform: "linux",
    packageRoot,
    crateDir,
    existsSyncImpl: (p) => {
      if (p === join(crateDir, "Cargo.toml") || p === sidecarScript) return true;
      if (p === binaryPath) return seen.binaryPresent;
      return false;
    },
    statImpl: okStat,
    cargoBuildImpl: async (args, options) => {
      seen.cargo += 1;
      assert.deepEqual(args, ["build", "--release", "--manifest-path", join(crateDir, "Cargo.toml")]);
      assert.equal(options.cwd, packageRoot);
      assert.equal(options.stdio, "inherit");
      seen.binaryPresent = true;
      return { status: 0 };
    },
    spawnImpl: async (command, args) => {
      seen.spawn += 1;
      assert.equal(command, binaryPath);
      assert.deepEqual(args, ["--bridge"]);
      return { status: 0 };
    }
  });

  assert.equal(seen.cargo, 1);
  assert.equal(seen.spawn, 1);
});

test("launchRatatuiHost respects CARGO_TARGET_DIR for the release binary", async () => {
  const { packageRoot, crateDir, sidecarScript } = fakeCrateRoot();
  const cargoTarget = join(packageRoot, "custom-target");
  const binaryPath = resolveReleaseBinaryPath(crateDir, { CARGO_TARGET_DIR: cargoTarget });
  assert.equal(binaryPath, join(cargoTarget, "release", "kairo-ui"));

  let spawned = null;
  await launchRatatuiHost({
    cwd: "/abs/project",
    interactive: true,
    platform: "darwin",
    env: { CARGO_TARGET_DIR: cargoTarget },
    packageRoot,
    crateDir,
    existsSyncImpl: (p) =>
      p === join(crateDir, "Cargo.toml") || p === binaryPath || p === sidecarScript,
    statImpl: okStat,
    spawnImpl: async (command, args, options) => {
      spawned = { command, args, options };
      return { status: 0 };
    }
  });
  assert.equal(spawned.command, binaryPath);
  assert.equal(spawned.options.env.KAIRO_UI_RPC_SCRIPT, sidecarScript);
});

test("releaseBinaryNeedsRebuild is true when binary is missing", () => {
  const { crateDir } = fakeCrateRoot();
  const binaryPath = resolveReleaseBinaryPath(crateDir, {});
  assert.equal(
    releaseBinaryNeedsRebuild({
      binaryPath,
      crateDir,
      existsSyncImpl: () => false
    }),
    true
  );
});

test("releaseBinaryNeedsRebuild is true when Cargo.toml is newer than the binary", () => {
  const { crateDir } = fakeCrateRoot();
  const binaryPath = resolveReleaseBinaryPath(crateDir, {});
  const manifestPath = join(crateDir, "Cargo.toml");
  assert.equal(
    releaseBinaryNeedsRebuild({
      binaryPath,
      crateDir,
      existsSyncImpl: (p) => p === binaryPath || p === manifestPath,
      statImpl: (p) => ({
        isDirectory: () => false,
        mtimeMs: p === binaryPath ? 1_000 : 2_000
      })
    }),
    true
  );
});

test("releaseBinaryNeedsRebuild is false when binary is newer than watch paths", () => {
  const { crateDir } = fakeCrateRoot();
  const binaryPath = resolveReleaseBinaryPath(crateDir, {});
  const watchPaths = kairoUiRebuildWatchPaths(crateDir, (p) =>
    p === join(crateDir, "Cargo.toml")
  );
  assert.deepEqual(watchPaths, [join(crateDir, "Cargo.toml")]);
  assert.equal(
    releaseBinaryNeedsRebuild({
      binaryPath,
      crateDir,
      existsSyncImpl: (p) => p === binaryPath || p === join(crateDir, "Cargo.toml"),
      statImpl: (p) => ({
        isDirectory: () => false,
        mtimeMs: p === binaryPath ? 5_000 : 1_000
      })
    }),
    false
  );
});

test("launchRatatuiHost rebuilds when release binary is stale vs crate sources", async () => {
  const { packageRoot, crateDir, sidecarScript } = fakeCrateRoot();
  const binaryPath = resolveReleaseBinaryPath(crateDir, {});
  const manifestPath = join(crateDir, "Cargo.toml");
  const seen = { cargo: 0, spawn: 0 };

  await launchRatatuiHost({
    cwd: "/abs/project",
    interactive: true,
    platform: "linux",
    packageRoot,
    crateDir,
    existsSyncImpl: (p) =>
      p === manifestPath || p === binaryPath || p === sidecarScript,
    statImpl: (p) => ({
      isDirectory: () => p === "/abs/project",
      mtimeMs: p === binaryPath ? 1_000 : 2_000
    }),
    cargoBuildImpl: async () => {
      seen.cargo += 1;
      return { status: 0 };
    },
    spawnImpl: async (command, args) => {
      seen.spawn += 1;
      assert.equal(command, binaryPath);
      assert.deepEqual(args, ["--bridge"]);
      return { status: 0 };
    }
  });

  assert.equal(seen.cargo, 1);
  assert.equal(seen.spawn, 1);
});

test("launchRatatuiHost fails closed on Windows and non-TTY", async () => {
  await assert.rejects(
    () => launchRatatuiHost({
      cwd: "/abs/project",
      interactive: true,
      platform: "win32",
      spawnImpl: async () => ({ status: 0 })
    }),
    /not supported on Windows/i
  );
  await assert.rejects(
    () => launchRatatuiHost({
      cwd: "/abs/project",
      interactive: false,
      platform: "darwin",
      spawnImpl: async () => ({ status: 0 })
    }),
    /interactive terminal/i
  );
});
