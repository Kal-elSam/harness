import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GENTLE_WORKFLOW_ROLES, loadProjectRoleCatalog, agentNameToRole, catalogRoleCapabilities
} from "../src/global/intelligence/role-catalog.js";
import { ROLE_REGISTRY, withRoleCatalog } from "../src/global/intelligence/role-registry.js";
import { roleDemandFloor } from "../src/global/intelligence/role-demand.js";
import { getRoleProfile } from "../src/global/intelligence/role-profiles.js";
import {
  buildAiTeam, scoreAvailableModels, bestModelPerRoleGlobal
} from "../src/global/intelligence/model-intelligence.js";

function project(roles) {
  const root = mkdtempSync(join(tmpdir(), "kairo-roles-"));
  if (roles !== undefined) {
    mkdirSync(join(root, ".kairo"));
    writeFileSync(join(root, ".kairo", "roles.json"), typeof roles === "string" ? roles : JSON.stringify(roles));
  }
  return root;
}
const withProject = (roles, fn) => {
  const root = project(roles);
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
};

const AA = [
  { slug: "model-a", name: "Model A", intelligenceIndex: 90, codingIndex: 60, mathIndex: null, priceInputPerMTok: 10, outputTokensPerSecond: 50 },
  { slug: "model-b", name: "Model B", intelligenceIndex: 50, codingIndex: 95, mathIndex: null, priceInputPerMTok: 2, outputTokensPerSecond: 200 }
];
const scored = () => scoreAvailableModels(
  [{ adapterId: "claude", models: [{ id: "model-a" }] }, { adapterId: "codex", models: [{ id: "model-b" }] }], AA);
const eligibility = { claude: { ok: true }, codex: { ok: true } };
const opts = extra => ({ teamProviders: ["claude", "codex"], ...extra });

test("catalog holds the 14 built-ins plus gentle roles with their source role recorded", () => {
  withProject(undefined, root => {
    const catalog = loadProjectRoleCatalog({ projectRoot: root });
    assert.deepEqual(catalog.warnings, []);
    for (const id of Object.keys(ROLE_REGISTRY)) assert.equal(catalog.registry[id].owner, "kairo");
    assert.equal(Object.keys(ROLE_REGISTRY).length, 14);
    assert.deepEqual(Object.keys(GENTLE_WORKFLOW_ROLES), [
      "odd-explorer", "odd-worker", "odd-verify", "review-risk", "review-resilience", "review-readability",
      "review-reliability", "review-refuter", "jd-judge-a", "jd-judge-b", "jd-fix-agent"]);
    for (const [id, spec] of Object.entries(GENTLE_WORKFLOW_ROLES)) {
      const entry = catalog.registry[id];
      assert.equal(entry.owner, "gentle-ai");
      assert.equal(entry.sourceRole, spec.sourceRole);
      assert.deepEqual(entry.capabilities, ROLE_REGISTRY[spec.sourceRole].capabilities);
      assert.equal(entry.tier, ROLE_REGISTRY[spec.sourceRole].tier);
    }
    assert.equal(catalog.registry["odd-worker"].sourceRole, "Builder");
    assert.equal(catalog.registry["review-risk"].sourceRole, "Security Reviewer");
  });
});

test("a user role is added and gets a model through the existing capability selection", () => {
  withProject({ roles: [{ id: "Data Wrangler", description: "Cleans data", capabilities: ["coding", "terminalExecution"] }] }, root => {
    const catalog = loadProjectRoleCatalog({ projectRoot: root });
    assert.equal(catalog.registry["Data Wrangler"].owner, "user");
    const roleCapabilities = catalogRoleCapabilities(catalog, ["Data Wrangler"]);
    const team = buildAiTeam(scored(), eligibility, null, roleCapabilities, opts({ roleCatalog: catalog }));
    const entry = team.find(t => t.role === "Data Wrangler");
    assert.ok(entry, "user role present in team");
    assert.equal(entry.primary.modelId, "model-b");
  });
});

test("a user role with the same id overrides a built-in floor and records the override", () => {
  withProject({ roles: [{ id: "Reviewer", qualityFloor: 0.9, agents: ["team-reviewer"] }] }, root => {
    const catalog = loadProjectRoleCatalog({ projectRoot: root });
    assert.deepEqual(catalog.overrides, ["Reviewer"]);
    assert.equal(catalog.registry.Reviewer.owner, "kairo");
    assert.equal(ROLE_REGISTRY.Reviewer.tier, "demanding");
    assert.equal(roleDemandFloor("Reviewer"), 0.6);
    // Floor applies only inside the catalog scope.
    assert.equal(withRoleCatalog(catalog, () => roleDemandFloor("Reviewer")), 0.9);
    assert.equal(roleDemandFloor("Reviewer"), 0.6);
    const scoped = buildAiTeam(scored(), eligibility, null, catalogRoleCapabilities(catalog, ["Reviewer"]), opts({ roleCatalog: catalog }));
    assert.ok(scoped.find(t => t.role === "Reviewer"));
    assert.equal(catalog.registry.Reviewer.floor, 0.9);
    assert.deepEqual(catalog.registry.Reviewer.agents, ["team-reviewer"]);
    assert.equal(getRoleProfile("Reviewer", catalog).role, "Reviewer");
  });
});

