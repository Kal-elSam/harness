import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeDir = resolve(root, "packages/harness-bridge");
const bridgeBin = resolve(bridgeDir, "bin/harness.js");

const MIGRATION_WARNING =
  "@kal-elsam/harness has moved to @kal-elsam/kairo-runtime. Prefer: npx @kal-elsam/kairo-runtime";

function createLocalBridgeFixture(workdir) {
  const runtimeLink = resolve(workdir, "node_modules/@kal-elsam/kairo-runtime");
  mkdirSync(dirname(runtimeLink), { recursive: true });
  symlinkSync(root, runtimeLink, "dir");
  return bridgeBin;
}

function runBridgeHarness(args, { workdir, fakeHome }) {
  return spawnSync("node", [bridgeBin, ...args], {
    cwd: workdir,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: fakeHome }
  });
}

test("bridge harness bin warns on stderr and delegates --version to kairo-runtime", () => {
  const workdir = mkdtempSync(resolve(tmpdir(), "bridge-bin-"));
  const fakeHome = mkdtempSync(resolve(tmpdir(), "bridge-home-"));

  try {
    createLocalBridgeFixture(workdir);

    const result = runBridgeHarness(["--version"], { workdir, fakeHome });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, new RegExp(MIGRATION_WARNING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
    assert.doesNotMatch(result.stdout, /@kal-elsam\/harness has moved/);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("bridge harness status --json keeps JSON on stdout", () => {
  const workdir = mkdtempSync(resolve(tmpdir(), "bridge-json-"));
  const fakeHome = mkdtempSync(resolve(tmpdir(), "bridge-json-home-"));

  try {
    createLocalBridgeFixture(workdir);

    const result = runBridgeHarness(["status", "--json"], { workdir, fakeHome });

    assert.notEqual(result.stdout.trim(), "");
    assert.match(result.stderr, /@kal-elsam\/harness has moved/);

    const payload = JSON.parse(result.stdout);
    assert.equal(typeof payload.ok, "boolean");
    assert.equal(typeof payload.overall, "string");
    assert.doesNotMatch(result.stdout, /@kal-elsam\/harness has moved/);
  } finally {
    rmSync(workdir, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  }
});
