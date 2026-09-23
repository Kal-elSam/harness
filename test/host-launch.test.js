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

test("cwd with metacharacters still spawns argv array with shell false", async () => {
  const calls = [];
  await launchGentleShell({
    cwd: "/tmp/proj; rm -rf /",
    extensionDir,
    statImpl: okStat,
    whichImpl: () => "/usr/bin/gentle-shell",
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
  assert.deepEqual(calls[0].args.slice(0, 4), ["--link", "-e", extensionDir, "--"]);
});

test("invalid session id is never passed to spawn", async () => {
  let spawned = false;
  await assert.rejects(
    () => launchGentleShell({
      cwd: "/tmp/proj",
      extensionDir,
      sessionId: "../../etc",
      statImpl: okStat,
      whichImpl: () => "/usr/bin/gentle-shell",
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
    env: { PATH: "/bin" },
    statImpl: okStat,
    whichImpl: () => "/usr/bin/gentle-shell",
    probeImpl: () => ({ ok: true, stdout: "0.85.1" }),
    spawnImpl: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });
  assert.equal(calls[0].options.env.KAIRO_SESSION_ID, "11111111-1111-4111-8111-111111111111");
  assert.equal(calls[0].args.includes("11111111-1111-4111-8111-111111111111"), false);
});

test("unresolvable gentle-shell fails closed and names --legacy-cockpit", async () => {
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
    /legacy-cockpit/
  );
});

const gentleShellPath = spawnSync("which", ["gentle-shell"], { encoding: "utf8" }).stdout.trim();

test("live gentle-shell version gate and launch argv include --link and -e", { skip: !gentleShellPath.startsWith("/") }, async () => {
  const calls = [];
  await launchGentleShell({
    cwd: process.cwd(),
    extensionDir: "/abs/kairo-extension",
    whichImpl: () => gentleShellPath,
    probeImpl: () => ({ ok: true, stdout: "0.85.1" }),
    spawnImpl: (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    }
  });
  assert.equal(calls[0].command, gentleShellPath);
  assert.ok(calls[0].args.includes("--link"));
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
