import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatProfileSourcesLabel,
  formatSystemHealthLines
} from "../src/global/operations/system-health.js";
import { isRunCancellable } from "../src/global/operations/run-cancellable.js";
import { buildReadOnlyDiagnostics } from "../src/global/action-planner.js";
import { getProjectProfilePath, saveGlobalProfile } from "../src/global/profile.js";
import { RUN_STATES } from "../src/global/runtime/run-types.js";

// Scenarios moved from the retired orchestrator-state test. The legacy
// formatDiagnosticsLines wrapper just delegated to formatSystemHealthLines, so its
// scenario now calls formatSystemHealthLines directly.

const sampleDiagnostics = {
  cliVersion: "0.2.0",
  diagnostics: {
    detected: 2,
    available: 1,
    unknown: 1,
    errors: 0
  },
  capabilities: [
    {
      id: "cursor",
      label: "Cursor",
      state: "available",
      version: "1.0.0",
      authenticated: true
    },
    {
      id: "codex",
      label: "Codex",
      state: "unknown",
      version: null,
      authenticated: null
    }
  ],
  recommendations: ["Install Codex CLI."]
};

test("formatSystemHealthLines separates agents, intelligence, auth, and configuration", () => {
  const lines = formatSystemHealthLines({
    ...sampleDiagnostics,
    intelligence: {
      summary: { localAvailable: false, cloudAuthenticated: false },
      routingPreview: { reason: "No backend" }
    },
    profile: {
      sources: {
        global: "/tmp/home/.harness/profile.json",
        project: "/tmp/project/.harness/kairo.json"
      }
    }
  });
  const text = lines.join("\n");

  assert.match(text, /^Agents$/m);
  assert.match(text, /Detected: 2\/2/);
  assert.match(text, /^Intelligence$/m);
  assert.match(text, /^Authentication$/m);
  assert.match(text, /^Configuration$/m);
  assert.match(text, /CLI version: 0\.2\.0/);
  assert.match(text, /Profile sources: global, project/);
  assert.match(text, /Cursor/);
  assert.match(text, /Codex/);
  assert.match(text, /Recommendations/);
});

test("formatProfileSourcesLabel formats only active sources from real contract", () => {
  assert.equal(formatProfileSourcesLabel({
    global: "/tmp/.harness/profile.json",
    project: "/tmp/project/.harness/kairo.json"
  }), "global, project");
  assert.equal(formatProfileSourcesLabel({
    global: "/tmp/.harness/profile.json",
    project: null
  }), "global");
  assert.equal(formatProfileSourcesLabel({
    global: null,
    project: "/tmp/project/.harness/kairo.json"
  }), "project");
  assert.equal(formatProfileSourcesLabel({ global: null, project: null }), "none");
  assert.equal(formatProfileSourcesLabel(undefined), "none");
});

test("formatSystemHealthLines accepts real buildReadOnlyDiagnostics profile.sources object", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-health-home-"));
  const workspaceRoot = await mkdtemp(join(tmpdir(), "kairo-health-ws-"));
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

  await saveGlobalProfile(homeDir, {
    coordinator: "codex",
    defaultAgents: "all",
    defaultComponents: ["orchestrator"],
    applyMode: "prompt"
  });
  await mkdir(join(workspaceRoot, ".harness"), { recursive: true });
  await writeFile(
    getProjectProfilePath(workspaceRoot),
    `${JSON.stringify({ coordinator: "cursor" })}\n`,
    "utf8"
  );

  const diagnostics = await buildReadOnlyDiagnostics({
    homeDir,
    workspaceRoot,
    packageName: "@kal-elsam/kairo-runtime",
    packageRoot,
    cliVersion: "0.4.3"
  });

  assert.equal(typeof diagnostics.profile.sources, "object");
  assert.equal(Array.isArray(diagnostics.profile.sources), false);
  assert.ok(diagnostics.profile.sources.global);
  assert.ok(diagnostics.profile.sources.project);

  const lines = formatSystemHealthLines(diagnostics);
  const text = lines.join("\n");
  assert.match(text, /Profile sources: global, project/);
  assert.doesNotMatch(text, /\[object Object\]/);
});

test("isRunCancellable only allows active states", () => {
  assert.equal(isRunCancellable({ state: RUN_STATES.RUNNING }), true);
  assert.equal(isRunCancellable({ state: RUN_STATES.COMPLETED }), false);
});
