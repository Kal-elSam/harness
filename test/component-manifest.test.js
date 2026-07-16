import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPONENT_MANIFEST_SCHEMA_VERSION,
  assertSafeAssetPath,
  detectDependencyCycles,
  normalizeCatalogDocument,
  normalizeManifestEntry
} from "../src/global/component-manifest.js";
import { loadComponentCatalog } from "../src/global/load-component-catalog.js";
import { describeComponentCatalog } from "../src/global/component-registry.js";

const base = (o = {}) => ({ id: "team-rules", label: "Team Rules", version: "0.1.0", assetFiles: ["README.md"], ...o });

test("normalizes v1 catalogs and accepts v2 fields", () => {
  const { schemaVersion, components } = normalizeCatalogDocument({ components: [base()] }, { source: "workspace" });
  assert.equal(schemaVersion, 1);
  assert.equal(components[0].schemaVersion, COMPONENT_MANIFEST_SCHEMA_VERSION);
  assert.deepEqual(components[0].dependencies, []);

  const v2 = normalizeManifestEntry(base({
    defaultEnabled: true,
    capabilities: ["memory.read"],
    dependencies: ["orchestrator"],
    healthChecks: [{ id: "assets", type: "assets" }]
  }), { requireDefaultEnabled: true });
  assert.deepEqual(v2.capabilities, ["memory.read"]);
  assert.deepEqual(v2.healthChecks, [{ id: "assets", type: "assets", optional: false }]);
});

test("rejects invalid ids, versions, unsafe paths, duplicates, unknown deps, cycles", () => {
  assert.throws(() => normalizeManifestEntry(base({ id: "Bad_Id" })), /invalid id/);
  assert.throws(() => normalizeManifestEntry(base({ version: "1" })), /invalid version/);
  assert.throws(() => assertSafeAssetPath("../x.md", "u"), /relative path without "\.\."/);
  assert.throws(() => normalizeManifestEntry(base({ assetFiles: ["a.md", "a.md"] })), /duplicate asset/);
  assert.throws(() => normalizeCatalogDocument({ components: [base(), base()] }, { source: "workspace" }), /Duplicate/);
  assert.throws(() => normalizeCatalogDocument({ components: [base({ dependencies: ["nope"] })] }, { source: "workspace" }), /unknown component/);
  const cycle = [
    normalizeManifestEntry(base({ id: "a", dependencies: ["b"] })),
    normalizeManifestEntry(base({ id: "b", dependencies: ["a"] }))
  ];
  assert.deepEqual(detectDependencyCycles(cycle), ["a", "b", "a"]);
  assert.throws(
    () => normalizeCatalogDocument({ components: [base({ id: "a", dependencies: ["b"] }), base({ id: "b", dependencies: ["a"] })] }, { source: "workspace" }),
    /dependency cycle/
  );
});

test("bundled catalog and public JSON expose v2 metadata", () => {
  for (const component of loadComponentCatalog()) {
    assert.equal(component.schemaVersion, 2);
    assert.deepEqual(component.dependencies, []);
  }
  const entry = describeComponentCatalog()[0];
  assert.equal(entry.schemaVersion, 2);
  assert.equal(entry.kind, "component");
  assert.deepEqual(entry.healthChecks, []);
});
