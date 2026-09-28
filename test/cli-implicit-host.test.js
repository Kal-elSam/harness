import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli.js";
import { routeInteractiveHost } from "../src/global/host/launch-gentle-shell.js";
import { RETIRED_PRODUCT_UI_MESSAGE } from "../src/global/host/launch-ratatui-host.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");

async function realRepo() {
  const root = await mkdtemp(join(tmpdir(), "kairo-implicit-host-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

test("bare kairo resolves to unified ratatui host not shell", () => {
  const { command, isImplicitCommand } = parseArgs([]);
  assert.equal(isImplicitCommand, true);
  assert.equal(command, "host");
  assert.notEqual(command, "shell");
  assert.equal(routeInteractiveHost({ command, options: {}, env: {} }), "ratatui");
});

test("explicit shell also selects ratatui (ops live inside the host)", () => {
  const { command } = parseArgs(["shell"]);
  assert.equal(command, "shell");
  assert.equal(routeInteractiveHost({ command, options: {} }), "ratatui");
});

test("--legacy-cockpit is rejected with a migration message", () => {
  assert.throws(() => parseArgs(["--legacy-cockpit"]), /--legacy-cockpit is no longer supported/);
  assert.throws(
    () => routeInteractiveHost({ command: "host", options: { legacyCockpit: true }, env: {} }),
    /--legacy-cockpit is no longer supported/
  );
});

test("--pi / --pi-host are rejected with a migration message", () => {
  assert.throws(() => parseArgs(["--pi"]), /--pi \/ --pi-host is no longer supported/);
  assert.throws(() => parseArgs(["--pi-host"]), /--pi \/ --pi-host is no longer supported/);
  assert.throws(
    () => routeInteractiveHost({ command: "host", options: { piHost: true }, env: {} }),
    /--pi \/ --pi-host is no longer supported/
  );
});

test("KAIRO_UI_HOST=pi is rejected with a migration message", () => {
  assert.throws(
    () => routeInteractiveHost({ command: "host", options: {}, env: { KAIRO_UI_HOST: "pi" } }),
    (err) => {
      assert.match(err.message, /KAIRO_UI_HOST=pi is no longer supported/);
      assert.match(err.message, new RegExp(RETIRED_PRODUCT_UI_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return true;
    }
  );
});

test("--ratatui still routes bare kairo to ratatui (redundant with default)", () => {
  const { command, options } = parseArgs(["--ratatui"]);
  assert.equal(options.ratatui, true);
  assert.equal(routeInteractiveHost({ command, options, env: {} }), "ratatui");
});

test("bare kairo non-TTY creates no session (ratatui requires TTY)", async () => {
  const root = await realRepo();
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-implicit-home-"));
  const sessionsDir = harnessHomePaths(homeDir).sessionsDir;
  await mkdir(sessionsDir, { recursive: true });

  const result = spawnSync(process.execPath, [harnessBin], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir }
  });
  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /interactive terminal|TTY/i);
  assert.doesNotMatch(result.stderr, /--legacy-cockpit|--pi\b/);

  const projectKey = projectKeyForPath(root);
  const entries = await readdir(join(sessionsDir, projectKey)).catch(() => []);
  assert.equal(entries.length, 0, "failed non-TTY host must never create a Kairo session");
});
