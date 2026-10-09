import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Regression: overwriting an already-launched kairo-ui in place (same inode)
// leaves macOS with a stale code-signature cache, and the rebuilt host binary
// is SIGKILLed on launch even though its bytes are fine. The build must
// replace the file (new inode), not overwrite it.

const SCRIPT = fileURLToPath(new URL("../scripts/build-kairo-ui-binaries.sh", import.meta.url));

function copyBuiltFunction() {
  const text = readFileSync(SCRIPT, "utf8");
  const match = text.match(/copy_built\(\) \{[\s\S]*?\n\}\n/);
  assert.ok(match, "copy_built() exists in the build script");
  return match[0];
}

test("copy_built replaces an existing host binary with a new file instead of overwriting it in place", () => {
  const work = mkdtempSync(join(tmpdir(), "kairo-ui-build-copy-"));
  try {
    const outRoot = join(work, "out");
    const destDir = join(outRoot, "darwin-arm64");
    mkdirSync(destDir, { recursive: true });
    const dest = join(destDir, "kairo-ui");
    writeFileSync(dest, "old");
    const built = join(work, "built");
    writeFileSync(built, "new");
    // Keep the old file alive through a second name. Without it, the filesystem
    // may hand the freed inode number straight back to the replacement (ext4
    // does), so comparing inode numbers alone cannot tell replace from overwrite.
    const retained = join(work, "old-binary");
    linkSync(dest, retained);
    const before = statSync(dest).ino;
    const run = spawnSync("bash", ["-c", `OUT_ROOT=${JSON.stringify(outRoot)}\n${copyBuiltFunction()}\ncopy_built darwin-arm64 ${JSON.stringify(built)}`], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(dest, "utf8"), "new");
    assert.equal(readFileSync(retained, "utf8"), "old", "the old file must be left untouched");
    assert.equal(statSync(retained).ino, before, "the retained link keeps the original inode");
    assert.notEqual(statSync(dest).ino, before, "the destination must be a new inode");
    assert.ok((statSync(dest).mode & 0o111) !== 0, "and executable");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
