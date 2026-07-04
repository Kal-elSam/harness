import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const installScript = join(packageRoot, "scripts/install.sh");

function runInstaller(args, { env = process.env, pathPrefix = null, pathOnly = null } = {}) {
  let pathEnv = env.PATH;
  if (pathOnly != null) {
    pathEnv = pathOnly;
  } else if (pathPrefix) {
    pathEnv = `${pathPrefix}${env.PATH ? `:${env.PATH}` : ""}`;
  }

  return spawnSync("/bin/sh", [installScript, ...args], {
    encoding: "utf8",
    env: { ...env, PATH: pathEnv }
  });
}

function createEmptyBinDir() {
  const dir = mkdtempSync(join(tmpdir(), "harness-empty-bin-"));
  return dir;
}

function createBinWith(commands) {
  const dir = mkdtempSync(join(tmpdir(), "harness-fake-bin-"));
  for (const [name, body] of Object.entries(commands)) {
    const path = join(dir, name);
    writeFileSync(path, `#!/usr/bin/env sh\n${body}\n`);
    chmodSync(path, 0o755);
  }
  return dir;
}

test("install.sh exists and is packaged under scripts/", () => {
  assert.ok(existsSync(installScript));
  const source = readFileSync(installScript, "utf8");
  assert.match(source, /Never uses sudo/);
  assert.match(source, /setup --dry-run/);
  assert.doesNotMatch(source, /(?:^|[;&|(`])\s*sudo\s+/m);
  assert.doesNotMatch(source, /(?:^|[;&|(`])\s*(?:echo|cat|tee).*(?:\.bashrc|\.zshrc|\.profile)/m);
});

test("installer --dry-run prints plan without executing install", () => {
  const bin = createBinWith({
    node: 'echo "v18.18.0"',
    npm: 'echo "10.0.0"',
    npx: 'echo "npx should not run" >&2; exit 99'
  });

  const result = runInstaller(["--dry-run"], { pathPrefix: bin });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Will run:/);
  assert.match(result.stdout, /@kal-elsam\/harness@latest setup --dry-run/);
  assert.match(result.stdout, /Dry run: plan only/);
  assert.match(result.stdout, /Does NOT write agent configs/);
  assert.doesNotMatch(result.stdout, /npx should not run/);
});

test("installer --dry-run honors --version pin", () => {
  const bin = createBinWith({
    node: 'echo "v18.18.0"',
    npm: 'echo "10.0.0"',
    npx: 'echo "npx should not run" >&2; exit 99'
  });

  const result = runInstaller(["--dry-run", "--version", "0.11.0"], { pathPrefix: bin });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /@kal-elsam\/harness@0\.11\.0 setup --dry-run/);
});

test("installer fails clearly without Node", () => {
  const empty = createEmptyBinDir();
  const result = runInstaller(["--dry-run"], { pathOnly: empty });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required command: node/);
  assert.match(result.stderr, /nodejs\.org/);
});

test("installer fails clearly without npm", () => {
  const bin = createBinWith({
    node: 'echo "v18.18.0"'
  });

  const result = runInstaller(["--dry-run"], { pathOnly: bin });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required command: npm/);
});

test("installer prefers npm exec when npx is missing", () => {
  const bin = createBinWith({
    node: 'echo "v18.18.0"',
    npm: 'echo "10.0.0"'
  });

  const result = runInstaller(["--dry-run"], { pathOnly: bin });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /runner npm-exec/);
  assert.match(result.stdout, /npm exec --yes --package=@kal-elsam\/harness@latest/);
});

test("installer rejects unknown options", () => {
  const bin = createBinWith({
    node: 'echo "v18.18.0"',
    npm: 'echo "10.0.0"'
  });

  const result = runInstaller(["--nope"], { pathPrefix: bin });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option/);
});

test("shellcheck passes when available", () => {
  const shellcheck = spawnSync("command", ["-v", "shellcheck"], { encoding: "utf8" });
  if (shellcheck.status !== 0) {
    // Optional tool; absence must not fail CI.
    return;
  }

  execFileSync("shellcheck", ["-s", "sh", installScript], { stdio: "pipe" });
});
