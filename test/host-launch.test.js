import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  KAIRO_PI_PACKAGE_NAME,
  KAIRO_PI_PACKAGE_VERSION,
  MIN_NODE_VERSION,
  launchGentleShell
} from "../src/global/host/launch-gentle-shell.js";
import {
  buildKairoPiEntryWithoutPackageJson,
  buildKairoPiFixture,
  buildKairoPiFixtureWithMalformedIntermediatePackageJson
} from "./helpers/kairo-pi-fixture.js";

const extensionDir = "/abs/kairo-extension";
const okNodeVersion = "22.19.0";

function okStat() {
  return { isDirectory: () => true };
}

async function tmpProjectDir(prefix = "kairo-host-launch-") {
  return mkdtemp(join(tmpdir(), prefix));
}

async function tmpHarnessHome() {
  return mkdtemp(join(tmpdir(), "kairo-fake-harness-home-"));
}

function isUnder(root, target) {
  const rel = relative(root, target);
  return rel !== "" && !rel.startsWith("..");
}

test("missing cwd fails closed", async () => {
  await assert.rejects(
    () => launchGentleShell({
      cwd: "",
      extensionDir,
      nodeVersion: okNodeVersion,
      spawnImpl: () => {},
      resolveEntryImpl: () => { throw new Error("should not resolve"); }
    }),
    /cwd|directory/i
  );
});

test("invalid session id is never passed to spawn", async () => {
  let spawned = false;
  await assert.rejects(
    () => launchGentleShell({
      cwd: "/tmp/proj",
      extensionDir,
      sessionId: "../../etc",
      statImpl: okStat,
      nodeVersion: okNodeVersion,
      resolveEntryImpl: () => { throw new Error("should not resolve"); },
      spawnImpl: () => {
        spawned = true;
        return { status: 0 };
      }
    }),
    /Invalid session id/
  );
  assert.equal(spawned, false);
});

test("non-interactive terminal fails closed before resolving or spawning the host", async () => {
  const calls = [];
  await assert.rejects(
    () => launchGentleShell({
      cwd: "/abs/project",
      extensionDir,
      interactive: false,
      statImpl: okStat,
      nodeVersion: okNodeVersion,
      resolveEntryImpl: () => {
        calls.push("resolve");
        throw new Error("should not resolve");
      },
      spawnImpl: () => {
        calls.push("spawn");
        return { status: 0 };
      }
    }),
    /interactive terminal[\s\S]*--legacy-cockpit/
  );
  assert.deepEqual(calls, []);
});

test("Node below the required version fails closed with an explicit message", async () => {
  const calls = [];
  await assert.rejects(
    () => launchGentleShell({
      cwd: "/abs/project",
      extensionDir,
      statImpl: okStat,
      nodeVersion: "20.11.0",
      resolveEntryImpl: () => {
        calls.push("resolve");
        throw new Error("should not resolve");
      },
      spawnImpl: () => {
        calls.push("spawn");
        return { status: 0 };
      }
    }),
    new RegExp(`Node[\\s\\S]*${MIN_NODE_VERSION.replaceAll(".", "\\.")}`)
  );
  assert.deepEqual(calls, [], "the fork must never be resolved when Node is below the minimum");
});

test("missing Kairo-only Pi fork fails closed and names the exact package", async () => {
  await assert.rejects(
    () => launchGentleShell({
      cwd: "/abs/project",
      extensionDir,
      statImpl: okStat,
      nodeVersion: okNodeVersion,
      resolveEntryImpl: () => {
        throw new Error("Cannot find package");
      },
      spawnImpl: () => {
        throw new Error("should not spawn");
      }
    }),
    new RegExp(`${KAIRO_PI_PACKAGE_NAME.replace(/[/@]/g, "\\$&")}[\\s\\S]*${KAIRO_PI_PACKAGE_VERSION}`)
  );
});

test("Kairo-only Pi fork at the wrong version fails closed and names both versions", async () => {
  const fixture = await buildKairoPiFixture({ version: "0.87.1-kairo.0" });
  await assert.rejects(
    () => launchGentleShell({
      cwd: "/abs/project",
      extensionDir,
      statImpl: okStat,
      nodeVersion: okNodeVersion,
      resolveEntryImpl: fixture.resolveEntryImpl,
      spawnImpl: () => {
        throw new Error("should not spawn");
      }
    }),
    /0\.87\.1-kairo\.0[\s\S]*0\.87\.1-kairo\.1/
  );
});

