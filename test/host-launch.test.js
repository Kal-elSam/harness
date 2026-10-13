import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseArgs } from "../src/cli.js";
import {
  KAIRO_PI_PACKAGE_NAME, KAIRO_PI_PACKAGE_VERSION, MIN_NODE_VERSION,
  buildKairoPiResourceArgs, resolveKairoPiSettingsPath, routeInteractiveHost
} from "../src/global/host/launch-gentle-shell.js";
import { defaultResolveKairoPiCliPath, buildPiRpcSpawnArgs } from "../src/global/host/pi-rpc-bridge.js";
import { buildKairoPiEntryWithoutPackageJson, buildKairoPiFixture,
  buildKairoPiFixtureWithMalformedIntermediatePackageJson } from "./helpers/kairo-pi-fixture.js";

test("RPC resolution fails closed on missing or mismatched fork packages", async () => {
  assert.throws(() => defaultResolveKairoPiCliPath(() => null),
    (err) => err.message.includes(KAIRO_PI_PACKAGE_NAME) && err.message.includes(KAIRO_PI_PACKAGE_VERSION));
  const wrong = await buildKairoPiFixture({ version: "0.87.1-kairo.0" });
  assert.throws(() => defaultResolveKairoPiCliPath(wrong.resolveEntryImpl), /version mismatch.*0\.87\.1-kairo\.0/);
  const absent = await buildKairoPiEntryWithoutPackageJson();
  assert.throws(() => defaultResolveKairoPiCliPath(absent.resolveEntryImpl), /Could not find.*package\.json/);
  const missingBundle = await buildKairoPiFixture({ withCliEntry: false });
  assert.throws(() => defaultResolveKairoPiCliPath(missingBundle.resolveEntryImpl),
    (err) => err.message.includes(missingBundle.cliPath));
});

test("RPC resolution skips malformed intermediate package metadata", async () => {
  const fixture = await buildKairoPiFixtureWithMalformedIntermediatePackageJson();
  assert.equal(defaultResolveKairoPiCliPath(fixture.resolveEntryImpl), fixture.cliPath);
});

test("shared resource flags isolate the RPC engine and reject relative extensions", () => {
  const resources = ["-e", "/abs/kairo-extension", "--no-extensions", "--no-skills",
    "--no-prompt-templates", "--no-themes", "--no-context-files"];
  assert.deepEqual(buildKairoPiResourceArgs("/abs/kairo-extension"), resources);
  assert.deepEqual(buildPiRpcSpawnArgs({ cliPath: "/abs/cli.js", extensionDir: "/abs/kairo-extension" }),
    ["/abs/cli.js", ...resources, "--mode", "rpc", "--no-session"]);
  assert.throws(() => buildKairoPiResourceArgs("relative"), /must be absolute/);
});

test("shared settings path stays under HARNESS_HOME without writing settings", () => {
  assert.equal(resolveKairoPiSettingsPath({ HARNESS_HOME: "/abs/home", HOME: "/other" }),
    "/abs/home/.harness/pi-agent/settings.json");
});

test("bare kairo and shell route to Ratatui; retired interactive selectors fail closed", () => {
  for (const args of [[], ["shell"]]) {
    const { command, options } = parseArgs(args);
    assert.equal(routeInteractiveHost({ command, options, env: {} }), "ratatui");
    assert.throws(() => routeInteractiveHost({ command, options, env: { KAIRO_UI_HOST: "pi" } }),
      /KAIRO_UI_HOST=pi is no longer supported/);
  }
  for (const flag of ["--legacy-cockpit", "--pi", "--pi-host"]) {
    assert.throws(() => parseArgs([flag]), /no longer supported/);
  }
});

function resolveInstalledKairoPiCli() {
  try {
    const entryPath = fileURLToPath(import.meta.resolve(KAIRO_PI_PACKAGE_NAME));
    const cliPath = join(dirname(entryPath), "cli.js");
    return existsSync(cliPath) ? cliPath : null;
  } catch {
    return null;
  }
}

