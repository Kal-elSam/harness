import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PROFILE, buildProfileJson, resolveProfile, resolveTeamProviders, getGlobalProfilePath } from "../src/global/profile.js";
import { buildAiTeam, scoreAvailableModels } from "../src/global/intelligence/model-intelligence.js";
import { buildAccessVerificationPlan } from "../src/global/team/service.js";
import { runTeamProvidersCli } from "../src/global/team/providers-cli.js";
import { runTeamCli } from "../src/global/team/team-cli.js";
import { parseArgs } from "../src/cli.js";

async function withHome(profile, fn) {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-team-providers-"));
  try {
    if (profile !== undefined) {
      await mkdir(join(homeDir, ".harness"), { recursive: true });
      await writeFile(getGlobalProfilePath(homeDir), JSON.stringify(profile));
    }
    return await fn(homeDir);
  } finally { await rm(homeDir, { recursive: true, force: true }); }
}

const AA = [
  { slug: "model-a", name: "Model A", intelligenceIndex: 90, codingIndex: 60, mathIndex: null, priceInputPerMTok: 10, outputTokensPerSecond: 50 },
  { slug: "model-b", name: "Model B", intelligenceIndex: 50, codingIndex: 95, mathIndex: null, priceInputPerMTok: 2, outputTokensPerSecond: 200 }
];
const scored = () => scoreAvailableModels(
  [{ adapterId: "claude", models: [{ id: "model-a" }] }, { adapterId: "codex", models: [{ id: "model-b" }] }], AA);
const eligibility = { claude: { ok: true }, codex: { ok: true } };
const poolProviders = team => new Set(team.flatMap(entry => [entry.primary, entry.fallback]).filter(Boolean).map(model => model.adapterId));

const row = (providerId) => ({
  providerId, installation: { state: "installed" }, authentication: { state: "authenticated" },
  modelAccess: { models: [{ modelId: "real-model" }] }, quota: { state: "available", remainingPercent: 50 }
});

test("default profile keeps claude and codex as team providers", async () => {
  assert.deepEqual(DEFAULT_PROFILE.teamProviders, ["claude", "codex"]);
  await withHome(undefined, async homeDir => {
    assert.deepEqual(await resolveTeamProviders({ homeDir }), ["claude", "codex"]);
  });
});

test("a profile without teamProviders behaves exactly as today", async () => {
  await withHome({ applyMode: "prompt", cloudConsent: false }, async homeDir => {
    assert.deepEqual(await resolveTeamProviders({ homeDir }), ["claude", "codex"]);
    const resolved = await resolveProfile({ homeDir, workspaceRoot: homeDir });
    assert.deepEqual(resolved.profile.teamProviders, ["claude", "codex"]);
    assert.deepEqual(buildProfileJson(resolved).teamProviders, ["claude", "codex"]);
    const pools = poolProviders(buildAiTeam(scored(), eligibility, undefined, undefined, { teamProviders: await resolveTeamProviders({ homeDir }) }));
    assert.deepEqual([...pools].sort(), ["claude", "codex"]);
  });
});

test("a profile with only claude restricts team role pools to Claude models", async () => {
  await withHome({ teamProviders: ["claude"] }, async homeDir => {
    const teamProviders = await resolveTeamProviders({ homeDir });
    assert.deepEqual(teamProviders, ["claude"]);
    const team = buildAiTeam(scored(), eligibility, undefined, undefined, { teamProviders });
    assert.deepEqual([...poolProviders(team)], ["claude"]);
    const plan = buildAccessVerificationPlan({ eligibility, claudeModels: [{ id: "model-a" }], teamProviders });
    assert.ok(plan.subscriptions.every(sub => sub.adapterId === "claude"));
  });
});

test("unknown, empty and non-array teamProviders are rejected with the allowed ids", async () => {
  for (const bad of [["claude", "nope"], [], "claude"]) {
    await withHome({ teamProviders: bad }, async homeDir => {
      await assert.rejects(resolveTeamProviders({ homeDir }), /teamProviders.*(claude, codex|Use)/);
    });
  }
  await withHome({ teamProviders: ["nope"] }, async homeDir => {
    await assert.rejects(resolveProfile({ homeDir, workspaceRoot: homeDir }), /Unknown provider "nope" in teamProviders\. Use claude, codex, cursor, opencode-go/);
  });
});

test("kairo team providers marks providers outside teamProviders as not_configured", async () => {
  await withHome({ teamProviders: ["claude"] }, async homeDir => {
    const lines = [];
    const result = await runTeamProvidersCli({ json: true, cwd: homeDir }, {
      homeDir, status: async () => ({ providers: [row("claude"), row("codex")] }), log: line => lines.push(line)
    });
    const byId = Object.fromEntries(result.providers.map(provider => [provider.providerId, provider]));
    assert.equal(byId.claude.configured, true);
    assert.equal(byId.claude.available, true);
    assert.equal(byId.codex.configured, false);
    assert.equal(byId.codex.available, false);
    assert.equal(byId.codex.reason, "not_configured");
  });
});

