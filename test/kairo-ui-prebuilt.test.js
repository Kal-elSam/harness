import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  KAIRO_UI_PREBUILT_TARGETS,
  prebuiltBinaryKey,
  prebuiltBinaryRelativePath,
  resolvePrebuiltBinary
} from "../src/global/host/kairo-ui-prebuilt.js";

test("KAIRO_UI_PREBUILT_TARGETS covers darwin/linux × arm64/x64", () => {
  assert.deepEqual(
    KAIRO_UI_PREBUILT_TARGETS.map((t) => t.key).sort(),
    ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]
  );
});

test("prebuiltBinaryKey maps platform+arch to the four package keys", () => {
  assert.equal(prebuiltBinaryKey("darwin", "arm64"), "darwin-arm64");
  assert.equal(prebuiltBinaryKey("darwin", "x64"), "darwin-x64");
  assert.equal(prebuiltBinaryKey("linux", "arm64"), "linux-arm64");
  assert.equal(prebuiltBinaryKey("linux", "x64"), "linux-x64");
  assert.equal(prebuiltBinaryKey("linux", "amd64"), "linux-x64");
  assert.equal(prebuiltBinaryKey("win32", "x64"), null);
  assert.equal(prebuiltBinaryKey("darwin", "ia32"), null);
});

test("prebuiltBinaryRelativePath is under dist/kairo-ui/<key>/kairo-ui", () => {
  assert.equal(
    prebuiltBinaryRelativePath("darwin", "arm64"),
    join("dist", "kairo-ui", "darwin-arm64", "kairo-ui")
  );
  assert.equal(
    prebuiltBinaryRelativePath("linux", "x64"),
    join("dist", "kairo-ui", "linux-x64", "kairo-ui")
  );
  assert.equal(prebuiltBinaryRelativePath("win32", "x64"), null);
});

test("resolvePrebuiltBinary returns absolute path when the binary exists", () => {
  const root = mkdtempSync(join(tmpdir(), "kairo-ui-prebuilt-"));
  const rel = prebuiltBinaryRelativePath("darwin", "arm64");
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, "");

  const resolved = resolvePrebuiltBinary({
    platform: "darwin",
    arch: "arm64",
    packageRoot: root
  });
  assert.equal(resolved, abs);
});

test("resolvePrebuiltBinary returns null when binary is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "kairo-ui-prebuilt-missing-"));
  assert.equal(
    resolvePrebuiltBinary({
      platform: "linux",
      arch: "x64",
      packageRoot: root
    }),
    null
  );
});

test("resolvePrebuiltBinary returns null for unsupported platform/arch", () => {
  const root = mkdtempSync(join(tmpdir(), "kairo-ui-prebuilt-win-"));
  assert.equal(
    resolvePrebuiltBinary({
      platform: "win32",
      arch: "x64",
      packageRoot: root
    }),
    null
  );
});

test("resolvePrebuiltBinary selects distinct paths for all four triples", () => {
  const root = mkdtempSync(join(tmpdir(), "kairo-ui-prebuilt-all-"));
  const paths = new Set();
  for (const { platform, arch, key } of KAIRO_UI_PREBUILT_TARGETS) {
    const abs = join(root, "dist", "kairo-ui", key, "kairo-ui");
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, key);
    const resolved = resolvePrebuiltBinary({
      platform,
      arch,
      packageRoot: root
    });
    assert.equal(resolved, abs);
    paths.add(resolved);
  }
  assert.equal(paths.size, 4);
});
