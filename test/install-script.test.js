import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const installScript = join(packageRoot, "scripts/install.sh");
const harnessBin = join(packageRoot, "bin/harness.js");

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

function createHarnessNpxStub() {
  return `if [ "$1" = "--yes" ]; then shift; fi
pkg="$1"
shift
case "$pkg" in
  @kal-elsam/harness@*) exec "${process.execPath}" "${harnessBin}" "$@" ;;
esac
printf 'unexpected npx call: %s\\n' "$pkg" >&2
exit 99`;
}

function createFakeHome() {
  const homeDir = mkdtempSync(join(tmpdir(), "harness-install-home-"));
  mkdirSync(join(homeDir, ".cursor"), { recursive: true });
  mkdirSync(join(homeDir, ".codex"), { recursive: true });
  return homeDir;
}

test("install.sh exists and is packaged under scripts/", () => {
  assert.ok(existsSync(installScript));
  const source = readFileSync(installScript, "utf8");
  assert.match(source, /Never uses sudo/);
  assert.match(source, /setup --dry-run/);
  assert.match(source, /setup --yes/);
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

test("installer --yes prints setup --yes in plan", () => {
  const bin = createBinWith({
    node: 'echo "v18.18.0"',
    npm: 'echo "10.0.0"',
    npx: 'echo "npx should not run" >&2; exit 99'
  });

  const result = runInstaller(["--dry-run", "--yes"], { pathPrefix: bin });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /@kal-elsam\/harness@latest setup --yes/);
  assert.match(result.stdout, /Applies the ecosystem plan/);
});

test("installer passes --agents all through to harness setup", () => {
  const bin = createBinWith({
    node: 'echo "v18.18.0"',
    npm: 'echo "10.0.0"',
    npx: 'echo "npx should not run" >&2; exit 99'
  });

  const result = runInstaller(["--dry-run", "--agents", "all"], { pathPrefix: bin });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /setup --dry-run --agents all/);
});

test("installer passes --components and --no-default-components through", () => {
  const bin = createBinWith({
    node: 'echo "v18.18.0"',
    npm: 'echo "10.0.0"',
    npx: 'echo "npx should not run" >&2; exit 99'
  });

  const result = runInstaller(
    ["--dry-run", "--components", "orchestrator,sdd-core", "--no-default-components"],
    { pathPrefix: bin }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--components orchestrator,sdd-core/);
  assert.match(result.stdout, /--no-default-components/);
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

test("installer default runs setup --dry-run without writes", () => {
  const homeDir = createFakeHome();
  const bin = createBinWith({
    node: 'echo "v18.18.0"',
    npm: 'echo "10.0.0"',
    npx: createHarnessNpxStub()
  });

  const result = runInstaller([], {
    pathPrefix: bin,
    env: { ...process.env, HARNESS_HOME: homeDir }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(homeDir, ".harness")), false);
  assert.match(result.stdout, /Bootstrap complete/);
});

test("installer --yes runs setup --yes and writes harness home", () => {
  const homeDir = createFakeHome();
  const bin = createBinWith({
    node: 'echo "v18.18.0"',
    npm: 'echo "10.0.0"',
    npx: createHarnessNpxStub()
  });

  const result = runInstaller(["--yes"], {
    pathPrefix: bin,
    env: { ...process.env, HARNESS_HOME: homeDir }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(homeDir, ".harness")));
  assert.match(result.stdout, /Bootstrap complete \(applied\)/);
});

test("installer --yes with --agents all reaches harness setup", () => {
  const homeDir = createFakeHome();
  mkdirSync(join(homeDir, ".claude"), { recursive: true });
  mkdirSync(join(homeDir, ".config", "opencode"), { recursive: true });

  const bin = createBinWith({
    node: 'echo "v18.18.0"',
    npm: 'echo "10.0.0"',
    npx: createHarnessNpxStub()
  });

  const result = runInstaller(["--yes", "--agents", "all"], {
    pathPrefix: bin,
    env: { ...process.env, HARNESS_HOME: homeDir }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(homeDir, ".harness")));
});

test("shellcheck passes when available", () => {
  const shellcheck = spawnSync("command", ["-v", "shellcheck"], { encoding: "utf8" });
  if (shellcheck.status !== 0) {
    // Optional tool; absence must not fail CI.
    return;
  }

  execFileSync("shellcheck", ["-s", "sh", installScript], { stdio: "pipe" });
});