test("no package.json with the fork's name is found while walking up: fails closed with an explicit 'could not find' error", async () => {
  const fixture = await buildKairoPiEntryWithoutPackageJson();
  await assert.rejects(
    () => launchGentleShell({
      cwd: "/abs/project",
      extensionDir,
      statImpl: okStat,
      nodeVersion: okNodeVersion,
      resolveEntryImpl: fixture.resolveEntryImpl,
      spawnImpl: () => {
        throw new Error("should not spawn");
      }
    }),
    /Could not find[\s\S]*package\.json[\s\S]*--legacy-cockpit/
  );
});

test("a malformed intermediate package.json is skipped while walking up to the real package root", async () => {
  const fixture = await buildKairoPiFixtureWithMalformedIntermediatePackageJson();
  const cwd = await tmpProjectDir();
  const calls = [];
  await launchGentleShell({
    cwd,
    extensionDir,
    statImpl: okStat,
    env: { HARNESS_HOME: await tmpHarnessHome() },
    nodeVersion: okNodeVersion,
    execPath: "/fake/node/bin/node",
    resolveEntryImpl: fixture.resolveEntryImpl,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });
  assert.equal(calls.length, 1, "resolution must still succeed by walking past the malformed file");
  assert.equal(calls[0].args[0], fixture.cliPath);
});

test("missing dist/bundle/cli.js fails closed with an explicit error before spawning", async () => {
  const fixture = await buildKairoPiFixture({ withCliEntry: false });
  await assert.rejects(
    () => launchGentleShell({
      cwd: "/abs/project",
      extensionDir,
      statImpl: okStat,
      nodeVersion: okNodeVersion,
      resolveEntryImpl: fixture.resolveEntryImpl,
      spawnImpl: () => {
        throw new Error("should not spawn");
      }
    }),
    (err) => err.message.includes(fixture.cliPath) && /--legacy-cockpit/.test(err.message)
  );
});

test("resolution succeeds and spawns the injected execPath with the bundle cli.js path", async () => {
  const fixture = await buildKairoPiFixture();
  const cwd = await tmpProjectDir();
  const calls = [];
  await launchGentleShell({
    cwd,
    extensionDir,
    statImpl: okStat,
    env: { HARNESS_HOME: "/tmp/kairo-host-test" },
    nodeVersion: okNodeVersion,
    execPath: "/fake/node/bin/node",
    resolveEntryImpl: fixture.resolveEntryImpl,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/fake/node/bin/node");
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].args, [
    fixture.cliPath,
    "-e", extensionDir,
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"
  ]);
  assert.equal(calls[0].options.env.PI_CODING_AGENT_DIR, "/tmp/kairo-host-test/.harness/pi-agent");
});

