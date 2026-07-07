import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runHarnessSetup, shouldUseSetupTui } from "../src/global/setup.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { canUseSetupTui } from "../src/global/tui/terminal.js";
import { decodeKey, parseKeyBuffer } from "../src/global/tui/multi-select.js";
import {
  renderSetupTuiResult,
  runSetupTui,
  shouldUseSetupTui as shouldUseSetupTuiFromTui
} from "../src/global/tui/setup-tui.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");
const cliVersion = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8")
).version;
const baseOptions = {
  packageRoot,
  packageName: "@kal-elsam/harness",
  cliVersion
};

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-setup-tui-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# user-owned content\n");
  }

  return homeDir;
}

function createMockIo({ answers = [], keySequence = [] } = {}) {
  const screens = [];
  let answerIndex = 0;
  let keyIndex = 0;

  return {
    screens,
    columns: 100,
    write(text) {
      screens.push(text);
    },
    clear() {},
    hideCursor() {},
    showCursor() {},
    async readLine() {
      const answer = answers[answerIndex] ?? "";
      answerIndex += 1;
      return answer;
    },
    async readKey() {
      const key = keySequence[keyIndex] ?? "\r";
      keyIndex += 1;
      return key;
    },
    async close() {}
  };
}

function runHarness(args, homeDir) {
  return spawnSync(process.execPath, [harnessBin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir }
  });
}

test("canUseSetupTui rejects non-interactive and dumb terminals", () => {
  assert.equal(canUseSetupTui({ interactive: false }), false);
  assert.equal(canUseSetupTui({ interactive: true, term: "dumb" }), false);
  assert.equal(canUseSetupTui({ interactive: true, term: "xterm-256color", columns: 80 }), true);
  assert.equal(canUseSetupTui({ interactive: true, term: "xterm-256color", columns: 40 }), false);
});

test("shouldUseSetupTui routes only bare interactive setup", () => {
  assert.equal(shouldUseSetupTui({ interactive: true, tuiSupported: true }), true);
  assert.equal(shouldUseSetupTuiFromTui({ interactive: true, tuiSupported: true }), true);
  assert.equal(shouldUseSetupTui({ interactive: false, tuiSupported: true }), false);
  assert.equal(shouldUseSetupTui({ interactive: true, yes: true, tuiSupported: true }), false);
  assert.equal(shouldUseSetupTui({ interactive: true, confirm: true, tuiSupported: true }), false);
  assert.equal(shouldUseSetupTui({ interactive: true, agents: ["cursor"], tuiSupported: true }), false);
  assert.equal(shouldUseSetupTui({ interactive: true, components: ["orchestrator"], tuiSupported: true }), false);
  assert.equal(shouldUseSetupTui({ interactive: true, noDefaultComponents: true, tuiSupported: true }), false);
  assert.equal(shouldUseSetupTui({ interactive: true, json: true, tuiSupported: true }), false);
});

test("decodeKey handles navigation and confirm keys", () => {
  assert.equal(decodeKey("\u001b[A"), "up");
  assert.equal(decodeKey("\u001b[B"), "down");
  assert.equal(decodeKey("\u001b[C"), "ignore");
  assert.equal(decodeKey("\u001b[D"), "ignore");
  assert.equal(decodeKey(" "), "toggle");
  assert.equal(decodeKey("\r"), "confirm");
  assert.equal(decodeKey("q"), "cancel");
});

test("parseKeyBuffer supports split escape chunks from readKey", () => {
  let buffer = "\u001b";
  let parsed = parseKeyBuffer(buffer);
  assert.equal(parsed.pending, true);

  buffer += "[A";
  parsed = parseKeyBuffer(buffer);
  assert.equal(parsed.pending, false);
  assert.equal(parsed.action, "up");
  assert.equal(parsed.consumed, 3);
});

test("runSetupTui cancel on detect step writes nothing", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);
  const io = createMockIo({ answers: ["q"] });

  const outcome = await runSetupTui({
    ...baseOptions,
    homeDir,
    io
  });

  assert.equal(outcome.cancelled, true);
  assert.equal(existsSync(paths.statePath), false);
  assert.match(io.screens.join("\n"), /Step 1\/6 · Detect agents/);
  assert.match(io.screens.join("\n"), /detected/);
});

