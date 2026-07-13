import test from "node:test";
import assert from "node:assert/strict";
import { resolveTerminalCapabilities } from "../src/global/ink/terminal-capabilities.js";
import { canUseSetupInk } from "../src/global/ink/terminal.js";

test("resolveTerminalCapabilities respects NO_COLOR and HARNESS_INK", () => {
  const base = resolveTerminalCapabilities({
    columns: 100,
    rows: 30,
    isTTY: true,
    term: "xterm-256color",
    env: {}
  });
  assert.equal(base.canUseInk, true);
  assert.equal(base.color, true);
  assert.equal(base.unicode, true);

  const noColor = resolveTerminalCapabilities({
    columns: 100,
    rows: 30,
    isTTY: true,
    term: "xterm-256color",
    env: { NO_COLOR: "1" }
  });
  assert.equal(noColor.color, false);
  assert.equal(noColor.canUseInk, true);

  const inkOff = resolveTerminalCapabilities({
    columns: 100,
    rows: 30,
    isTTY: true,
    term: "xterm-256color",
    env: { HARNESS_INK: "0" }
  });
  assert.equal(inkOff.canUseInk, false);
  assert.equal(inkOff.forceInk, false);
});

test("resolveTerminalCapabilities limits unicode and rejects narrow TTY", () => {
  const ascii = resolveTerminalCapabilities({
    columns: 80,
    rows: 24,
    isTTY: true,
    term: "xterm",
    env: { HARNESS_ASCII: "1" }
  });
  assert.equal(ascii.unicode, false);

  const narrow = resolveTerminalCapabilities({
    columns: 50,
    rows: 24,
    isTTY: true,
    term: "xterm-256color",
    env: {}
  });
  assert.equal(narrow.canUseInk, false);

  const nonTty = resolveTerminalCapabilities({
    columns: 120,
    rows: 40,
    isTTY: false,
    term: "xterm-256color",
    env: {}
  });
  assert.equal(nonTty.canUseInk, false);
});

test("canUseSetupInk keeps previous gate semantics", () => {
  assert.equal(canUseSetupInk({
    interactive: true,
    term: "xterm-256color",
    columns: 80,
    forceInk: true
  }), true);

  assert.equal(canUseSetupInk({
    interactive: true,
    term: "dumb",
    columns: 80,
    forceInk: true
  }), false);

  assert.equal(canUseSetupInk({
    interactive: true,
    term: "xterm-256color",
    columns: 59,
    forceInk: true
  }), false);

  assert.equal(canUseSetupInk({
    interactive: true,
    term: "xterm-256color",
    columns: 80,
    forceInk: false
  }), false);
});
