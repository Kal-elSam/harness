import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { KAIRO_UI_PREBUILT_TARGETS } from "../src/global/host/kairo-ui-prebuilt.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = readFileSync(
  join(REPO_ROOT, ".github", "workflows", "kairo-ui-prebuilt.yml"),
  "utf8"
);
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts", "verify-kairo-ui-packaged.sh");
const KEYS = KAIRO_UI_PREBUILT_TARGETS.map((target) => target.key);
const RUNNER_KEYS = Object.freeze({
  "macos-14": "darwin-arm64",
  "macos-15-intel": "darwin-x64",
  "ubuntu-24.04": "linux-x64",
  "ubuntu-24.04-arm": "linux-arm64"
});

/** Slice the text of one top-level job (two-space indented key under `jobs:`). */
function jobBlock(name) {
  const lines = WORKFLOW.split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `workflow is missing job "${name}"`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function matrixPairs(block) {
  const pairs = [];
  const re = /- os: (\S+)\s*\n\s*key: (\S+)/g;
  for (const m of block.matchAll(re)) pairs.push([m[1], m[2]]);
  return pairs;
}

test("workflow stays manual-only with read-only contents", () => {
  assert.match(WORKFLOW, /^on:\s*\n {2}workflow_dispatch:\s*$/m);
  assert.match(WORKFLOW, /^permissions:\s*\n {2}contents: read\s*$/m);
  assert.equal(/^ {2}(push|pull_request|schedule):/m.test(WORKFLOW), false);
});

test("build job uploads each binary named by target key and github.sha", () => {
  const build = jobBlock("host-v3-capture");
  assert.match(build, /uses: actions\/upload-artifact@/);
  assert.match(build, /name: kairo-ui-bin-\$\{\{ matrix\.key \}\}-\$\{\{ github\.sha \}\}/);
  assert.match(build, /path: dist\/kairo-ui\/\$\{\{ matrix\.key \}\}\/kairo-ui/);
  assert.match(build, /if-no-files-found: error/);
});

test("assemble job needs the build matrix, packs, asserts four keys, uploads by sha", () => {
  const assemble = jobBlock("assemble");
  assert.match(assemble, /needs: host-v3-capture/);
  assert.match(assemble, /uses: actions\/download-artifact@/);
  assert.match(assemble, /npm pack/);
  assert.match(assemble, /chmod \+x/);
  for (const key of KEYS) {
    assert.ok(assemble.includes(key), `assemble must reference ${key}`);
  }
  assert.match(assemble, /tar -tzf/);
  assert.match(assemble, /uses: actions\/upload-artifact@/);
  assert.match(assemble, /name: kairo-ui-package-\$\{\{ github\.sha \}\}/);
  assert.match(assemble, /-\$\{\{ github\.sha \}\}/);
});

test("verify-package is a native-runner matrix over all four pairs and needs assemble", () => {
  const verify = jobBlock("verify-package");
  assert.match(verify, /needs: assemble/);
  assert.match(verify, /runs-on: \$\{\{ matrix\.os \}\}/);
  const pairs = Object.fromEntries(matrixPairs(verify));
  assert.deepEqual(pairs, RUNNER_KEYS);
  assert.match(verify, /uses: actions\/checkout@/);
  assert.match(verify, /uses: actions\/download-artifact@/);
  assert.match(verify, /name: kairo-ui-package-\$\{\{ github\.sha \}\}/);
  assert.match(verify, /scripts\/verify-kairo-ui-packaged\.sh/);
  assert.match(verify, /matrix\.key/);
  assert.equal(/dtolnay\/rust-toolchain/.test(verify), false, "verify job must not install Rust");
});

test("verify-package matrix mirrors the build matrix", () => {
  assert.deepEqual(
    matrixPairs(jobBlock("verify-package")),
    matrixPairs(jobBlock("host-v3-capture"))
  );
});

test("workflow and script state that the mock does not prove real providers", () => {
  const script = readFileSync(VERIFY_SCRIPT, "utf8");
  assert.match(script, /does NOT prove real providers/i);
  assert.match(WORKFLOW, /does NOT prove real providers/i);
});

function hostKey() {
  if (process.platform !== "darwin" && process.platform !== "linux") return null;
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null;
  return arch ? `${process.platform}-${arch}` : null;
}

function has(cmd) {
  return spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
}

test("verify script rejects a missing tarball argument", () => {
  const result = spawnSync("bash", [VERIFY_SCRIPT], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /usage|tarball/i);
});

test("verify script proves selection, no-cargo launch, capture and PTY on a real npm pack", (t) => {
  const key = hostKey();
  if (key == null) return t.skip(`unsupported host ${process.platform}/${process.arch}`);
  if (!existsSync(join(REPO_ROOT, "dist", "kairo-ui", key, "kairo-ui"))) {
    return t.skip(`host binary dist/kairo-ui/${key}/kairo-ui is missing; run build-kairo-ui-binaries.sh --host-only`);
  }
  if (!has("python3")) return t.skip("python3 unavailable; PTY check cannot run");
  const work = mkdtempSync(join(tmpdir(), "kairo-ui-packaged-verify-"));
  try {
    const packDir = join(work, "pack");
    mkdirSync(packDir, { recursive: true });
    const name = execSync(`npm pack --silent --pack-destination ${JSON.stringify(packDir)}`, {
      cwd: REPO_ROOT,
      encoding: "utf8"
    }).trim();
    const result = spawnSync("bash", [VERIFY_SCRIPT, join(packDir, name)], {
      encoding: "utf8",
      env: {
        ...process.env,
        KAIRO_PTY_EVIDENCE_DIR: join(work, "evidence"),
        KAIRO_PTY_SIZES: "100x30"
      },
      timeout: 180000
    });
    const out = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, out);
    assert.match(out, new RegExp(`selection: ${key}`));
    assert.match(out, /launch without cargo: OK/);
    assert.match(out, /v3-capture: \d+ files/);
    assert.match(out, /PTY e2e PASS/);
    assert.match(out, /Packaged verification PASS/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

/** A minimal tarball whose only content is a shell-script "binary" with the given mode. */
function fakePackedBinary(work, key, mode) {
  const pkgBin = join(work, "stage", "package", "dist", "kairo-ui", key);
  mkdirSync(pkgBin, { recursive: true });
  const bin = join(pkgBin, "kairo-ui");
  writeFileSync(bin, "#!/bin/sh\nexit 0\n");
  chmodSync(bin, mode);
  const tarball = join(work, `fake-${mode.toString(8)}.tgz`);
  execSync(`tar -czf ${JSON.stringify(tarball)} -C ${JSON.stringify(join(work, "stage"))} package`);
  return tarball;
}

test("verify script fails when the packaged binary ships without the executable bit (no chmod masking)", (t) => {
  const key = hostKey();
  if (key == null) return t.skip(`unsupported host ${process.platform}/${process.arch}`);
  if (!has("python3")) return t.skip("python3 unavailable");
  const work = mkdtempSync(join(tmpdir(), "kairo-ui-packaged-mode-"));
  try {
    const result = spawnSync("bash", [VERIFY_SCRIPT, fakePackedBinary(work, key, 0o644), key], {
      encoding: "utf8",
      timeout: 60000
    });
    const out = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, out);
    assert.match(out, /packaged binary is not executable as shipped \(mode 644\)/);
    assert.doesNotMatch(out, /selection:/, "the gate must fire before any later check");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("verify script passes the executable gate for a 755 binary and then proceeds to the next checks", (t) => {
  const key = hostKey();
  if (key == null) return t.skip(`unsupported host ${process.platform}/${process.arch}`);
  if (!has("python3")) return t.skip("python3 unavailable");
  const work = mkdtempSync(join(tmpdir(), "kairo-ui-packaged-mode-"));
  try {
    const result = spawnSync("bash", [VERIFY_SCRIPT, fakePackedBinary(work, key, 0o755), key], {
      encoding: "utf8",
      timeout: 60000
    });
    const out = `${result.stdout}\n${result.stderr}`;
    // The fake package has no resolver/launcher, so the script still fails later,
    // but never on the executable gate.
    assert.doesNotMatch(out, /not executable as shipped/);
    assert.match(out, /resolver\/launcher selection failed|Cannot find module|ERR_MODULE_NOT_FOUND/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test("verify script wires the alternative-modal PTY check and never chmods the packaged binary", () => {
  const script = readFileSync(VERIFY_SCRIPT, "utf8");
  assert.match(script, /kairo-ui-alternative-modal-pty-e2e\.py/);
  assert.equal(/^\s*chmod\b/m.test(script), false, "the verifier must not chmod the packaged binary");
});