test("runSetupTui preview step shows managed markers and changes", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const io = createMockIo({
    answers: ["", "", "n"],
    keySequence: ["\r", "\r"]
  });

  const outcome = await runSetupTui({
    ...baseOptions,
    homeDir,
    io
  });

  assert.equal(outcome.cancelled, true);
  const output = io.screens.join("\n");
  assert.match(output, /Step 4\/6 · Preview managed changes/);
  assert.match(output, /harness:managed:start/);
  assert.match(output, /harness:managed:end/);
  assert.match(output, /\.cursor\/AGENTS\.md/);
});

test("runHarnessSetup with mocked TUI applies same result as setup --confirm", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);
  const io = createMockIo({
    answers: ["", "", "y"],
    keySequence: ["\r", "\r"]
  });

  const tuiOutcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    interactive: true,
    tuiSupported: true,
    runSetupTuiImpl: async (args) => runSetupTui({ ...args, io })
  });

  assert.equal(tuiOutcome.usedTui, true);
  assert.equal(tuiOutcome.cancelled, false);
  assert.ok(existsSync(paths.statePath));

  const confirmHome = await createFakeHome({ withCursorConfig: true });
  const confirmPaths = harnessHomePaths(confirmHome);
  const confirmOutcome = await runHarnessSetup({
    ...baseOptions,
    homeDir: confirmHome,
    interactive: false,
    confirm: true,
    agents: tuiOutcome.result.agents,
    components: tuiOutcome.result.components
  });

  assert.equal(confirmOutcome.cancelled, false);
  assert.deepEqual(confirmOutcome.result.agents, tuiOutcome.result.agents);
  assert.deepEqual(confirmOutcome.result.components, tuiOutcome.result.components);
  assert.ok(existsSync(confirmPaths.statePath));
});

test("runHarnessSetup mocked TUI decline cancels without writing", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);
  const io = createMockIo({
    answers: ["", "", "n"],
    keySequence: ["\r", "\r"]
  });

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    interactive: true,
    tuiSupported: true,
    runSetupTuiImpl: async (args) => runSetupTui({ ...args, io })
  });

  assert.equal(outcome.cancelled, true);
  assert.equal(existsSync(paths.statePath), false);
});

test("runHarnessSetup mocked TUI dry-run writes nothing", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);
  const io = createMockIo({
    answers: ["", "", "y"],
    keySequence: ["\r", "\r"]
  });

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    dryRun: true,
    interactive: true,
    tuiSupported: true,
    runSetupTuiImpl: async (args) => runSetupTui({ ...args, io })
  });

  assert.equal(outcome.cancelled, false);
  assert.equal(outcome.usedTui, true);
  assert.equal(existsSync(paths.statePath), false);
});

test("renderSetupTuiResult snapshot includes next actions", () => {
  const io = createMockIo();
  renderSetupTuiResult({
    stateRoot: "/tmp/.harness",
    agents: ["cursor"],
    components: ["orchestrator"],
    configsCreated: [".cursor/AGENTS.md"],
    configsUpdated: [],
    backups: []
  }, { dryRun: false, io });

  const output = io.screens.join("\n");
  assert.match(output, /Step 6\/6 · Result/);
  assert.match(output, /Setup complete/);
  assert.match(output, /harness status/);
  assert.match(output, /State root: \/tmp\/\.harness/);
});

test("renderSetupTuiResult dry-run snapshot recommends confirm command", () => {
  const io = createMockIo();
  renderSetupTuiResult({
    stateRoot: "/tmp/.harness",
    agents: ["cursor"],
    components: ["orchestrator"],
    configsCreated: [".cursor/AGENTS.md"],
    configsUpdated: [],
    backups: []
  }, { dryRun: true, io });

  const output = io.screens.join("\n");
  assert.match(output, /Dry run complete/);
  assert.match(output, /harness setup --confirm/);
});

test("non-TTY setup keeps current CLI behavior", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const cli = runHarness(["setup", "--agents", "cursor"], homeDir);
  assert.notEqual(cli.status, 0, cli.stderr);
  assert.match(cli.stderr, /Non-interactive setup requires/);
  assert.equal(existsSync(paths.statePath), false);
});

test("setup --confirm --agents cursor bypasses TUI and applies", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const cli = runHarness(["setup", "--confirm", "--agents", "cursor"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Harness preflight — setup/);
  assert.equal(existsSync(paths.statePath), true);
});

test("setup --dry-run --agents cursor writes nothing without TUI blocking", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const cli = runHarness(["setup", "--dry-run", "--agents", "cursor"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Dry run: nothing was written/);
  assert.equal(existsSync(paths.statePath), false);
});
