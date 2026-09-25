import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli.js";
import { routeInteractiveHost } from "../src/global/host/launch-gentle-shell.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");

async function fakePiOnPath() {
  const binDir = await mkdtemp(join(tmpdir(), "kairo-fake-pi-"));
  const piPath = join(binDir, "pi");
  await writeFile(
    piPath,
    "#!/usr/bin/env bash\nif [ \"$1\" = \"--version\" ]; then echo 0.85.1; exit 0; fi\nexit 0\n"
  );
  await import("node:fs/promises").then(({ chmod }) => chmod(piPath, 0o755));
  return binDir;
}

async function realRepo() {
  const root = await mkdtemp(join(tmpdir(), "kairo-implicit-host-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

test("bare kairo resolves to unified host not shell", () => {
  const { command, isImplicitCommand } = parseArgs([]);
  assert.equal(isImplicitCommand, true);
  assert.equal(command, "host");
  assert.notEqual(command, "shell");
  assert.equal(routeInteractiveHost({ command, options: {} }), "pi");
});

test("explicit shell still selects the Ink orchestrator", () => {
  const { command } = parseArgs(["shell"]);
  assert.equal(command, "shell");
  assert.equal(routeInteractiveHost({ command, options: {} }), "shell");
});

test("--legacy-cockpit routes to the conversation cockpit", () => {
  const { command, options } = parseArgs(["--legacy-cockpit"]);
  assert.equal(options.legacyCockpit, true);
  assert.equal(routeInteractiveHost({ command, options }), "cockpit");
});

test("bare kairo creates and binds a real Kairo session, same path as kairo start", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-implicit-host-home-"));
  const projectRoot = await realRepo();
  const binDir = await fakePiOnPath();

  const cli = spawnSync(process.execPath, [harnessBin], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir, PATH: `${binDir}:${process.env.PATH}` }
  });

  // Non-interactive spawnSync has no TTY, so the host launch itself still
  // fails closed after binding — the session must already exist by then.
  assert.match(cli.stderr, /interactive terminal/i);

  const sessionsDir = join(harnessHomePaths(homeDir).sessionsDir, projectKeyForPath(projectRoot), "conversations");
  const entries = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  const sessionDirs = entries.filter((entry) => entry.isDirectory());
  assert.equal(sessionDirs.length, 1, "bare kairo must create exactly one real session, like kairo start");
});

test("--legacy-cockpit routing for bare kairo is unchanged: no session is created", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-implicit-host-home-"));
  const projectRoot = await realRepo();

  spawnSync(process.execPath, [harnessBin, "--legacy-cockpit"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir }
  });

  const sessionsDir = join(harnessHomePaths(homeDir).sessionsDir, projectKeyForPath(projectRoot), "conversations");
  const entries = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  assert.equal(entries.length, 0, "--legacy-cockpit must never create a Kairo session");
});
