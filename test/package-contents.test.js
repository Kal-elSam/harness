import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("packed tarball includes release scripts", () => {
  const tarballName = execSync("npm pack --silent", {
    cwd: packageRoot,
    encoding: "utf8"
  }).trim();
  const tarballPath = join(packageRoot, tarballName);

  try {
    const listing = execSync(`tar -tzf ${tarballPath}`, { encoding: "utf8" });

    assert.ok(listing.includes("package/scripts/check-release-commit.mjs"));
    assert.ok(listing.includes("package/scripts/smoke-test.sh"));
    assert.ok(listing.includes("package/scripts/check-published-release.mjs"));
    assert.ok(listing.includes("package/scripts/lib/attribution-guard.mjs"));
  } finally {
    if (existsSync(tarballPath)) unlinkSync(tarballPath);
  }
});
