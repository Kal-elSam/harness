import test from "node:test";
import assert from "node:assert/strict";
import { readComponentCatalogDocument } from "../src/global/load-component-catalog.js";

test("component-registry imports on the current Node runtime", async () => {
  const { listComponents } = await import("../src/global/component-registry.js");

  assert.equal(listComponents().length, 4);
});

test("component catalog loads from packaged JSON without import attributes", () => {
  const catalog = readComponentCatalogDocument();

  assert.equal(catalog.schemaVersion, 2);
  assert.deepEqual(
    catalog.components.map((component) => component.id),
    ["orchestrator", "sdd-core", "engram-memory", "graphify-context"]
  );
  assert.deepEqual(
    catalog.components.filter((component) => component.defaultEnabled).map((component) => component.id),
    ["orchestrator", "sdd-core"]
  );
  assert.ok(catalog.components.every((component) => Array.isArray(component.dependencies)));
  assert.ok(catalog.components.every((component) => Array.isArray(component.healthChecks)));
});
