import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runHarnessSetup, shouldUseSetupWizard } from "../src/global/setup.js";
import { harnessHomePaths } from "../src/global/paths.js";
import {
  renderSetupWizardResult,
  runSetupWizard,
  shouldUseSetupWizard as shouldUseSetupWizardFromModule
} from "../src/global/clack/setup-wizard.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");
const cliVersion = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8")
).version;
const baseOptions = {
  packageRoot,
  packageName: "@kal-elsam/kairo-runtime",
  cliVersion
};

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-setup-wizard-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# user-owned content\n");
  }

  return homeDir;
}

function createMockPrompts({
  agentValues = ["cursor", "codex"],
  componentValues = null,
  confirmValue = true,
  cancelAt = null
} = {}) {
  const calls = {
    intro: [],
    notes: [],
    outro: [],
    cancelled: false
  };

  const defaultComponents = ["orchestrator", "sdd-core"];
  const resolvedComponents = componentValues ?? defaultComponents;

  const CANCEL = "__clack_cancel__";

  const prompts = {
    calls,
    intro(title) {
      calls.intro.push(title);
    },
    log: {
      info(message) {
        calls.info = message;
      },
      error(message) {
        calls.error = message;
      }
    },
    note(message, title) {
      calls.notes.push({ title, message });
    },
    outro(message) {
      calls.outro.push(message);
    },
    cancel(message) {
      calls.cancelled = true;
      calls.cancelMessage = message;
    },
    isCancel(value) {
      return value === CANCEL;
    },
    async multiselect(opts) {
      if (cancelAt === "agents") return CANCEL;
      if (opts.message.includes("manage")) {
        return agentValues;
      }
      if (cancelAt === "components") return CANCEL;
      return resolvedComponents;
    },
    async confirm() {
      if (cancelAt === "confirm") return CANCEL;
      return confirmValue;
    }
  };

  return prompts;
}

function runHarness(args, homeDir) {
  return spawnSync(process.execPath, [harnessBin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir }
  });
}

test("shouldUseSetupWizard routes simple mode and ink fallback", () => {
  assert.equal(shouldUseSetupWizard({ interactive: true, inkCapable: true }), false);
  assert.equal(shouldUseSetupWizard({ interactive: true, simple: true, inkCapable: true }), true);
  assert.equal(shouldUseSetupWizard({ interactive: true, inkCapable: false }), true);
  assert.equal(shouldUseSetupWizardFromModule({ interactive: true, inkCapable: false }), true);
  assert.equal(shouldUseSetupWizard({ interactive: false, inkCapable: true }), false);
  assert.equal(shouldUseSetupWizard({ interactive: true, yes: true, inkCapable: true }), false);
  assert.equal(shouldUseSetupWizard({ interactive: true, confirm: true, inkCapable: true }), false);
  assert.equal(shouldUseSetupWizard({ interactive: true, agents: ["cursor"], inkCapable: true }), false);
  assert.equal(shouldUseSetupWizard({ interactive: true, components: ["orchestrator"], inkCapable: true }), false);
  assert.equal(shouldUseSetupWizard({ interactive: true, noDefaultComponents: true, inkCapable: true }), false);
  assert.equal(shouldUseSetupWizard({ interactive: true, json: true, inkCapable: true }), false);
});

test("runSetupWizard intro snapshot shows Harness branding and detection", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const prompts = createMockPrompts({ cancelAt: "agents" });

  const outcome = await runSetupWizard({
    ...baseOptions,
    homeDir,
    prompts
  });

  assert.equal(outcome.cancelled, true);
  assert.deepEqual(prompts.calls.intro, ["Kairo Runtime — Local Agent Operating System"]);
  assert.equal(prompts.calls.notes.length, 2);
  assert.equal(prompts.calls.notes[0].title, "Welcome");
  assert.match(prompts.calls.notes[0].message, /Coordinates local AI agents/);
  assert.equal(prompts.calls.notes[1].title, "Your agents");
  assert.match(prompts.calls.notes[1].message, /Cursor/);
  assert.match(prompts.calls.notes[1].message, /ready/);
});

test("runSetupWizard preview step shows structured plan sections", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const prompts = createMockPrompts({ confirmValue: false });

  const outcome = await runSetupWizard({
    ...baseOptions,
    homeDir,
    prompts
  });

  assert.equal(outcome.cancelled, true);
  const previewNote = prompts.calls.notes.find((entry) => entry.title === "Plan preview");
  assert.ok(previewNote);
  assert.match(previewNote.message, /Managed writes/);
  assert.match(previewNote.message, /Preserved content/);
  assert.match(previewNote.message, /\.cursor\/AGENTS\.md/);
  assert.doesNotMatch(previewNote.message, /harness:managed:start/);
});