test("an invalid roles file yields warnings with field paths and intact built-ins, never throws", () => {
  for (const bad of ["{not json", { roles: [{ id: "X", description: "d", capabilities: ["telepathy"] }] }, { roles: "nope" }]) {
    withProject(bad, root => {
      const catalog = loadProjectRoleCatalog({ projectRoot: root });
      assert.ok(catalog.warnings.length >= 1);
      assert.ok(!catalog.registry.X);
      assert.equal(Object.keys(catalog.registry).length, 14 + 11);
    });
  }
  withProject({ roles: [{ id: "X", description: "d", capabilities: ["telepathy"] }] }, root => {
    const { warnings } = loadProjectRoleCatalog({ projectRoot: root });
    assert.match(warnings.join("\n"), /roles\[0\]\.capabilities\[0\]/);
  });
});

test("duplicate agent names warn and the first role wins deterministically", () => {
  withProject({ roles: [
    { id: "Alpha", description: "a", capabilities: ["coding"], agents: ["team-x"] },
    { id: "Beta", description: "b", capabilities: ["coding"], agents: ["team-x", "team-y"] }
  ] }, root => {
    const catalog = loadProjectRoleCatalog({ projectRoot: root });
    const { byAgent, warnings } = agentNameToRole(catalog);
    assert.equal(byAgent.get("team-x"), "Alpha");
    assert.equal(byAgent.get("team-y"), "Beta");
    assert.match(warnings.join("\n"), /team-x/);
    assert.equal(byAgent.get("Alpha"), "Alpha");
    assert.equal(byAgent.get("odd-worker"), "odd-worker");
  });
});

test("agentNameToRole maps team-builder to the user role that lists it", () => {
  withProject({ roles: [{ id: "Platform Builder", description: "p", capabilities: ["coding", "agenticExecution"], agents: ["team-builder"], extends: "Builder" }] }, root => {
    const catalog = loadProjectRoleCatalog({ projectRoot: root });
    assert.equal(catalog.registry["Platform Builder"].builder, true);
    assert.equal(agentNameToRole(catalog).byAgent.get("team-builder"), "Platform Builder");
  });
});

test("selection without a catalog is unchanged by the catalog parameter", () => {
  const roleCapabilities = Object.fromEntries(Object.entries(ROLE_REGISTRY).filter(([, e]) => e.defaultTeam).map(([r, e]) => [r, e.capabilities]));
  const plain = buildAiTeam(scored(), eligibility, null, roleCapabilities, opts());
  const nullCatalog = buildAiTeam(scored(), eligibility, null, roleCapabilities, opts({ roleCatalog: null }));
  assert.deepEqual(nullCatalog, plain);
  withProject(undefined, root => {
    const builtins = loadProjectRoleCatalog({ projectRoot: root });
    assert.deepEqual(buildAiTeam(scored(), eligibility, null, roleCapabilities, opts({ roleCatalog: builtins })), plain);
    assert.deepEqual(bestModelPerRoleGlobal(scored(), eligibility, null, roleCapabilities, builtins), bestModelPerRoleGlobal(scored(), eligibility, null, roleCapabilities));
  });
  const summary = plain.map(t => `${t.role}:${t.primary?.modelId}:${t.fallback?.modelId ?? "-"}`);
  assert.deepEqual(summary, SNAPSHOT);
});

const SNAPSHOT = ["Explorer:model-a:model-b", "Architect:model-a:model-b", "Builder:model-b:model-a", "Debugger:model-b:model-a", "Tester:model-b:model-a", "Reviewer:model-a:-"];


test("provider agent objects preserve aliases and expose adapters per role", () => {
  withProject({ roles: [{ id: "Builder", agents: ["legacy-builder", { name: "team-builder", adapterId: "claude" }, { name: "team-builder-codex", adapterId: "codex" }] }] }, root => {
    const catalog = loadProjectRoleCatalog({ projectRoot: root });
    assert.deepEqual(catalog.warnings, []);
    const { byAgent, byRole } = agentNameToRole(catalog);
    for (const name of ["Builder", "legacy-builder", "team-builder", "team-builder-codex"]) assert.equal(byAgent.get(name), "Builder");
    assert.equal(byRole.get("Builder").get("claude"), "team-builder");
    assert.equal(byRole.get("Builder").get("codex"), "team-builder-codex");
    assert.equal(byRole.get("Builder").size, 2);
  });
});

test("invalid provider agent objects reject the roles file with a field path", () => {
  for (const agent of [{ name: "x" }, { name: "", adapterId: "claude" }, { name: "x", adapterId: 1 }, null]) {
    withProject({ roles: [{ id: "Builder", agents: [agent] }] }, root => {
      const catalog = loadProjectRoleCatalog({ projectRoot: root });
      assert.match(catalog.warnings.join("\n"), /roles\[0\]\.agents/);
      assert.deepEqual(catalog.registry.Builder.agents, []);
    });
  }
});
