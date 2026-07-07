import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeDir = resolve(root, "packages/harness-bridge");
const bridgeBin = resolve(bridgeDir, "bin/harness.js");
const bridgeRuntimeLink = resolve(bridgeDir, "node_modules/@kal-elsam/kairo-runtime");

const MIGRATION_WARNING =
  "@kal-elsam/harness has moved to @kal-elsam/kairo-runtime. Prefer: npx @kal-elsam/kairo-runtime";

function ensureBridgeRuntimeLink() {
  mkdirSync(dirname(bridgeRuntimeLink), { recursive: true });

  if (existsSync(bridgeRuntimeLink)) {
    return { created: false };
  }

  symlinkSync(root, bridgeRuntimeLink, "dir");
  return { created: true };
}

function cleanupBridgeRuntimeLink({ created }) {
  if (!created) {
    return;
  }

  rmSync(bridgeRuntimeLink, { recursive: true, force: true });
}

function runBridgeHarness(args, fakeHome) {
  return spawnSync("node", [bridgeBin, ...args], {
    cwd: bridgeDir,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: fakeHome }
  });
}

test("bridge harness bin warns on stderr and delegates --version to kairo-runtime", () => {
  const fakeHome = mkdtempSync(resolve(tmpdir(), "bridge-home-"));
  const fixture = ensureBridgeRuntimeLink();

  try {
    const result = runBridgeHarness(["--version"], fakeHome);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, new RegExp(MIGRATION_WARNING.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
    assert.doesNotMatch(result.stdout, /@kal-elsam\/harness has moved/);
  } finally {
    cleanupBridgeRuntimeLink(fixture);
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("bridge harness status --json keeps JSON on stdout", () => {
  const fakeHome = mkdtempSync(resolve(tmpdir(), "bridge-json-home-"));
  const fixture = ensureBridgeRuntimeLink();

  try {
    const result = runBridgeHarness(["status", "--json"], fakeHome);

    assert.notEqual(result.stdout.trim(), "");
    assert.match(result.stderr, /@kal-elsam\/harness has moved/);

    const payload = JSON.parse(result.stdout);
    assert.equal(typeof payload.ok, "boolean");
    assert.equal(typeof payload.overall, "string");
    assert.doesNotMatch(result.stdout, /@kal-elsam\/harness has moved/);
  } finally {
    cleanupBridgeRuntimeLink(fixture);
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test("bridge harness source prints migration warning before delegating", () => {
  const source = readFileSync(bridgeBin, "utf8");

  assert.match(source, /@kal-elsam\/harness has moved to @kal-elsam\/kairo-runtime/);
  assert.match(source, /console\.error\(MIGRATION_WARNING\)/);
  assert.match(source, /runCli\(process\.argv\.slice\(2\)\)/);
});

test("ensureBridgeRuntimeLink resolves from bridge package root", () => {
  const fixture = ensureBridgeRuntimeLink();

  try {
    assert.equal(existsSync(bridgeRuntimeLink), true);

    if (fixture.created) {
      assert.equal(lstatSync(bridgeRuntimeLink).isSymbolicLink(), true);
    }
  } finally {
    cleanupBridgeRuntimeLink(fixture);
  }
});