test("execPath defaults to process.execPath when nothing is injected", async () => {
  const fixture = await buildKairoPiFixture();
  const cwd = await tmpProjectDir();
  const calls = [];
  await launchGentleShell({
    cwd,
    extensionDir,
    statImpl: okStat,
    env: { HARNESS_HOME: await tmpHarnessHome() },
    nodeVersion: okNodeVersion,
    resolveEntryImpl: fixture.resolveEntryImpl,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
});

test("PATH is never consulted: launch spawns the resolved fork even with an empty PATH", async () => {
  const fixture = await buildKairoPiFixture();
  const cwd = await tmpProjectDir();
  const calls = [];
  await launchGentleShell({
    cwd,
    extensionDir,
    statImpl: okStat,
    env: { HARNESS_HOME: await tmpHarnessHome(), PATH: "" },
    nodeVersion: okNodeVersion,
    execPath: "/fake/node/bin/node",
    resolveEntryImpl: fixture.resolveEntryImpl,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });
  assert.equal(calls[0].command, "/fake/node/bin/node");
  assert.equal(calls[0].args[0], fixture.cliPath);
});

test("KAIRO_PI_EMPTY_SESSIONS is set only in the child env, never on process.env", async () => {
  const fixture = await buildKairoPiFixture();
  const cwd = await tmpProjectDir();
  const originalProcessEnvFlag = process.env.KAIRO_PI_EMPTY_SESSIONS;
  assert.equal(originalProcessEnvFlag, undefined, "test precondition: flag must not already be set");

  const calls = [];
  await launchGentleShell({
    cwd,
    extensionDir,
    statImpl: okStat,
    env: { HARNESS_HOME: "/tmp/kairo-host-test" },
    nodeVersion: okNodeVersion,
    execPath: "/fake/node/bin/node",
    resolveEntryImpl: fixture.resolveEntryImpl,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });

  assert.equal(calls[0].options.env.KAIRO_PI_EMPTY_SESSIONS, "1");
  assert.equal(process.env.KAIRO_PI_EMPTY_SESSIONS, undefined);
});

test("explicit Kairo session binding is passed to the host environment, never argv", async () => {
  const fixture = await buildKairoPiFixture();
  const cwd = await tmpProjectDir();
  const calls = [];
  await launchGentleShell({
    cwd,
    extensionDir,
    sessionId: "11111111-1111-4111-8111-111111111111",
    env: { PATH: "/bin", HARNESS_HOME: "/tmp/kairo-session-test" },
    statImpl: okStat,
    nodeVersion: okNodeVersion,
    execPath: "/fake/node/bin/node",
    resolveEntryImpl: fixture.resolveEntryImpl,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });
  assert.equal(calls[0].options.env.KAIRO_SESSION_ID, "11111111-1111-4111-8111-111111111111");
  assert.equal(calls[0].options.env.PI_CODING_AGENT_DIR, "/tmp/kairo-session-test/.harness/pi-agent");
  assert.equal(calls[0].args.includes("11111111-1111-4111-8111-111111111111"), false);
});

test("launchGentleShell's only filesystem writes are mkdirSync/writeFileSync, and every one lands under HARNESS_HOME", async () => {
  const fixture = await buildKairoPiFixture();
  const cwd = await tmpProjectDir();
  const fakeHarnessHome = await tmpHarnessHome();

  // Records the writes routed through the injectable `fsImpl` seam, which
  // wraps the real functions so every call is both recorded and performed.
  // mock.method on node:fs would not see the launcher's named imports; the
  // child-process test below covers writes that bypass this seam.
  const writes = [];
  const fsImpl = {
    mkdirSync: (path, options) => {
      writes.push({ op: "mkdirSync", path });
      return mkdirSync(path, options);
    },
    writeFileSync: (path, data, options) => {
      writes.push({ op: "writeFileSync", path });
      return writeFileSync(path, data, options);
    }
  };

  await launchGentleShell({
    cwd,
    extensionDir,
    statImpl: okStat,
    env: { HARNESS_HOME: fakeHarnessHome },
    nodeVersion: okNodeVersion,
    execPath: "/fake/node/bin/node",
    resolveEntryImpl: fixture.resolveEntryImpl,
    fsImpl,
    spawnImpl: () => ({ status: 0 })
  });

  assert.ok(writes.length > 0, "the launcher must perform at least one write to prove interception is live");
  assert.deepEqual(writes.map((w) => w.op).sort(), ["mkdirSync", "writeFileSync"]);
  for (const write of writes) {
    assert.ok(
      isUnder(fakeHarnessHome, write.path),
      `write "${write.op}" to "${write.path}" is outside HARNESS_HOME "${fakeHarnessHome}"`
    );
  }
});

test("launcher-process fs writes, including ones that bypass fsImpl, land only under HARNESS_HOME", async () => {
  // The fsImpl test above only sees writes routed through the injected
  // fsImpl. This one runs the launcher in a child process that patches the
  // node:fs write entry points before the launcher module loads (coverage is
  // listed in the probe header), so a direct named import (the class of the
  // withdrawn global-Pi patch) is recorded as well.
  const fixture = await buildKairoPiFixture();
  const cwd = await tmpProjectDir();
  const fakeHarnessHome = await tmpHarnessHome();
  const probe = fileURLToPath(new URL("./helpers/launch-write-probe.mjs", import.meta.url));
  const resultPath = join(await tmpProjectDir("kairo-write-probe-result-"), "writes.json");

  const result = spawnSync(
    process.execPath,
    [probe, cwd, extensionDir, fakeHarnessHome, fixture.entryPath, resultPath],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, `probe failed: ${result.stderr}`);

  const writes = JSON.parse(readFileSync(resultPath, "utf8"));
  assert.ok(writes.length > 0, "the probe must record at least one write to prove interception is live");
  for (const write of writes) {
    assert.ok(
      isUnder(fakeHarnessHome, write.path),
      `write "${write.op}" to "${write.path}" is outside HARNESS_HOME "${fakeHarnessHome}"`
    );
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

test("Kairo pins and launches the installed fork bundle", () => {
  const kairoPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(kairoPackage.dependencies?.[KAIRO_PI_PACKAGE_NAME], KAIRO_PI_PACKAGE_VERSION);

  const entryPath = fileURLToPath(import.meta.resolve(KAIRO_PI_PACKAGE_NAME));
  const packageRoot = dirname(dirname(dirname(entryPath)));
  const forkPackage = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  assert.equal(forkPackage.name, KAIRO_PI_PACKAGE_NAME);
  assert.equal(forkPackage.version, KAIRO_PI_PACKAGE_VERSION);

  const cliPath = join(packageRoot, "dist", "bundle", "cli.js");
  assert.ok(existsSync(cliPath), `missing installed fork bundle: ${cliPath}`);
  if (Number(process.versions.node.split(".")[0]) >= 22) {
    const result = spawnSync(process.execPath, [cliPath, "--version"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), KAIRO_PI_PACKAGE_VERSION);
  }
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
