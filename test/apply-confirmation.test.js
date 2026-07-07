import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assertExplicitApplyConsent,
  promptApplyConfirmation,
  shouldPromptApplyConfirmation
} from "../src/global/apply-confirmation.js";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { runHarnessSetup } from "../src/global/setup.js";
import { runHarnessSync } from "../src/global/sync.js";
import { runHarnessUpgrade } from "../src/global/upgrade.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");
const baseOptions = {
  packageRoot,
  packageName: "@kal-elsam/kairo-runtime",
  cliVersion: "0.18.0"
};

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-confirm-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# user-owned content\n");
  }

  return homeDir;
}

function runHarness(args, homeDir) {
  return spawnSync(process.execPath, [harnessBin, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: { ...process.env, HARNESS_HOME: homeDir }
  });
}

test("shouldPromptApplyConfirmation only applies in interactive apply mode", () => {
  assert.equal(
    shouldPromptApplyConfirmation({ applying: true, interactive: true }),
    true
  );
  assert.equal(
    shouldPromptApplyConfirmation({ applying: true, interactive: false }),
    false
  );
  assert.equal(
    shouldPromptApplyConfirmation({ applying: true, interactive: true, confirm: true }),
    false
  );
  assert.equal(
    shouldPromptApplyConfirmation({ applying: false, interactive: true }),
    false
  );
  assert.equal(
    shouldPromptApplyConfirmation({ applying: true, interactive: true, dryRun: true }),
    false
  );
  assert.equal(
    shouldPromptApplyConfirmation({ applying: true, interactive: true, json: true }),
    false
  );
});

test("assertExplicitApplyConsent requires explicit flags in non-interactive apply mode", () => {
  assert.doesNotThrow(() => assertExplicitApplyConsent({
    applying: true,
    interactive: false,
    yes: true,
    command: "sync"
  }));

  assert.doesNotThrow(() => assertExplicitApplyConsent({
    applying: true,
    interactive: false,
    confirm: true,
    command: "sync"
  }));

  assert.doesNotThrow(() => assertExplicitApplyConsent({
    applying: true,
    interactive: false,
    noPreflight: true,
    command: "sync"
  }));

  assert.throws(
    () => assertExplicitApplyConsent({
      applying: true,
      interactive: false,
      command: "sync"
    }),
    /Non-interactive sync requires --yes, --confirm, or --no-preflight/
  );
});

test("promptApplyConfirmation declines on no", async () => {
  const approved = await promptApplyConfirmation({
    command: "sync",
    createPrompt: () => {
      const prompt = async () => "no";
      prompt.close = async () => {};
      return prompt;
    }
  });

  assert.equal(approved, false);
});

test("sync interactive decline cancels without writing", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const assetPath = join(
    harnessHomePaths(homeDir).root,
    "components",
    "sdd-core",
    "workflow.md"
  );
  await unlink(assetPath);

  const outcome = await runHarnessSync({
    ...baseOptions,
    homeDir,
    interactive: true,
    createPrompt: () => {
      const prompt = async () => "n";
      prompt.close = async () => {};
      return prompt;
    }
  });

  assert.equal(outcome.action, "cancelled");
  assert.equal(outcome.wrote, false);
  assert.equal(existsSync(assetPath), false);
});

test("sync --confirm applies without interactive prompt", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const assetPath = join(
    harnessHomePaths(homeDir).root,
    "components",
    "sdd-core",
    "workflow.md"
  );
  await unlink(assetPath);

  let prompted = false;
  const outcome = await runHarnessSync({
    ...baseOptions,
    homeDir,
    confirm: true,
    interactive: true,
    createPrompt: () => {
      prompted = true;
      const prompt = async () => "n";
      prompt.close = async () => {};
      return prompt;
    }
  });

  assert.equal(prompted, false);
  assert.equal(outcome.action, "repaired");
  assert.equal(existsSync(assetPath), true);
});

