import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  ALL_CLI_NAMES,
  LEGACY_CLI_NAMES,
  LEGACY_PACKAGE_NAME,
  PACKAGE_NAME,
  PREFERRED_CLI,
  PREFERRED_CLI_NAMES,
  isLegacyCliName,
  legacyCliWarning,
  resolveInvokedCliName
} from "../src/global/brand/cli.js";
import { BRAND } from "../src/global/brand/index.js";
import { parseArgs, resolveSuggestedInvocation as resolveFromCli } from "../src/cli.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const bins = {
  kairo: join(packageRoot, "bin/kairo.js"),
  "kairo-runtime": join(packageRoot, "bin/kairo-runtime.js"),
  harness: join(packageRoot, "bin/harness.js")
};

function runBin(binPath, args = []) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: packageRoot,
    encoding: "utf8"
  });
}

test("brand identity matches Kairo Runtime spec", () => {
  assert.equal(BRAND.displayName, "Kairo Runtime");
  assert.equal(BRAND.name, "KAIRO RUNTIME");
  assert.equal(BRAND.tagline, "Local Agent Operating System");
});

test("CLI name sets include preferred and legacy aliases", () => {
  assert.ok(PREFERRED_CLI_NAMES.has("kairo"));
  assert.ok(PREFERRED_CLI_NAMES.has("kairo-runtime"));
  assert.ok(LEGACY_CLI_NAMES.has("harness"));
  assert.ok(LEGACY_CLI_NAMES.has("agentic-harness"));
  assert.equal(PREFERRED_CLI, "kairo");
  assert.equal(PACKAGE_NAME, "@kal-elsam/kairo-runtime");
  assert.equal(LEGACY_PACKAGE_NAME, "@kal-elsam/harness");
  assert.equal(ALL_CLI_NAMES.size, PREFERRED_CLI_NAMES.size + LEGACY_CLI_NAMES.size);
});

test("legacyCliWarning matches spec copy", () => {
  assert.equal(legacyCliWarning("harness"), "harness is a legacy alias; prefer kairo");
  assert.equal(isLegacyCliName("harness"), true);
  assert.equal(isLegacyCliName("kairo"), false);
});

test("resolveInvokedCliName prefers explicit bin names", () => {
  assert.equal(resolveInvokedCliName(["node", "/usr/local/bin/kairo"]), "kairo");
  assert.equal(resolveInvokedCliName(["node", "/usr/local/bin/harness"]), "harness");
  assert.equal(resolveInvokedCliName(["node", "/tmp/harness.js"]), "harness");
});

test("resolveSuggestedInvocation prefers kairo package for npx installs", () => {
  assert.equal(
    resolveFromCli(PACKAGE_NAME, ["node", "/usr/local/bin/kairo"]),
    "kairo"
  );
  assert.equal(
    resolveFromCli(PACKAGE_NAME, ["node", "/usr/local/bin/harness"]),
    "harness"
  );
  assert.equal(
    resolveFromCli(PACKAGE_NAME, ["node", "/tmp/node_modules/.bin/kairo.js"]),
    `npx ${PACKAGE_NAME}`
  );
});

test("kairo and kairo-runtime bins expose version", () => {
  for (const binPath of [bins.kairo, bins["kairo-runtime"]]) {
    const cli = runBin(binPath, ["--version"]);
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout.trim(), /^\d+\.\d+\.\d+$/);
  }
});

test("harness legacy bin works and emits soft warning", () => {
  const cli = runBin(bins.harness, ["--version"]);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stderr, /Warning: harness is a legacy alias; prefer kairo/);
});

test("help output shows Kairo Runtime branding", () => {
  const cli = runBin(bins.kairo, ["help"]);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Kairo Runtime/);
  assert.match(cli.stdout, /Local Agent Operating System/);
  assert.match(cli.stdout, /@kal-elsam\/kairo-runtime/);
  assert.match(cli.stdout, /Legacy aliases: harness/);
  assert.doesNotMatch(cli.stdout, /Agentic Harness/);
});

test("bare kairo defaults to setup command", () => {
  const { command } = parseArgs([]);
  assert.equal(command, "setup");
});
