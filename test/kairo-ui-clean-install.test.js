import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { KAIRO_UI_PREBUILT_TARGETS } from "../src/global/host/kairo-ui-prebuilt.js";
import { launchRatatuiHost } from "../src/global/host/launch-ratatui-host.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_DIST = join(REPO_ROOT, "dist", "kairo-ui");

/** @type {ReadonlyArray<{ key: string, platform: string, arch: string, fileNeedle: RegExp }>} */
const TRIPLE_EXPECTATIONS = Object.freeze([
  {
    key: "darwin-arm64",
    platform: "darwin",
    arch: "arm64",
    fileNeedle: /Mach-O 64-bit executable arm64/
  },
  {
    key: "darwin-x64",
    platform: "darwin",
    arch: "x64",
    fileNeedle: /Mach-O 64-bit executable x86_64/
  },
  {
    key: "linux-arm64",
    platform: "linux",
    arch: "arm64",
    fileNeedle: /ELF 64-bit LSB .*ARM aarch64/
  },
  {
    key: "linux-x64",
    platform: "linux",
    arch: "x64",
    fileNeedle: /ELF 64-bit LSB .*x86-64/
  }
]);

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
  return TRIPLE_EXPECTATIONS.every(({ key }) =>
    existsSync(join(REPO_DIST, key, "kairo-ui"))
  );
}

/**
 * Stage a package root that looks like a clean npm install: prebuilts + sidecar,
 * no crates/ and no Cargo.toml.
 * @param {string} [sourceRoot]
 */
function stageCleanInstallRoot(sourceRoot = REPO_ROOT) {
  const sourceDist = join(sourceRoot, "dist", "kairo-ui");
  const stage = mkdtempSync(join(tmpdir(), "kairo-ui-clean-install-"));
  const sidecarDir = join(stage, "src", "global", "host");
  mkdirSync(sidecarDir, { recursive: true });
  writeFileSync(join(sidecarDir, "kairo-ui-rpc-stdio.js"), "// clean-install sidecar stub\n");

  for (const { key } of TRIPLE_EXPECTATIONS) {
    const src = join(sourceDist, key, "kairo-ui");
    const destDir = join(stage, "dist", "kairo-ui", key);
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, join(destDir, "kairo-ui"));
    chmodSync(join(destDir, "kairo-ui"), 0o755);
  }

  assert.equal(existsSync(join(stage, "crates")), false);
  assert.equal(existsSync(join(stage, "Cargo.toml")), false);
  return stage;
}

function fileOutput(binaryPath) {
  const result = spawnSync("file", ["-b", binaryPath], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, `file(1) failed for ${binaryPath}: ${result.stderr}`);
  return (result.stdout ?? "").trim();
}

function okStat() {
  return { isDirectory: () => true };
}

function resolveCleanInstallRoot() {
  const fromEnv =
    typeof process.env.KAIRO_UI_CLEAN_INSTALL_ROOT === "string" &&
    process.env.KAIRO_UI_CLEAN_INSTALL_ROOT.trim() !== ""
      ? process.env.KAIRO_UI_CLEAN_INSTALL_ROOT.trim()
      : null;
  if (fromEnv != null) {
    return { packageRoot: fromEnv, ownedStage: false };
  }
  return { packageRoot: stageCleanInstallRoot(), ownedStage: true };
}