test("non-interactive setup without explicit consent fails fast", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  await assert.rejects(
    () => runHarnessSetup({
      ...baseOptions,
      homeDir,
      agents: ["cursor"],
      interactive: false
    }),
    /Non-interactive setup requires/
  );
  assert.equal(existsSync(paths.statePath), false);
});

test("non-interactive setup --confirm applies with preflight", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    agents: ["cursor"],
    confirm: true,
    interactive: false
  });

  assert.equal(outcome.cancelled, false);
  assert.equal(existsSync(paths.statePath), true);
  assert.ok(existsSync(join(homeDir, ".cursor", "AGENTS.md")));
});

test("kairo setup --agents cursor in non-TTY rejects without consent", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const cli = runHarness(["setup", "--agents", "cursor"], homeDir);
  assert.notEqual(cli.status, 0, cli.stderr);
  assert.match(cli.stderr, /Non-interactive setup requires/);
  assert.equal(existsSync(paths.statePath), false);
});

test("kairo setup --confirm --agents cursor applies with preflight", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const cli = runHarness(["setup", "--confirm", "--agents", "cursor"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Kairo Runtime preflight — setup/);
  assert.equal(existsSync(paths.statePath), true);
  assert.ok(existsSync(join(homeDir, ".cursor", "AGENTS.md")));
});

test("kairo setup --dry-run --agents cursor writes nothing", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const cli = runHarness(["setup", "--dry-run", "--agents", "cursor"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Dry run: nothing was written/);
  assert.equal(existsSync(paths.statePath), false);
});

test("setup --yes interactive decline cancels after preflight", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    yes: true,
    agents: ["cursor"],
    interactive: true,
    createPrompt: () => {
      const prompt = async () => "no";
      prompt.close = async () => {};
      return prompt;
    }
  });

  assert.equal(outcome.cancelled, true);
  assert.equal(existsSync(paths.statePath), false);
});

test("non-interactive sync without explicit consent fails fast", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const assetPath = join(
    harnessHomePaths(homeDir).root,
    "components",
    "sdd-core",
    "workflow.md"
  );
  await unlink(assetPath);

  await assert.rejects(
    () => runHarnessSync({
      ...baseOptions,
      homeDir,
      interactive: false
    }),
    /Non-interactive sync requires/
  );
});

test("non-interactive sync --yes CLI applies without blocking", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({ ...baseOptions, homeDir });

  const assetPath = join(
    harnessHomePaths(homeDir).root,
    "components",
    "sdd-core",
    "workflow.md"
  );
  await unlink(assetPath);

  const cli = runHarness(["sync", "--yes"], homeDir);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /Applied repairs:/);
  assert.equal(existsSync(assetPath), true);
});

test("upgrade interactive decline cancels without writing", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);
  await installGlobalHarness({ ...baseOptions, homeDir });

  const stateBefore = await readFile(paths.statePath, "utf8");

  const outcome = await runHarnessUpgrade({
    ...baseOptions,
    homeDir,
    yes: true,
    interactive: true,
    fetchVersion: async () => "9.9.9",
    createPrompt: () => {
      const prompt = async () => "no";
      prompt.close = async () => {};
      return prompt;
    }
  });

  assert.equal(outcome.cancelled, true);
  assert.equal(outcome.wrote, false);
  assert.equal(await readFile(paths.statePath, "utf8"), stateBefore);
});

test("upgrade --confirm applies without interactive prompt", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  await installGlobalHarness({ ...baseOptions, homeDir });

  let prompted = false;
  const outcome = await runHarnessUpgrade({
    ...baseOptions,
    homeDir,
    yes: true,
    confirm: true,
    interactive: true,
    fetchVersion: async () => "9.9.9",
    createPrompt: () => {
      prompted = true;
      const prompt = async () => "no";
      prompt.close = async () => {};
      return prompt;
    }
  });

  assert.equal(prompted, false);
  assert.equal(outcome.wrote, true);
});