test("--enable and --disable round-trip through the profile", async () => {
  await withHome({ applyMode: "confirm" }, async homeDir => {
    const log = () => {};
    await runTeamCli({ teamAction: "providers", enable: "cursor" }, { homeDir, log });
    assert.deepEqual(await resolveTeamProviders({ homeDir }), ["claude", "codex", "cursor"]);
    await runTeamCli({ teamAction: "providers", disable: "codex" }, { homeDir, log });
    assert.deepEqual(await resolveTeamProviders({ homeDir }), ["claude", "cursor"]);
    const saved = JSON.parse(await readFile(getGlobalProfilePath(homeDir), "utf8"));
    assert.equal(saved.applyMode, "confirm");
    await assert.rejects(runTeamCli({ teamAction: "providers", enable: "nope" }, { homeDir, log }), /Unknown provider "nope"/);
    await runTeamCli({ teamAction: "providers", disable: "cursor" }, { homeDir, log });
    await assert.rejects(runTeamCli({ teamAction: "providers", disable: "claude" }, { homeDir, log }), /non-empty/);
  });
});

test("providers parser reads --enable and --disable; other providers flags unchanged", () => {
  assert.equal(parseArgs(["team", "providers", "--enable", "cursor"]).options.enable, "cursor");
  assert.equal(parseArgs(["team", "providers", "--disable", "codex"]).options.disable, "codex");
  const plain = parseArgs(["team", "providers", "--json", "--cwd", "/project"]);
  assert.equal(plain.options.json, true);
  assert.equal(plain.options.enable, undefined);
});

test("opencode and pi are rejected; opencode gets an opencode-go hint", async () => {
  await withHome({ teamProviders: ["opencode"] }, async homeDir => {
    await assert.rejects(resolveTeamProviders({ homeDir }), /opencode-go/);
  });
  await withHome({ teamProviders: ["pi"] }, async homeDir => {
    await assert.rejects(resolveTeamProviders({ homeDir }), /Unknown provider "pi"/);
  });
});

test("a project kairo.json teamProviders overrides the global profile and blocks --enable", async () => {
  await withHome({ teamProviders: ["claude", "codex"] }, async homeDir => {
    const project = await mkdtemp(join(tmpdir(), "kairo-proj-"));
    try {
      await mkdir(join(project, ".harness"), { recursive: true });
      await writeFile(join(project, ".harness", "kairo.json"), JSON.stringify({ teamProviders: ["claude"] }));
      assert.deepEqual(await resolveTeamProviders({ homeDir, workspaceRoot: project }), ["claude"]);
      await assert.rejects(
        runTeamCli({ teamAction: "providers", enable: "cursor", cwd: project }, { homeDir, resolveRoot: async () => project, log: () => {} }),
        /project profile .*kairo\.json.*claude/
      );
      assert.deepEqual(await resolveTeamProviders({ homeDir }), ["claude", "codex"]);
      const lines = [];
      const result = await runTeamProvidersCli({ json: true, cwd: project }, {
        homeDir, resolveRoot: async () => project, status: async () => ({ providers: [row("codex")] }), log: line => lines.push(line)
      });
      assert.equal(result.providers[0].reason, "not_configured");
    } finally { await rm(project, { recursive: true, force: true }); }
  });
});

test("readProjectStrategy keeps a suggested strategy that uses an enabled non-default provider, and drops a disabled one", async () => {
  const { readProjectStrategy, writeProjectStrategy } = await import("../src/global/team/project-strategy-store.js");
  await withHome({ teamProviders: ["claude", "opencode-go"] }, async homeDir => {
    const project = await mkdtemp(join(tmpdir(), "kairo-proj-"));
    try {
      const model = adapterId => ({ adapterId, modelId: "m" });
      const strategy = adapterId => ({ status: "suggested", projectTeam: [{ role: "Builder", model: model(adapterId) }] });
      await writeProjectStrategy(homeDir, project, strategy("opencode-go"));
      assert.equal((await readProjectStrategy(homeDir, project))?.status, "suggested");
      await writeProjectStrategy(homeDir, project, strategy("codex"));
      assert.equal(await readProjectStrategy(homeDir, project), null);
    } finally { await rm(project, { recursive: true, force: true }); }
  });
});

test("readTeamRoute never routes to a provider the user disabled", async t => {
  const { fixture } = await import("./team-route-fixture.test.js");
  const { readTeamRoute } = await import("../src/global/team/routing-input-cache.js");
  const f = await fixture(t);
  await f.cache();
  const before = await readTeamRoute({ homeDir: f.home, cwd: f.cwd, role: "Builder" }, { teamProviders: ["claude", "codex"] });
  assert.equal(before.provider, "codex");
  const after = await readTeamRoute({ homeDir: f.home, cwd: f.cwd, role: "Builder" }, { teamProviders: ["claude"] });
  assert.notEqual(after.provider, "codex");
  assert.match(after.why, /Not configured for team roles: codex/);
});

test("aptitude invoke adapter allows only configured providers", async () => {
  const { createRunInvokeAdapter } = await import("../src/global/intelligence/role-aptitude-invoke.js");
  const adapter = createRunInvokeAdapter({ homeDir: "/nonexistent", startRun: async () => ({}), teamProviders: ["claude"] });
  await assert.rejects(Promise.resolve().then(() => adapter({ probe: {}, identity: { adapterId: "codex" }, limits: { absoluteTimeoutMs: 1 } })), /not allowed/);
});
