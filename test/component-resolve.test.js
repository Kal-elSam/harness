import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexComponentsById, resolveDependencyOrder } from "../src/global/component-resolve.js";
import {
  DEFAULT_COMPONENT_IDS,
  listComponents,
  resolveComponentClosure,
  resolveTargetComponents
} from "../src/global/component-registry.js";

test("bundled defaults resolve without pulling optional components", () => {
  const targets = resolveTargetComponents({});
  assert.deepEqual(targets.map((component) => component.id), DEFAULT_COMPONENT_IDS);
  assert.deepEqual(targets.map((component) => component.dependencies), [[], []]);
});

test("resolveDependencyOrder is topological, deterministic, and deduped", () => {
  const components = indexComponentsById([
    { id: "a", dependencies: ["b"] },
    { id: "b", dependencies: ["c"] },
    { id: "c", dependencies: [] },
    { id: "d", dependencies: ["c"] }
  ]);

  assert.deepEqual(
    resolveDependencyOrder(["a", "d", "a"], components).map((component) => component.id),
    ["c", "b", "a", "d"]
  );
});

test("workspace dependency on bundled component expands in closure", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "harness-resolve-"));
  const componentDir = join(workspaceRoot, ".harness", "components", "team-rules");
  await mkdir(componentDir, { recursive: true });
  await writeFile(join(componentDir, "README.md"), "# team-rules\n");
  await writeFile(join(workspaceRoot, ".harness", "components", "catalog.json"), `${JSON.stringify({
    components: [{
      id: "team-rules",
      label: "Team Rules",
      version: "0.1.0",
      assetFiles: ["README.md"],
      dependencies: ["orchestrator"]
    }]
  }, null, 2)}\n`);

  const resolved = resolveComponentClosure(["team-rules"], { workspaceRoot });
  assert.deepEqual(resolved.map((component) => component.id), ["orchestrator", "team-rules"]);
  assert.equal(listComponents({ workspaceRoot }).length, 5);
});

test("explicit selection still honors --no-default-components empty set", () => {
  assert.deepEqual(resolveTargetComponents({ noDefaultComponents: true }), []);
});
