import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  KAIRO_PI_PACKAGE_NAME,
  KAIRO_PI_PACKAGE_VERSION,
  MIN_NODE_VERSION,
  launchGentleShell
} from "../src/global/host/launch-gentle-shell.js";
import { buildKairoPiFixture } from "./helpers/kairo-pi-fixture.js";

const extensionDir = "/abs/kairo-extension";
const okNodeVersion = "22.19.0";

function okStat() {
  return { isDirectory: () => true };
}

async function tmpProjectDir(prefix = "kairo-host-launch-") {
  return mkdtemp(join(tmpdir(), prefix));
}

async function snapshotTree(root) {
  const entries = [];
  async function walk(dir) {
    const items = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const item of items) {
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        await walk(full);
      } else if (item.isFile()) {
        const content = await readFile(full);
        entries.push({
          path: relative(root, full),
          hash: createHash("sha256").update(content).digest("hex")
        });
      }
    }
  }
  await walk(root);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
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

test("resolution succeeds and spawns process.execPath with the bundle cli.js path", async () => {
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

test("a different pi on PATH is ignored: PATH is never consulted", async () => {
  const fixture = await buildKairoPiFixture();
  const cwd = await tmpProjectDir();
  const binDir = await mkdtemp(join(tmpdir(), "kairo-fake-pi-on-path-"));
  const fakePiPath = join(binDir, "pi");
  await writeFile(fakePiPath, "#!/bin/sh\necho should-never-run\nexit 1\n", "utf8");
  await chmod(fakePiPath, 0o755);

  const calls = [];
  await launchGentleShell({
    cwd,
    extensionDir,
    statImpl: okStat,
    env: { HARNESS_HOME: "/tmp/kairo-host-test", PATH: `${binDir}${delimiter}/usr/bin` },
    nodeVersion: okNodeVersion,
    execPath: "/fake/node/bin/node",
    resolveEntryImpl: fixture.resolveEntryImpl,
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });
  assert.equal(calls[0].command, "/fake/node/bin/node");
  assert.notEqual(calls[0].command, fakePiPath);
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

test("fake-HOME tree snapshot: launching the host never writes outside HARNESS_HOME", async () => {
  const fixture = await buildKairoPiFixture();
  const cwd = await tmpProjectDir();
  const fakeHome = await mkdtemp(join(tmpdir(), "kairo-fake-home-"));
  const fakeHarnessHome = await mkdtemp(join(tmpdir(), "kairo-fake-harness-home-"));

  const before = await snapshotTree(fakeHome);
  assert.deepEqual(before, [], "test precondition: fake HOME must start empty");

  await launchGentleShell({
    cwd,
    extensionDir,
    statImpl: okStat,
    env: { HOME: fakeHome, HARNESS_HOME: fakeHarnessHome },
    nodeVersion: okNodeVersion,
    execPath: "/fake/node/bin/node",
    resolveEntryImpl: fixture.resolveEntryImpl,
    spawnImpl: () => ({ status: 0 })
  });

  const after = await snapshotTree(fakeHome);
  assert.deepEqual(after, [], "no file must be written under the real/fake HOME tree");

  const harnessWrites = await snapshotTree(fakeHarnessHome);
  assert.ok(
    harnessWrites.some((entry) => entry.path === join(".harness", "pi-agent", "settings.json")),
    "the only expected write is the Kairo-owned Pi settings file under HARNESS_HOME"
  );
});

const piPath = spawnSync("which", ["pi"], { encoding: "utf8" }).stdout.trim();

// Opt-in: needs a real Pi plus a saved Kairo PROJECT TEAM for this exact
// checkout path and reachable adapters, which fresh clones, worktrees and CI lack.
const liveRoutesSkip = process.env.KAIRO_LIVE_PI_TEST === "1" && piPath.startsWith("/")
  ? false
  : "set KAIRO_LIVE_PI_TEST=1 with Pi and a Kairo PROJECT TEAM for this checkout";

test("live direct Pi host exposes Kairo routes without Gentle inventory", { skip: liveRoutesSkip }, () => {
  const result = spawnSync(
    piPath,
    [
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
