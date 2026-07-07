import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runHarnessSetup, shouldUseSetupInk, shouldUseSetupWizard } from "../src/global/setup.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { formatInkSuccessLines } from "../src/global/ink/setup-state.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliVersion = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8")
).version;
const baseOptions = {
  packageRoot,
  packageName: "@kal-elsam/kairo-runtime",
  cliVersion
};

async function createFakeHome({ withCursorConfig = false } = {}) {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-ink-setup-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });

  if (withCursorConfig) {
    await writeFile(join(homeDir, ".cursor", "AGENTS.md"), "# user-owned content\n");
  }

  return homeDir;
}

function createMockInkRunner({ cancelled = false, agents = ["cursor", "codex"], components = ["orchestrator", "sdd-core"] } = {}) {
  return async () => ({
    cancelled,
    usedWizard: true,
    agents,
    components,
    noDefaultComponents: false,
    preview: { agents, components, preflight: { changes: [], preserved: [] } }
  });
}

test("runHarnessSetup mocked Ink applies and marks usedInk", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    interactive: true,
    inkCapable: true,
    runSetupInkImpl: createMockInkRunner()
  });

  assert.equal(outcome.usedInk, true);
  assert.equal(outcome.usedWizard, true);
  assert.equal(outcome.cancelled, false);
  assert.ok(existsSync(paths.statePath));
});

test("runHarnessSetup mocked Ink cancel writes nothing", async () => {
  const homeDir = await createFakeHome({ withCursorConfig: true });
  const paths = harnessHomePaths(homeDir);

  const outcome = await runHarnessSetup({
    ...baseOptions,
    homeDir,
    interactive: true,
    inkCapable: true,
    runSetupInkImpl: createMockInkRunner({ cancelled: true })
  });

  assert.equal(outcome.cancelled, true);
  assert.equal(outcome.usedInk, true);
  assert.equal(existsSync(paths.statePath), false);
});

test("simple flag routes to Clack when ink capable", () => {
  assert.equal(shouldUseSetupInk({ interactive: true, simple: true, inkCapable: true }), false);
  assert.equal(shouldUseSetupWizard({ interactive: true, simple: true, inkCapable: true }), true);
});

test("formatInkSuccessLines snapshot", () => {
  const lines = formatInkSuccessLines({
    stateRoot: "/tmp/.harness",
    agents: ["cursor"],
    components: ["orchestrator"]
  }, { dryRun: false });

  assert.match(lines.join("\n"), /Setup complete/);
  assert.match(lines.join("\n"), /kairo status/);
});
