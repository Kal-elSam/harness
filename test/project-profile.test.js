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
  assert.deepEqual(profile.roleRequirements.map(({ role, source }) => ({ role, source })), [
    { role: "Explorer", source: "template" }, { role: "Architect", source: "template" },
    { role: "Builder", source: "command" }, { role: "Tester", source: "command" },
    { role: "Debugger", source: "command" }, { role: "Reviewer", source: "command" },
    { role: "Verifier", source: "profile" }
  ]);
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

test("computeProjectProfile's role requirements are derived from real detected commands — Builder needs a command/stack; Tester/Reviewer appear as gap roles when their tooling is missing", async () => {
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
  assert.ok(!roles.includes("Builder") && !roles.includes("Debugger"), "no real command detected for these roles");
  assert.equal(profile.roleRequirements.find((r) => r.role === "Tester").source, "gap");
  assert.equal(profile.roleRequirements.find((r) => r.role === "Reviewer").source, "gap");
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

const profileDeps = {
  resolveGitHeadSha: () => null, probeGraphify: async () => ({ state: "missing" }),
  inspectEngramIntegration: () => ({ status: "unconfigured" }), detectGitHotspots: () => []
};

test("Package.swift implies Swift stack, swift build and swift test (S38)", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = await mkdtemp(join(tmpdir(), "kairo-swift-"));
  try {
    await writeFile(join(root, "Package.swift"), "// swift-tools-version:5.9\n");
    const profile = await computeProjectProfile({ cwd: root }, profileDeps);
    assert.deepEqual(profile.stack, ["Swift"]);
    assert.equal(profile.quality.buildCommand, "swift build");
    assert.equal(profile.quality.testCommand, "swift test");
    assert.ok(profile.roleRequirements.some((r) => r.role === "Builder" && r.source === "command"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("no detected test command still yields a gap-sourced Tester; Debugger keeps requiring a test command (S36)", async () => {
  const noTests = fakeProject({ commands: { ...fakeProject().commands, test: "Not configured" } });
  const profile = await computeProjectProfile({ cwd: "/repo/crm" }, { ...profileDeps, detectProject: async () => noTests });
  const tester = profile.roleRequirements.find((r) => r.role === "Tester");
  assert.equal(tester.source, "gap");
  assert.match(tester.reason, /missing tests/);
  assert.ok(!profile.roleRequirements.some((r) => r.role === "Debugger"));
});

test("no detected lint/typecheck still yields a gap-sourced Reviewer (S36)", async () => {
  const noLint = fakeProject({ commands: { ...fakeProject().commands, lint: "Not configured", typeCheck: "Not configured" } });
  const profile = await computeProjectProfile({ cwd: "/repo/crm" }, { ...profileDeps, detectProject: async () => noLint });
  const reviewer = profile.roleRequirements.find((r) => r.role === "Reviewer");
  assert.equal(reviewer.source, "gap");
  assert.match(reviewer.reason, /missing static checks/);
});

test("a project with tests keeps its command-sourced Tester (regression, S36)", async () => {
  const profile = await computeProjectProfile({ cwd: "/repo/crm" }, { ...profileDeps, detectProject: async () => fakeProject() });
  assert.equal(profile.roleRequirements.find((r) => r.role === "Tester").source, "command");
  assert.equal(profile.roleRequirements.filter((r) => r.role === "Tester").length, 1);
});


// S40 profile-only activation also covers offline and v1 analysis.
test("S40 profile activation rules turn on only from detected project signals", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const cases = [
    ["split Builders", { dependencies: { react: "1", express: "1" } }, [], ["Frontend Builder", "Backend Builder"]],
    ["API routes", { dependencies: { next: "1" } }, ["app/api/ping/route.js"], ["Frontend Builder", "Backend Builder"]],
    ["CI", {}, [".github/workflows/check.yml"], ["DevOps"]],
    ["Docker", {}, ["Dockerfile"], ["DevOps"]],
    ["Vercel", {}, ["vercel.json"], ["DevOps"]],
    ["Fly", {}, ["fly.toml"], ["DevOps"]],
    ["docs", {}, ["docs/readme.md"], ["Documenter"]],
    ["library exports", { exports: "./index.js" }, [], ["Documenter"]],
    ["library files", { files: ["src"] }, [], ["Documenter"]],
    ["private library", { private: true, exports: "./index.js" }, [], []],
    ["UI only", { dependencies: { react: "1" } }, [], []],
    ["server only", { dependencies: { express: "1" } }, [], []],
    ["empty", {}, [], []]
  ];
  for (const [name, pkg, files, expected] of cases) {
    const root = await mkdtemp(join(tmpdir(), "s40-profile-"));
    try {
      await writeFile(join(root, "package.json"), JSON.stringify(pkg));
      for (const path of files) {
        await mkdir(join(root, path, ".."), { recursive: true });
        await writeFile(join(root, path), "");
      }
      const result = await computeProjectProfile({ cwd: root }, { ...profileDeps, detectProject: async () => fakeProject({ stack: "Unknown" }) });
      const roles = result.roleRequirements.map(r => r.role);
      for (const role of ["Frontend Builder", "Backend Builder", "DevOps", "Documenter"]) {
        assert.equal(roles.includes(role), expected.includes(role), `${name}: ${role}`);
      }
      assert.equal(roles.includes("Builder"), !expected.includes("Frontend Builder"), name);
      for (const role of ["Planner", "Security Reviewer", "Refactorer"]) assert.ok(!roles.includes(role), `${name}: offline ${role}`);
      assert.ok(roles.includes("Explorer") && roles.includes("Architect"));
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
test("S40 Verifier activates with tests and stays off without them", async () => {
  for (const testCommand of ["pnpm test", "Not configured"]) {
    const result = await computeProjectProfile({ cwd: "/repo/crm" }, { ...profileDeps,
      detectProject: async () => fakeProject({ commands: { ...fakeProject().commands, test: testCommand } }) });
    assert.equal(result.roleRequirements.some(r => r.role === "Verifier"), testCommand !== "Not configured");
  }
});
