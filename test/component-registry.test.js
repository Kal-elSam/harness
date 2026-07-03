import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPONENT_IDS,
  DEFAULT_COMPONENT_IDS,
  listComponents,
  resolveComponent,
  resolveTargetComponents,
  validateComponentIds
} from "../src/global/component-registry.js";

test("registry lists orchestrator and sdd-core", () => {
  const components = listComponents();

  assert.equal(components.length, 2);
  assert.deepEqual(COMPONENT_IDS, ["orchestrator", "sdd-core"]);
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

test("components expose managed section builders", () => {
  const sddCore = resolveComponent("sdd-core");
  const section = sddCore.buildManagedSection(
    { componentsDir: "/home/user/.harness/components" },
    { id: "cursor", assets: { configFile: ".cursor/AGENTS.md" } }
  );

  assert.match(section, /### SDD Core/);
  assert.match(section, /workflow\.md/);
  assert.match(section, /basic, standard, or complex/);
  assert.match(section, /\.cursor\/rules\//);
});
