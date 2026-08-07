import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../src/cli.js";
import { formatHelpAll, formatHelpShort } from "../src/global/cli-help.js";

test("short help shows four commands and points to --all", () => {
  const text = formatHelpShort();
  assert.match(text, /Kairo Runtime/);
  assert.match(text, /Local Agent Operating System/);
  assert.match(text, /kairo status/);
  assert.match(text, /kairo sync/);
  assert.match(text, /kairo doctor/);
  assert.match(text, /help --all/);
  assert.doesNotMatch(text, /OPENROUTER_API_KEY/);
  assert.doesNotMatch(text, /kairo run --agent/);
});

test("full help groups commands and documents advanced surfaces", () => {
  const text = formatHelpAll();
  assert.match(text, /## Configuration & health/);
  assert.match(text, /## Agents & runs/);
  assert.match(text, /## Governance & audit/);
  assert.match(text, /## Advanced/);
  assert.match(text, /kairo run --agent/);
  assert.match(text, /runs list/);
  assert.match(text, /Operations cockpit/);
  assert.match(text, /intelligence/);
  assert.match(text, /OPENROUTER_API_KEY/);
  assert.match(text, /Legacy aliases: harness/);
});

test("parseArgs accepts help --all and help all", () => {
  assert.equal(parseArgs(["help"]).options.helpAll, false);
  assert.equal(parseArgs(["help", "--all"]).options.helpAll, true);
  assert.equal(parseArgs(["help", "all"]).options.helpAll, true);
  assert.equal(parseArgs(["--help", "--all"]).options.helpAll, true);
});
