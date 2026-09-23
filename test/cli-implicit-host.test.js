import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs } from "../src/cli.js";
import { routeInteractiveHost } from "../src/global/host/launch-gentle-shell.js";

test("bare kairo resolves to unified host not shell", () => {
  const { command, isImplicitCommand } = parseArgs([]);
  assert.equal(isImplicitCommand, true);
  assert.equal(command, "host");
  assert.notEqual(command, "shell");
  assert.equal(routeInteractiveHost({ command, options: {} }), "gentle-shell");
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