test("clean-install: launchRatatuiHost selects each prebuilt and never invokes cargo", async (t) => {
  if (!allRepoPrebuiltsPresent() && !process.env.KAIRO_UI_CLEAN_INSTALL_ROOT) {
    t.skip("dist/kairo-ui/{darwin,linux}-{arm64,x64}/kairo-ui not all present — run build + verify script");
    return;
  }

  const { packageRoot, ownedStage } = resolveCleanInstallRoot();
  const sidecarScript = join(packageRoot, "src", "global", "host", "kairo-ui-rpc-stdio.js");

  try {
    assert.equal(existsSync(join(packageRoot, "crates")), false);
    assert.equal(existsSync(join(packageRoot, "Cargo.toml")), false);

    for (const { key, platform, arch } of TRIPLE_EXPECTATIONS) {
      const prebuiltPath = join(packageRoot, "dist", "kairo-ui", key, "kairo-ui");
      assert.ok(existsSync(prebuiltPath), `missing staged binary for ${key}`);

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

      assert.equal(cargoCalls, 0, `${key} must not invoke cargo`);
      assert.equal(spawned?.command, prebuiltPath, `${key} must spawn its prebuilt`);
      assert.deepEqual(spawned?.args, ["--bridge"]);
      assert.equal(spawned?.options?.env?.KAIRO_UI_RPC_SCRIPT, sidecarScript);
    }

    assert.equal(KAIRO_UI_PREBUILT_TARGETS.length, 4);
  } finally {
    if (ownedStage) {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  }
});

test("clean-install: foreign triples match file(1) magic; exec gaps stay honest", (t) => {
  if (!allRepoPrebuiltsPresent() && !process.env.KAIRO_UI_CLEAN_INSTALL_ROOT) {
    t.skip("dist/kairo-ui prebuilts not all present");
    return;
  }

  const { packageRoot, ownedStage } = resolveCleanInstallRoot();
  const currentHost = hostKey();

  try {
    /** @type {string[]} */
    const execGaps = [];

    for (const { key, fileNeedle } of TRIPLE_EXPECTATIONS) {
      const binaryPath = join(packageRoot, "dist", "kairo-ui", key, "kairo-ui");
      const magic = fileOutput(binaryPath);
      assert.match(magic, fileNeedle, `${key} unexpected file(1): ${magic}`);

      if (key === currentHost) {
        continue;
      }

      const probe = spawnSync(binaryPath, ["--v3-capture", join(packageRoot, `probe-${key}`)], {
        encoding: "utf8"
      });
      // Observed status 0 is real foreign-exec evidence (Rosetta/emulation/CI).
      // Never invent PASS; never fail the suite solely because emulation works.
      if (probe.error == null && probe.status === 0) {
        t.diagnostic(
          `${key}: foreign-exec PASS on host ${currentHost} (observed status 0)`
        );
        continue;
      }
      const reason =
        key.startsWith("darwin-") && currentHost?.startsWith("darwin-")
          ? "needs Rosetta (or a native x64 mac runner)"
          : "needs Linux CI / Docker / qemu";
      const detail = probe.error?.message ?? `status=${probe.status}`;
      execGaps.push(`${key}: runtime exec blocked on this host (${reason}); ${detail}`);
    }

    // Surface gaps without failing — selection + magic already passed.
    for (const gap of execGaps) {
      t.diagnostic(gap);
    }
    if (execGaps.length === 0) {
      t.diagnostic(
        `all foreign triples executed on host ${currentHost}; gaps none (record per-runner evidence elsewhere)`
      );
    }
  } finally {
    if (ownedStage) {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  }
});

test("clean-install: host-arch --v3-capture from crate-less root (no Cargo)", (t) => {
  if (!allRepoPrebuiltsPresent() && !process.env.KAIRO_UI_CLEAN_INSTALL_ROOT) {
    t.skip("dist/kairo-ui prebuilts not all present");
    return;
  }

  const currentHost = hostKey();
  if (currentHost == null) {
    t.skip(`unsupported host platform/arch: ${process.platform}/${process.arch}`);
    return;
  }

  const { packageRoot, ownedStage } = resolveCleanInstallRoot();
  const binaryPath = join(packageRoot, "dist", "kairo-ui", currentHost, "kairo-ui");
  const outDir = mkdtempSync(join(tmpdir(), "kairo-ui-v3-clean-"));

  try {
    assert.equal(existsSync(join(packageRoot, "crates")), false);
    assert.equal(existsSync(join(packageRoot, "Cargo.toml")), false);
    assert.ok(existsSync(binaryPath), `host prebuilt missing: ${binaryPath}`);

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
      `host ${currentHost} --v3-capture failed (status=${result.status}): ${result.stderr || result.stdout}`
    );
    // kairo-ui prints the capture summary on stderr (Buffer dump harness).
    assert.match(
      `${result.stderr ?? ""}${result.stdout ?? ""}`,
      /V3 visual fixtures: wrote \d+ files/
    );

    const files = readdirSync(outDir);
    assert.ok(files.length >= 10, `expected capture outputs under ${outDir}, got ${files.length}`);
    assert.ok(
      files.some((name) => name.endsWith(".txt") || name.endsWith(".html")),
      "expected .txt/.html fixture outputs"
    );
    assert.ok(statSync(join(outDir, files[0])).size > 0);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
    if (ownedStage) {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  }
});