const FORK_VERSION_TIMEOUT_MS = 30_000;

function isNodeAtLeast(actual, minimum) {
  const parts = (version) => {
    const numbers = version.split(".").map(Number);
    return [0, 1, 2].map((index) => numbers[index] ?? 0);
  };
  const [a, m] = [parts(actual), parts(minimum)];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== m[index]) return a[index] > m[index];
  }
  return true;
}

// Exercise the RPC engine's actual installed-package resolver.
async function resolveInstalledForkThroughRpc() {
  return { command: process.execPath, args: [defaultResolveKairoPiCliPath()] };
}

test("Kairo pins the published fork and the RPC resolver resolves its installed bundle", async () => {
  const kairoPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(kairoPackage.dependencies?.[KAIRO_PI_PACKAGE_NAME], KAIRO_PI_PACKAGE_VERSION);

  const spawned = await resolveInstalledForkThroughRpc();
  assert.equal(spawned.command, process.execPath);
  const cliPath = spawned.args[0];
  assert.match(cliPath, /[\\/]dist[\\/]bundle[\\/]cli\.js$/);
  assert.ok(existsSync(cliPath), `missing installed fork bundle: ${cliPath}`);
});

test(
  "the installed fork bundle reports its pinned version",
  {
    skip: isNodeAtLeast(process.versions.node, MIN_NODE_VERSION)
      ? false
      : `the fork requires Node >= ${MIN_NODE_VERSION}; this runtime is ${process.versions.node}`
  },
  async () => {
    const { args } = await resolveInstalledForkThroughRpc();
    const result = spawnSync(process.execPath, [args[0], "--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: FORK_VERSION_TIMEOUT_MS
    });
    assert.equal(
      result.error,
      undefined,
      `fork --version did not complete: ${result.error?.message} (signal: ${result.signal})`
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), KAIRO_PI_PACKAGE_VERSION);
  }
);

test("isNodeAtLeast compares padded numeric versions", () => {
  assert.equal(isNodeAtLeast("22.19.0", "22.19.0"), true);
  assert.equal(isNodeAtLeast("22.19.1", "22.19"), true);
  assert.equal(isNodeAtLeast("22.18.9", "22.19.0"), false);
  assert.equal(isNodeAtLeast("20.19.0", "22.19.0"), false);
  assert.equal(isNodeAtLeast("24.0.0", "22.19.0"), true);
});

const resolvedLiveCliPath = resolveInstalledKairoPiCli();

// Opt-in: needs the Kairo-only Pi fork actually installed at its resolvable
// dist/bundle/cli.js, plus a saved Kairo PROJECT TEAM for this exact
// checkout path and reachable adapters, which fresh clones, worktrees and CI
// lack. Gated on resolving the fork itself, never on a "pi" binary on PATH —
// this launcher never consults PATH.
const liveRoutesSkip = process.env.KAIRO_LIVE_PI_TEST === "1" && resolvedLiveCliPath
  ? false
  : `set KAIRO_LIVE_PI_TEST=1 with "${KAIRO_PI_PACKAGE_NAME}"@${KAIRO_PI_PACKAGE_VERSION} installed and a Kairo PROJECT TEAM for this checkout`;

test("live direct Pi host exposes Kairo routes without Gentle inventory", { skip: liveRoutesSkip }, () => {
  const result = spawnSync(
    process.execPath,
    [
      resolvedLiveCliPath,
      "-e", new URL("../src/global/host/extension/", import.meta.url).pathname,
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files",
      "--list-models", "kairo"
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, PI_CODING_AGENT_DIR: "/tmp/kairo-direct-pi-live-test" }
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^kairo\s+/m);
  assert.doesNotMatch(result.stdout, /\[Skills\]|\[Extensions\]|Theme conflicts/);
});

test("legacy interactive launcher is not exported", async () => {
  const helpers = await import("../src/global/host/launch-gentle-shell.js");
  assert.equal("launch" + "GentleShell" in helpers, false);
});
