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

function createInstallerBin({ kairoPath = null } = {}) {
  const binDir = mkdtempSync(join(tmpdir(), "harness-fake-bin-"));
  const npmGlobalPrefix = mkdtempSync(join(tmpdir(), "harness-npm-global-"));
  const npmGlobalBin = join(npmGlobalPrefix, "bin");
  mkdirSync(npmGlobalBin, { recursive: true });

  const kairoBin = kairoPath ?? join(binDir, "kairo");
  const kairoBody = `#!/usr/bin/env sh
exec "${process.execPath}" "${harnessBin}" "$@"
`;

  const npmBody = `#!/usr/bin/env sh
if [ "$1" = "prefix" ] && [ "$2" = "-g" ]; then
  printf '%s\\n' "${npmGlobalPrefix}"
  exit 0
fi
if [ "$1" = "install" ] && [ "$2" = "-g" ]; then
  shift 2
  cat > "${kairoBin}" <<'EOF'
${kairoBody}
EOF
  chmod +x "${kairoBin}"
  exit 0
fi
printf '%s\\n' "10.0.0"
`;

  writeFileSync(join(binDir, "node"), "#!/usr/bin/env sh\necho \"v18.18.0\"\n");
  writeFileSync(join(binDir, "npm"), npmBody);
  chmodSync(join(binDir, "node"), 0o755);
  chmodSync(join(binDir, "npm"), 0o755);

  return { binDir, npmGlobalBin, kairoBin };
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
  assert.match(source, /npm install -g/);
  assert.doesNotMatch(source, /(?:^|[;&|(`])\s*sudo\s+/m);
  assert.doesNotMatch(source, /(?:^|[;&|(`])\s*(?:echo|cat|tee).*(?:\.bashrc|\.zshrc|\.profile)/m);
});

test("installer --dry-run prints plan without executing install", () => {
  const { binDir } = createInstallerBin();

  const result = runInstaller(["--dry-run"], { pathPrefix: `${binDir}:` });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Will run:/);
  assert.match(result.stdout, /npm install -g @kal-elsam\/kairo-runtime@latest/);
  assert.match(result.stdout, /kairo setup --dry-run/);
  assert.match(result.stdout, /Dry run: plan only/);
  assert.match(result.stdout, /Does NOT write agent configs/);
});

test("installer --dry-run honors --version pin", () => {
  const { binDir } = createInstallerBin();

  const result = runInstaller(["--dry-run", "--version", "0.11.0"], { pathPrefix: `${binDir}:` });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm install -g @kal-elsam\/kairo-runtime@0\.11\.0/);
  assert.match(result.stdout, /kairo setup --dry-run/);
});

test("installer --yes prints setup --yes in plan", () => {
  const { binDir } = createInstallerBin();

  const result = runInstaller(["--dry-run", "--yes"], { pathPrefix: `${binDir}:` });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /kairo setup --yes/);
  assert.match(result.stdout, /Applies the ecosystem plan/);
});

test("installer passes --agents all through to kairo setup", () => {
  const { binDir } = createInstallerBin();

  const result = runInstaller(["--dry-run", "--agents", "all"], { pathPrefix: `${binDir}:` });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /kairo setup --dry-run --agents all/);
});

test("installer passes --components and --no-default-components through", () => {
  const { binDir } = createInstallerBin();

  const result = runInstaller(
    ["--dry-run", "--components", "orchestrator,sdd-core", "--no-default-components"],
    { pathPrefix: `${binDir}:` }
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
  const binDir = mkdtempSync(join(tmpdir(), "harness-node-only-"));
  writeFileSync(join(binDir, "node"), "#!/usr/bin/env sh\necho \"v18.18.0\"\n");
  chmodSync(join(binDir, "node"), 0o755);

  const result = runInstaller(["--dry-run"], { pathOnly: binDir });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required command: npm/);
});

test("installer rejects unknown options", () => {
  const { binDir } = createInstallerBin();

  const result = runInstaller(["--nope"], { pathPrefix: `${binDir}:` });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option/);
});

test("installer default runs setup --dry-run without writes", () => {
  const homeDir = createFakeHome();
  const { binDir } = createInstallerBin();

  const result = runInstaller([], {
    pathPrefix: `${binDir}:`,
    env: { ...process.env, HARNESS_HOME: homeDir }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(homeDir, ".harness")), false);
  assert.match(result.stdout, /Installing global CLI/);
  assert.match(result.stdout, /Bootstrap complete/);
  assert.match(result.stdout, /setup --dry-run/);
});

test("installer --yes runs setup --yes and writes harness home", () => {
  const homeDir = createFakeHome();
  const { binDir } = createInstallerBin();

  const result = runInstaller(["--yes"], {
    pathPrefix: `${binDir}:`,
    env: { ...process.env, HARNESS_HOME: homeDir }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(homeDir, ".harness")));
  assert.match(result.stdout, /Bootstrap complete \(applied\)/);
  assert.match(result.stdout, /Check health:\s+kairo status/);
  assert.match(result.stdout, /Repair drift:\s+kairo sync/);
  assert.match(result.stdout, /kairo upgrade --dry-run/);
});

test("installer --yes with --agents all reaches kairo setup", () => {
  const homeDir = createFakeHome();
  mkdirSync(join(homeDir, ".claude"), { recursive: true });
  mkdirSync(join(homeDir, ".config", "opencode"), { recursive: true });

  const { binDir } = createInstallerBin();

  const result = runInstaller(["--yes", "--agents", "all"], {
    pathPrefix: `${binDir}:`,
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
