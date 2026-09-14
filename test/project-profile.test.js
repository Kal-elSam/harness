import test from "node:test";
import assert from "node:assert/strict";
import { computeProjectProfile, detectGitHotspots } from "../src/global/conversation/project-profile.js";

function fakeProject(overrides = {}) {
  return {
    root: "/repo/crm", name: "crm", purpose: "CRM", packageManager: "pnpm",
    stack: "React", architecturePattern: "Layered or Clean Architecture",
    detectedAdapters: [],
    commands: { install: "pnpm install", dev: "pnpm dev", lint: "pnpm lint", format: "Not configured", typeCheck: "Not configured", test: "pnpm test", build: "pnpm build" },
    ...overrides
  };
}

test("computeProjectProfile composes real evidence only — never invents a signal it couldn't collect", async () => {
  const profile = await computeProjectProfile({ cwd: "/repo/crm" }, {
    detectProject: async () => fakeProject(),
    resolveGitHeadSha: () => "a".repeat(40),
    probeGraphify: async () => ({ state: "available" }),
    inspectEngramIntegration: () => ({ status: "configured" }),
    detectGitHotspots: () => [{ path: "src/app.js", changes: 12 }]
  });
  assert.equal(profile.schema, "kairo.project-profile/v1");
  assert.equal(profile.projectName, "crm");
  assert.deepEqual(profile.stack, ["React"]);
  assert.equal(profile.quality.testCommand, "pnpm test");
  assert.equal(profile.quality.lintCommand, "pnpm lint");
  assert.deepEqual(profile.hotspots, [{ path: "src/app.js", changes: 12 }]);
  assert.equal(profile.confidence, "high", "real git + real stack + a real code-intelligence integration = high confidence");
});

test("computeProjectProfile never fabricates confidence for a project with no real git history", async () => {
  const profile = await computeProjectProfile({ cwd: "/repo/crm" }, {
    detectProject: async () => fakeProject(),
    resolveGitHeadSha: () => null,
    probeGraphify: async () => ({ state: "missing" }),
    inspectEngramIntegration: () => ({ status: "unconfigured" }),
    detectGitHotspots: () => []
  });
  assert.equal(profile.confidence, "low");
  assert.deepEqual(profile.hotspots, [], "no git HEAD means hotspots are never even attempted, never guessed");
});

test("computeProjectProfile marks medium confidence when git+stack are real but no code-intelligence integration is available", async () => {
  const profile = await computeProjectProfile({ cwd: "/repo/crm" }, {
    detectProject: async () => fakeProject(),
    resolveGitHeadSha: () => "a".repeat(40),
    probeGraphify: async () => ({ state: "missing" }),
    inspectEngramIntegration: () => ({ status: "unconfigured" }),
    detectGitHotspots: () => []
  });
  assert.equal(profile.confidence, "medium");
});

test("computeProjectProfile's real risks reflect only actually-missing commands, never a generic warning list", async () => {
  const profile = await computeProjectProfile({ cwd: "/repo/crm" }, {
    detectProject: async () => fakeProject({ commands: { install: "pnpm install", dev: "Not configured", lint: "Not configured", format: "Not configured", typeCheck: "Not configured", test: "Not configured", build: "pnpm build" } }),
    resolveGitHeadSha: () => "a".repeat(40),
    probeGraphify: async () => ({ state: "missing" }),
    inspectEngramIntegration: () => ({ status: "unconfigured" }),
    detectGitHotspots: () => []
  });
  assert.ok(profile.risks.some((r) => r.kind === "no-test-command"));
  assert.ok(profile.risks.some((r) => r.kind === "no-static-checks"));
});

test("computeProjectProfile's role requirements are strictly derived from real detected commands — Builder/Tester/Reviewer only appear when their real command exists", async () => {
  const minimalProject = fakeProject({
    stack: "Unknown",
    commands: { install: "npm install", dev: "Not configured", lint: "Not configured", format: "Not configured", typeCheck: "Not configured", test: "Not configured", build: "Not configured" }
  });
  const profile = await computeProjectProfile({ cwd: "/repo/crm" }, {
    detectProject: async () => minimalProject,
    resolveGitHeadSha: () => null,
    probeGraphify: async () => ({ state: "missing" }),
    inspectEngramIntegration: () => ({ status: "unconfigured" }),
    detectGitHotspots: () => []
  });
  const roles = profile.roleRequirements.map((r) => r.role);
  assert.ok(roles.includes("Explorer") && roles.includes("Architect"), "Explorer/Architect are always baseline");
  assert.ok(!roles.includes("Builder") && !roles.includes("Tester") && !roles.includes("Reviewer"), "no real command detected for these roles");
});

test("computeProjectProfile's fingerprint changes when the real git HEAD changes, and stays stable otherwise", async () => {
  const deps = {
    detectProject: async () => fakeProject(),
    probeGraphify: async () => ({ state: "missing" }),
    inspectEngramIntegration: () => ({ status: "unconfigured" }),
    detectGitHotspots: () => []
  };
  const first = await computeProjectProfile({ cwd: "/repo/crm" }, { ...deps, resolveGitHeadSha: () => "a".repeat(40) });
  const same = await computeProjectProfile({ cwd: "/repo/crm" }, { ...deps, resolveGitHeadSha: () => "a".repeat(40) });
  const changed = await computeProjectProfile({ cwd: "/repo/crm" }, { ...deps, resolveGitHeadSha: () => "b".repeat(40) });
  assert.equal(first.fingerprint, same.fingerprint);
  assert.notEqual(first.fingerprint, changed.fingerprint);
});

test("detectGitHotspots fails closed to an empty list on a non-git directory, never throwing", () => {
  const hotspots = detectGitHotspots("/repo/crm", { spawn: () => ({ status: 1, stdout: "" }) });
  assert.deepEqual(hotspots, []);
});

test("detectGitHotspots ranks real changed-file counts, most-changed first", () => {
  const hotspots = detectGitHotspots("/repo/crm", {
    spawn: () => ({ status: 0, stdout: "a.js\nb.js\na.js\nc.js\na.js\nb.js\n" })
  });
  assert.deepEqual(hotspots, [{ path: "a.js", changes: 3 }, { path: "b.js", changes: 2 }, { path: "c.js", changes: 1 }]);
});