test("runSetupWizard cancellation snapshot", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);
  const prompts = createMockPrompts({ cancelAt: "components" });

  const outcome = await runSetupWizard({
    ...baseOptions,
    homeDir,
    prompts
  });

  assert.equal(outcome.cancelled, true);
  assert.equal(prompts.calls.cancelled, true);
  assert.match(prompts.calls.cancelMessage, /cancelled/i);
  assert.equal(existsSync(paths.statePath), false);
});

test("runHarnessSetup with mocked wizard applies same result as setup --confirm", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);
  const prompts = createMockPrompts();

  const wizardOutcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    interactive: true,
    inkCapable: false,
    runSetupWizardImpl: async (args) => runSetupWizard({ ...args, prompts })
  });

  assert.equal(wizardOutcome.usedWizard, true);
  assert.equal(wizardOutcome.cancelled, false);
  assert.ok(existsSync(paths.statePath));

  const confirmHome = await createFakeHome({ withCursorConfig: true });
  const confirmPaths = harnessHomePaths(confirmHome);
  const confirmOutcome = await runHarnessSetup({
    ...baseOptions,
    homeDir: confirmHome,
    interactive: false,
    confirm: true,
    agents: wizardOutcome.result.agents,
    components: wizardOutcome.result.components
  });

  assert.equal(confirmOutcome.cancelled, false);
  assert.deepEqual(confirmOutcome.result.agents, wizardOutcome.result.agents);
  assert.deepEqual(confirmOutcome.result.components, wizardOutcome.result.components);
  assert.ok(existsSync(confirmPaths.statePath));
});

test("runHarnessSetup mocked wizard decline cancels without writing", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);
  const prompts = createMockPrompts({ confirmValue: false });

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    interactive: true,
    inkCapable: false,
    runSetupWizardImpl: async (args) => runSetupWizard({ ...args, prompts })
  });

  assert.equal(outcome.cancelled, true);
  assert.equal(existsSync(paths.statePath), false);
});

test("runHarnessSetup mocked wizard dry-run writes nothing", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);
  const prompts = createMockPrompts();

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    dryRun: true,
    interactive: true,
    inkCapable: false,
    runSetupWizardImpl: async (args) => runSetupWizard({ ...args, prompts })
  });

  assert.equal(outcome.cancelled, false);
  assert.equal(outcome.usedWizard, true);
  assert.equal(existsSync(paths.statePath), false);
});

test("renderSetupWizardResult success snapshot includes next actions", () => {
  const prompts = createMockPrompts();
  renderSetupWizardResult({
    stateRoot: "/tmp/.harness",
    agents: ["cursor"],
    components: ["orchestrator"],
    configsCreated: [".cursor/AGENTS.md"],
    configsUpdated: [],
    backups: []
  }, { dryRun: false, prompts });

  const resultNote = prompts.calls.notes.find((entry) => entry.title === "Setup complete");
  assert.ok(resultNote);
  assert.match(resultNote.message, /kairo status/);
  assert.match(resultNote.message, /State/);
  assert.deepEqual(prompts.calls.outro, ["Your local agent OS is ready."]);
});

test("renderSetupWizardResult dry-run snapshot recommends confirm command", () => {
  const prompts = createMockPrompts();
  renderSetupWizardResult({
    stateRoot: "/tmp/.harness",
    agents: ["cursor"],
    components: ["orchestrator"],
    configsCreated: [".cursor/AGENTS.md"],
    configsUpdated: [],
    backups: []
  }, { dryRun: true, prompts });

  const resultNote = prompts.calls.notes.find((entry) => entry.title === "Dry run complete");
  assert.ok(resultNote);
  assert.match(resultNote.message, /kairo setup --confirm/);
  assert.deepEqual(prompts.calls.outro, ["Nothing was written."]);
});

test("non-TTY setup keeps textual fallback without premium wizard branding", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const cli = runHarness(["setup", "--agents", "cursor"], homeDir);
  assert.notEqual(cli.status, 0, cli.stderr);
  assert.match(cli.stderr, /Non-interactive setup requires/);
  assert.doesNotMatch(cli.stdout, /Local Agent Operating System/);
  assert.equal(existsSync(paths.statePath), false);
});

test("setup --confirm --agents cursor bypasses wizard and applies", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const cli = runHarness(["setup", "--confirm", "--agents", "cursor"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Kairo Runtime preflight — setup/);
  assert.equal(existsSync(paths.statePath), true);
});

test("setup --dry-run --agents cursor writes nothing without wizard blocking", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const cli = runHarness(["setup", "--dry-run", "--agents", "cursor"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Dry run: nothing was written/);
  assert.equal(existsSync(paths.statePath), false);
});
