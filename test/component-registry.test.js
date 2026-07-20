import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPONENT_IDS,
  DEFAULT_COMPONENT_IDS,
  describeComponentCatalog,
  listComponents,
  resolveComponent,
  resolveTargetComponents,
  validateComponentIds
} from "../src/global/component-registry.js";
import { loadComponentCatalog } from "../src/global/load-component-catalog.js";

test("registry lists bundled components with optional engram and graphify", () => {
  const components = listComponents();

  assert.equal(components.length, 4);
  assert.deepEqual(COMPONENT_IDS, ["orchestrator", "sdd-core", "engram-memory", "graphify-context"]);
  assert.deepEqual(DEFAULT_COMPONENT_IDS, ["orchestrator", "sdd-core"]);
});

test("unknown component fails clearly", () => {
  assert.throws(() => resolveComponent("memory"), /Unknown component "memory"/);
});

test("default install resolves orchestrator and sdd-core", () => {
  const targets = resolveTargetComponents({});

  assert.deepEqual(targets.map((component) => component.id), ["orchestrator", "sdd-core"]);
});

test("--no-default-components resolves to core plumbing only", () => {
  const targets = resolveTargetComponents({ noDefaultComponents: true });

  assert.deepEqual(targets, []);
});

test("explicit --components selection is honored", () => {
  const targets = resolveTargetComponents({ components: ["sdd-core"] });

  assert.deepEqual(targets.map((component) => component.id), ["sdd-core"]);
});

test("components expose managed section builders for optional integrations", () => {
  const engram = resolveComponent("engram-memory");
  const engramSection = engram.buildManagedSection(
    { componentsDir: "/home/user/.harness/components" },
    { id: "cursor", assets: { configFile: ".cursor/AGENTS.md" } }
  );

  assert.match(engramSection, /### Engram Memory/);
  assert.match(engramSection, /memory\.md/);
  assert.match(engramSection, /Authority: user > AGENTS\.md/);

  const graphify = resolveComponent("graphify-context");
  const graphifySection = graphify.buildManagedSection(
    { componentsDir: "/home/user/.harness/components" },
    { id: "cursor", assets: { configFile: ".cursor/AGENTS.md" } }
  );

  assert.match(graphifySection, /### Graphify Context/);
  assert.match(graphifySection, /context-graph\.md/);
  assert.match(graphifySection, /graphify update/);
});

test("components expose managed section builders", () => {
  const sddCore = resolveComponent("sdd-core");
  const section = sddCore.buildManagedSection(
    {
      componentsDir: "/custom/home/.harness/components",
      paths: { statePath: "/custom/home/.harness/state.json" }
    },
    { id: "cursor", assets: { configFile: ".cursor/AGENTS.md" } }
  );

  assert.match(section, /### SDD Core/);
  assert.match(section, /workflow\.md/);
  assert.match(section, /Canonical skills/);
  assert.match(section, /sdd-init/);
  assert.match(section, /sdd-archive/);
  assert.match(section, /Teaching persona/);
  assert.match(section, /\/custom\/home\/\.harness\/state\.json → sdd\.personaAgentIds/);
  assert.doesNotMatch(section, /~\/\.harness\/state\.json/);
  assert.match(section, /basic, standard, or complex/);
  assert.match(section, /\.cursor\/rules\//);
});

test("catalog metadata is loaded from the packaged component catalog", () => {
  const catalog = loadComponentCatalog();
  const orchestrator = catalog.find((component) => component.id === "orchestrator");
  const sddCore = catalog.find((component) => component.id === "sdd-core");

  assert.equal(orchestrator.label, "Orchestrator");
  assert.deepEqual(orchestrator.assetFiles, ["orchestrator.md"]);
  assert.equal(sddCore.label, "SDD Core");
  assert.deepEqual(sddCore.assetFiles, [
    "workflow.md",
    "spec-sizing.md",
    "handoff.md",
    "skills/sdd-init/SKILL.md",
    "skills/sdd-init/references/contract.md",
    "skills/sdd-explore/SKILL.md",
    "skills/sdd-explore/references/contract.md",
    "skills/sdd-propose/SKILL.md",
    "skills/sdd-propose/references/contract.md",
    "skills/sdd-spec/SKILL.md",
    "skills/sdd-spec/references/contract.md",
    "skills/sdd-design/SKILL.md",
    "skills/sdd-design/references/contract.md",
    "skills/sdd-tasks/SKILL.md",
    "skills/sdd-tasks/references/contract.md",
    "skills/sdd-apply/SKILL.md",
    "skills/sdd-apply/references/contract.md",
    "skills/sdd-verify/SKILL.md",
    "skills/sdd-verify/references/contract.md",
    "skills/sdd-archive/SKILL.md",
    "skills/sdd-archive/references/contract.md",
    "personas/teaching.md"
  ]);
  assert.match(sddCore.adapterHints.cursor, /\.cursor\/rules\//);
  assert.deepEqual(sddCore.capabilities, ["sdd.workflow", "sdd.skills", "sdd.persona"]);
  assert.equal(sddCore.version, "2.0.0");
});

test("describeComponentCatalog exposes defaults and adapter hint keys", () => {
  const entries = describeComponentCatalog();

  assert.deepEqual(
    entries.map((entry) => entry.id),
    ["orchestrator", "sdd-core", "engram-memory", "graphify-context"]
  );
  assert.equal(entries.filter((entry) => entry.defaultEnabled).length, 2);
  assert.deepEqual(entries.filter((entry) => !entry.defaultEnabled).map((entry) => entry.id), [
    "engram-memory",
    "graphify-context"
  ]);
  assert.deepEqual(entries[1].adapterHints, ["cursor", "codex", "claude", "opencode"]);
});
