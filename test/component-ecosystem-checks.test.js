import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runComponentEcosystemChecks } from "../src/global/component-ecosystem-checks.js";
import { installGlobalHarness } from "../src/global/global-installer.js";
import { runGlobalDoctorChecks } from "../src/global/global-doctor.js";
import { resolveTargetComponents } from "../src/global/component-registry.js";
import { harnessHomePaths } from "../src/global/paths.js";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { hasManagedSection } from "../src/global/managed-section.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseOptions = { packageRoot, packageName: "@kal-elsam/kairo-runtime", cliVersion: "0.6.0" };

async function createFakeHome() {
  const homeDir = await mkdtemp(join(tmpdir(), "harness-ecosystem-home-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  await mkdir(join(homeDir, ".codex"), { recursive: true });
  return homeDir;
}

test("optional components list as bundled and not default", () => {
  const targets = resolveTargetComponents({
    components: ["engram-memory", "graphify-context"]
  });

  assert.deepEqual(targets.map((component) => component.id), ["engram-memory", "graphify-context"]);
  assert.ok(targets.every((component) => component.source === "bundled"));
  assert.ok(targets.every((component) => !component.defaultEnabled));
});

test("install copies engram-memory and graphify-context assets and managed sections", async () => {
  const homeDir = await createFakeHome();
  const paths = harnessHomePaths(homeDir);

  const result = await installGlobalHarness({
    ...baseOptions,
    homeDir,
    components: ["orchestrator", "engram-memory", "graphify-context"]
  });

  assert.deepEqual(result.components, ["orchestrator", "engram-memory", "graphify-context"]);
  assert.ok(existsSync(join(paths.root, "components", "engram-memory", "memory.md")));
  assert.ok(existsSync(join(paths.root, "components", "graphify-context", "context-graph.md")));

  const cursorConfig = await readFile(join(homeDir, ".cursor", "AGENTS.md"), "utf8");
  assert.ok(hasManagedSection(cursorConfig));
  assert.match(cursorConfig, /### Engram Memory/);
  assert.match(cursorConfig, /### Graphify Context/);
  assert.match(cursorConfig, /Authority: user > AGENTS\.md > repo docs > Engram > Graphify/);
});

test("engram ecosystem check warns about binary/config without failing doctor", async () => {
  const homeDir = await createFakeHome();
  await installGlobalHarness({
    ...baseOptions,
    homeDir,
    components: ["engram-memory"]
  });

  const { checks, ok } = await runGlobalDoctorChecks(homeDir, { packageRoot });
  const engramCheck = checks.find((check) => check.name === "engram:binary");

  assert.ok(engramCheck);
  assert.equal(engramCheck.componentId, "engram-memory");
  assert.ok(engramCheck.status === "ok" || engramCheck.status === "warning");
  assert.equal(ok, true);
});

test("graphify ecosystem checks report warning when graph output is absent", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-ws-"));
  const checks = await runComponentEcosystemChecks({
    installedComponents: resolveTargetComponents({ components: ["graphify-context"] }),
    workspaceRoot
  });

  const graphCheck = checks.find((check) => check.name === "graphify:graph.json");
  assert.equal(graphCheck.status, "warning");
  assert.match(graphCheck.detail, /graphify-out/);
});

test("graphify ecosystem checks detect stale graph from GRAPH_REPORT commit", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-graph-stale-"));
  await mkdir(join(workspaceRoot, "graphify-out"), { recursive: true });
  await writeFile(join(workspaceRoot, "graphify-out", "graph.json"), "{}\n");
  await writeFile(
    join(workspaceRoot, "graphify-out", "GRAPH_REPORT.md"),
    "# Graph Report\n\n## Graph Freshness\n- Built from commit: `deadbeef`\n"
  );

  initGitRepo(workspaceRoot, "cafefeed");

  const checks = await runComponentEcosystemChecks({
    installedComponents: resolveTargetComponents({ components: ["graphify-context"] }),
    workspaceRoot
  });

  const graphCheck = checks.find((check) => check.name === "graphify:graph.json");
  assert.equal(graphCheck.status, "warning");
  assert.match(graphCheck.detail, /stale/i);
});

test("graphify ecosystem checks skip workspace warning when no workspace root", async () => {
  const checks = await runComponentEcosystemChecks({
    installedComponents: resolveTargetComponents({ components: ["graphify-context"] }),
    workspaceRoot: null
  });

  const workspaceCheck = checks.find((check) => check.name === "graphify:workspace");
  assert.equal(workspaceCheck.status, "warning");
  assert.match(workspaceCheck.detail, /No workspace root/i);
  assert.equal(checks.find((check) => check.name === "graphify:graph.json"), undefined);
});

function initGitRepo(root, commitMessage) {
  const run = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };

  run(["init"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  run(["add", "-A"]);
  run(["commit", "-m", commitMessage]);
}
