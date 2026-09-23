import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { launchGentleShell } from "../src/global/host/launch-gentle-shell.js";

const extensionDir = "/abs/kairo-extension";

function okStat() {
  return { isDirectory: () => true };
}

test("missing cwd fails closed", async () => {
  await assert.rejects(
    () => launchGentleShell({ cwd: "", extensionDir, spawnImpl: () => {}, whichImpl: () => "/bin/gentle-shell" }),
    /cwd|directory/i
  );
});

test("cwd with metacharacters launches direct Pi without Gentle package injection", async () => {
  const calls = [];
  await launchGentleShell({
    cwd: "/tmp/proj; rm -rf /",
    extensionDir,
    statImpl: okStat,
    env: { HARNESS_HOME: "/tmp/kairo-host-test" },
    whichImpl: (command) => (command === "pi" ? "/usr/bin/pi" : null),
    probeImpl: () => ({ ok: true, stdout: "0.85.1" }),
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.shell, false);
  assert.equal(typeof calls[0].command, "string");
  assert.ok(Array.isArray(calls[0].args));
  assert.ok(!String(calls[0].command).includes(";"));
  assert.deepEqual(calls[0].args, [
    "-e", extensionDir,
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes", "--no-context-files"
  ]);
  assert.equal(calls[0].command, "/usr/bin/pi");
  assert.equal(calls[0].options.env.PI_CODING_AGENT_DIR, "/tmp/kairo-host-test/.harness/pi-agent");
});

test("invalid session id is never passed to spawn", async () => {
  let spawned = false;
  await assert.rejects(
    () => launchGentleShell({
      cwd: "/tmp/proj",
      extensionDir,
      sessionId: "../../etc",
      statImpl: okStat,
      whichImpl: (command) => (command === "pi" ? "/usr/bin/pi" : null),
      probeImpl: () => ({ ok: true, stdout: "0.85.1" }),
      spawnImpl: () => {
        spawned = true;
        return { status: 0 };
      }
    }),
    /Invalid session id/
  );
  assert.equal(spawned, false);
});

test("explicit Kairo session binding is passed to the host environment, never argv", async () => {
  const calls = [];
  await launchGentleShell({
    cwd: "/tmp/proj",
    extensionDir,
    sessionId: "11111111-1111-4111-8111-111111111111",
    env: { PATH: "/bin", HARNESS_HOME: "/tmp/kairo-session-test" },
    statImpl: okStat,
    whichImpl: (command) => (command === "pi" ? "/usr/bin/pi" : null),
    probeImpl: () => ({ ok: true, stdout: "0.85.1" }),
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });
  assert.equal(calls[0].options.env.KAIRO_SESSION_ID, "11111111-1111-4111-8111-111111111111");
  assert.equal(calls[0].options.env.PI_CODING_AGENT_DIR, "/tmp/kairo-session-test/.harness/pi-agent");
  assert.equal(calls[0].args.includes("11111111-1111-4111-8111-111111111111"), false);
});

test("unresolvable Pi fails closed and names --legacy-cockpit", async () => {
  await assert.rejects(
    () => launchGentleShell({
      cwd: "/tmp/proj",
      extensionDir,
      statImpl: okStat,
      whichImpl: () => null,
      spawnImpl: () => {
        throw new Error("should not spawn");
      }
    }),
    /Pi CLI|legacy-cockpit/
  );
});

const piPath = spawnSync("which", ["pi"], { encoding: "utf8" }).stdout.trim();

test("live Pi version gate and launch argv isolate Kairo resources", { skip: !piPath.startsWith("/") }, async () => {
  const calls = [];
  await launchGentleShell({
    cwd: process.cwd(),
    extensionDir: "/abs/kairo-extension",
    env: { HARNESS_HOME: "/tmp/kairo-live-host-test" },
    whichImpl: (command) => (command === "pi" ? piPath : null),
    probeImpl: () => ({ ok: true, stdout: "0.85.1" }),
    spawnImpl: (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    }
  });
  assert.equal(calls[0].command, piPath);
  assert.ok(calls[0].args.includes("--no-extensions"));
  assert.ok(calls[0].args.includes("-e"));
});

test("non-interactive terminal fails closed before resolving or spawning the host", async () => {
  const calls = [];
  await assert.rejects(
    () => launchGentleShell({
      cwd: "/abs/project",
      extensionDir,
      interactive: false,
      statImpl: okStat,
      whichImpl: (command) => {
        calls.push(`which:${command}`);
        return "/usr/bin/gentle-shell";
      },
      probeImpl: () => ({ ok: true, stdout: "0.85.1" }),
      spawnImpl: () => {
        calls.push("spawn");
        return { status: 0 };
      }
    }),
    /interactive terminal[\s\S]*--legacy-cockpit/
  );
  assert.deepEqual(calls, []);
});

test("live direct Pi host exposes Kairo routes without Gentle inventory", { skip: !piPath.startsWith("/") }, () => {
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
