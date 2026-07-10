import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const kairoBin = join(packageRoot, "bin/kairo.js");

function runKairo(args, { env = process.env } = {}) {
  return spawnSync(process.execPath, [kairoBin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...env,
      HARNESS_INK: "0",
      OPENROUTER_API_KEY: "",
      OLLAMA_HOST: "http://127.0.0.1:9"
    }
  });
}

test("intelligence command parses subactions and flags", () => {
  const { command, options } = parseArgs([
    "intelligence",
    "ask",
    "--prompt",
    "hello",
    "--cloud-consent",
    "--paths",
    "src/cli.js,.env",
    "--include-private"
  ]);

  assert.equal(command, "intelligence");
  assert.equal(options.intelligenceAction, "ask");
  assert.equal(options.intelligencePrompt, "hello");
  assert.equal(options.cloudConsent, true);
  assert.equal(options.includePrivate, true);
  assert.deepEqual(options.intelligencePaths, ["src/cli.js", ".env"]);
});

test("intelligence status works in diagnostics mode without backends", () => {
  const result = runKairo(["intelligence", "status", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.readOnly, true);
  assert.ok(Array.isArray(payload.backends));
  assert.equal(payload.routing.canInvoke, false);
});

test("intelligence route is read-only and explains privacy", () => {
  const result = runKairo(["intelligence", "route", "--task", "explain architecture", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.readOnly, true);
  assert.ok(payload.routing.reason);
  assert.ok(payload.estimatedTokens >= 0);
});

test("intelligence ask without backend stays diagnostics-safe", () => {
  const result = runKairo(["intelligence", "ask", "--prompt", "ping", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.diagnosticsOnly, true);
});

test("help documents intelligence command", () => {
  const result = runKairo(["help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /intelligence/);
  assert.match(result.stdout, /OPENROUTER_API_KEY/);
});
