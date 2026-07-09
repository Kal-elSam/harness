import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProfileJson,
  getGlobalProfilePath,
  getProjectProfilePath,
  resolveProfile,
  resolveProfileAgents,
  saveGlobalProfile
} from "../src/global/profile.js";

test("global and project profile precedence favors project", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-profile-home-"));
  const workspaceRoot = await mkdtemp(join(tmpdir(), "kairo-profile-workspace-"));

  await saveGlobalProfile(homeDir, {
    coordinator: "codex",
    defaultAgents: "all",
    defaultComponents: ["orchestrator"],
    applyMode: "prompt"
  });

  await mkdir(join(workspaceRoot, ".harness"), { recursive: true });
  await writeFile(
    getProjectProfilePath(workspaceRoot),
    `${JSON.stringify({ coordinator: "cursor", defaultAgents: ["cursor"] })}\n`,
    "utf8"
  );

  const resolved = await resolveProfile({ homeDir, workspaceRoot });
  const json = buildProfileJson(resolved);

  assert.equal(resolved.profile.coordinator, "cursor");
  assert.deepEqual(resolved.profile.defaultAgents, ["cursor"]);
  assert.deepEqual(resolved.profile.defaultComponents, ["orchestrator"]);
  assert.equal(json.sources.project, getProjectProfilePath(workspaceRoot));
  assert.equal(json.sources.global, getGlobalProfilePath(homeDir));
});

test("resolveProfileAgents honors detected agents", () => {
  const agents = resolveProfileAgents({ defaultAgents: "detected" }, ["cursor", "codex"]);
  assert.deepEqual(agents, ["cursor", "codex"]);
});

test("profile files never include credential fields", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-profile-creds-"));
  await saveGlobalProfile(homeDir, {
    coordinator: null,
    defaultAgents: "detected",
    defaultComponents: null,
    applyMode: "prompt"
  });

  const resolved = await resolveProfile({ homeDir, workspaceRoot: homeDir });
  const keys = Object.keys(resolved.profile);
  assert.equal(keys.includes("token"), false);
  assert.equal(keys.includes("apiKey"), false);
});
