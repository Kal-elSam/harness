import test from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("cockpit smoke script exists in the repository", () => {
  assert.ok(existsSync(join(packageRoot, "scripts/cockpit-smoke-test.sh")));
  assert.ok(existsSync(join(packageRoot, "scripts/cockpit-smoke.mjs")));
});

test("registry smoke script exists in the repository", () => {
  assert.ok(existsSync(join(packageRoot, "scripts/registry-smoke-test.sh")));
});

test("installer smoke script exists in the repository", () => {
  assert.ok(existsSync(join(packageRoot, "scripts/installer-smoke-test.sh")));
});

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
    assert.ok(listing.includes("package/scripts/registry-smoke-test.sh"));
    assert.ok(listing.includes("package/scripts/installer-smoke-test.sh"));
    assert.ok(listing.includes("package/scripts/install.sh"));
    assert.ok(listing.includes("package/scripts/check-published-release.mjs"));
    assert.ok(listing.includes("package/scripts/lib/attribution-guard.mjs"));
    assert.ok(listing.includes("package/global-template/components/catalog.json"));
    assert.ok(listing.includes("package/global-template/components/sdd-core/skills/sdd-init/SKILL.md"));
    assert.ok(listing.includes("package/global-template/components/sdd-core/skills/sdd-design/SKILL.md"));
    assert.ok(listing.includes("package/global-template/components/sdd-core/skills/sdd-archive/SKILL.md"));
    assert.ok(listing.includes("package/global-template/components/sdd-core/personas/teaching.md"));
  } finally {
    if (existsSync(tarballPath)) unlinkSync(tarballPath);
  }
});
