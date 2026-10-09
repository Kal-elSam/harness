import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const buildScript = readFileSync(join(root, "scripts/build-kairo-ui-binaries.sh"), "utf8");

// The platform keys the prebuilt pipeline can produce, read from the build
// script's own usage line so a new platform cannot be added without this test.
function pipelinePlatformKeys() {
  const line = buildScript.match(/--target <key>\s+Build one of: ([^\n]+)\./);
  assert.ok(line, "build script usage line listing platform keys not found");
  return line[1].split(",").map((key) => key.trim());
}

test("every prebuilt kairo-ui binary is declared in publishConfig.executableFiles", () => {
  const declared = pkg.publishConfig?.executableFiles;
  assert.ok(Array.isArray(declared), "publishConfig.executableFiles must be declared");
  const expected = pipelinePlatformKeys().map((key) => `dist/kairo-ui/${key}/kairo-ui`);
  assert.deepEqual([...declared].sort(), [...expected].sort());
});

test("executableFiles entries live under a shipped files root", () => {
  for (const entry of pkg.publishConfig.executableFiles) {
    assert.ok(
      pkg.files.some((root) => entry === root || entry.startsWith(`${root}/`)),
      `${entry} is not under a package.json files root`
    );
  }
});
