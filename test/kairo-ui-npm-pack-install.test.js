import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { KAIRO_UI_PREBUILT_TARGETS } from "../src/global/host/kairo-ui-prebuilt.js";
import { launchRatatuiHost } from "../src/global/host/launch-ratatui-host.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIST = join(REPO_ROOT, "dist", "kairo-ui");

const PREBUILT_KEYS = Object.freeze(
  KAIRO_UI_PREBUILT_TARGETS.map((target) => target.key)
);

function hostKey() {
  const os = process.platform === "darwin" || process.platform === "linux" ? process.platform : null;
  const arch =
    process.arch === "arm64" || process.arch === "aarch64"
      ? "arm64"
      : process.arch === "x64"
        ? "x64"
        : null;
  if (os == null || arch == null) return null;
  return `${os}-${arch}`;
}

function allRepoPrebuiltsPresent() {
  return PREBUILT_KEYS.every((key) => existsSync(join(REPO_DIST, key, "kairo-ui")));
}

function okStat() {
  return { isDirectory: () => true };
}

/**
 * Pack the repo and extract the tarball into a crate-less package root.
 * @param {string} workDir
 */
function packAndExtract(workDir) {
  const packDir = join(workDir, "pack");
  const extractDir = join(workDir, "extract");
  mkdirSync(packDir, { recursive: true });
  mkdirSync(extractDir, { recursive: true });

  const tarballName = execSync(`npm pack --silent --pack-destination ${JSON.stringify(packDir)}`, {
    cwd: REPO_ROOT,
    encoding: "utf8"
  }).trim();
  assert.ok(tarballName.length > 0, "npm pack produced no tarball name");
  const tarballPath = join(packDir, tarballName);
  assert.ok(existsSync(tarballPath), `missing packed tarball: ${tarballPath}`);

  const listing = execSync(`tar -tzf ${JSON.stringify(tarballPath)}`, { encoding: "utf8" });
  for (const key of PREBUILT_KEYS) {
    assert.ok(
      listing.includes(`package/dist/kairo-ui/${key}/kairo-ui`),
      `npm pack omitted dist/kairo-ui/${key}/kairo-ui (check package.json files)`
    );
  }
  assert.equal(
    listing.includes("package/crates/"),
    false,
    "npm pack must not ship crates/"
  );

  execSync(`tar -xzf ${JSON.stringify(tarballPath)} -C ${JSON.stringify(extractDir)}`, {
    encoding: "utf8"
  });
  const packageRoot = join(extractDir, "package");
  assert.ok(existsSync(packageRoot), `expected extracted package root at ${packageRoot}`);
  return { packageRoot, tarballPath, tarballName };
}

test("npm pack install: all four prebuilts present, launch without cargo, host --v3-capture", async (t) => {
  if (!allRepoPrebuiltsPresent()) {
    t.skip("dist/kairo-ui/{darwin,linux}-{arm64,x64}/kairo-ui not all present — run build + pack verify");
    return;
  }

  const workDir = mkdtempSync(join(tmpdir(), "kairo-ui-npm-pack-"));
  try {
    const { packageRoot, tarballName } = packAndExtract(workDir);
    t.diagnostic(`packed ${tarballName}; extracted root ${packageRoot}`);

    assert.equal(existsSync(join(packageRoot, "crates")), false);
    assert.equal(existsSync(join(packageRoot, "Cargo.toml")), false);

    const sidecarScript = join(packageRoot, "src", "global", "host", "kairo-ui-rpc-stdio.js");
    assert.ok(existsSync(sidecarScript), "packed package must include kairo-ui-rpc-stdio.js");

    for (const { key, platform, arch } of KAIRO_UI_PREBUILT_TARGETS) {
      const prebuiltPath = join(packageRoot, "dist", "kairo-ui", key, "kairo-ui");
      assert.ok(existsSync(prebuiltPath), `missing packed binary for ${key}`);
      chmodSync(prebuiltPath, 0o755);

      let cargoCalls = 0;
      let spawned = null;
      await launchRatatuiHost({
        cwd: "/abs/project",
        interactive: true,
        platform,
        arch,
        packageRoot,
        crateDir: join(packageRoot, "crates", "kairo-ui"),
        existsSyncImpl: (p) => p === prebuiltPath || p === sidecarScript,
        statImpl: okStat,
        cargoBuildImpl: async () => {
          cargoCalls += 1;
          return { status: 0 };
        },
        spawnImpl: async (command, args, options) => {
          spawned = { command, args, options };
          return { status: 0 };
        }
      });

      assert.equal(cargoCalls, 0, `${key} must not invoke cargo from npm-pack root`);
      assert.equal(spawned?.command, prebuiltPath, `${key} must spawn its packed prebuilt`);
      assert.deepEqual(spawned?.args, ["--bridge"]);
      assert.equal(spawned?.options?.env?.KAIRO_UI_RPC_SCRIPT, sidecarScript);
    }

    const currentHost = hostKey();
    if (currentHost == null) {
      t.diagnostic(`skip host --v3-capture: unsupported ${process.platform}/${process.arch}`);
      return;
    }

    const binaryPath = join(packageRoot, "dist", "kairo-ui", currentHost, "kairo-ui");
    const outDir = mkdtempSync(join(workDir, "v3-"));
    const result = spawnSync(binaryPath, ["--v3-capture", outDir], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: process.env.PATH ?? ""
      }
    });
    assert.equal(
      result.status,
      0,
      `host ${currentHost} --v3-capture from npm-pack root failed (status=${result.status}): ${result.stderr || result.stdout}`
    );
    assert.match(
      `${result.stderr ?? ""}${result.stdout ?? ""}`,
      /V3 visual fixtures: wrote \d+ files/
    );
    const files = readdirSync(outDir);
    assert.ok(files.length >= 10, `expected capture outputs under ${outDir}, got ${files.length}`);
    assert.ok(statSync(join(outDir, files[0])).size > 0);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
