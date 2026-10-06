import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Offline clean-install check. Packs the checkout, extracts the tarball into a
 * temp dir OUTSIDE the checkout and verifies the extracted copy on its own.
 *
 * Offline limit: declared npm dependencies (react, ink, zod, the MCP SDK, the
 * Pi fork...) are NOT installed in the extracted copy, so modules importing them
 * cannot execute here. The registry-backed run lives in
 * scripts/clean-install-smoke.sh (`npm run smoke:clean-install`).
 */

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(checkout, "package.json"), "utf8"));
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

const ENTRY_MODULES = [
  "src/cli.js",
  "src/global/conversation/service.js",
  "src/global/conversation/operations.js",
  "src/global/conversation/transition-store.js",
  "src/global/conversation/gentle-reader.js",
  "src/global/mcp/kairo-mcp.js",
  "src/global/mcp/conversation-read-tools.js",
  "src/global/mcp/conversation-delegate-tools.js",
  "src/global/host/launch-gentle-shell.js"
];
const PACKAGE_RESOURCES = ["repo-template", "global-template", "prompts", "README.md", "LICENSE", "CHANGELOG.md"];

let workdir;
let pkg; // extracted package root

before(() => {
  workdir = realpathSync(mkdtempSync(join(tmpdir(), "kairo-clean-install-")));
  assert.ok(!workdir.startsWith(checkout + sep), "temp dir must be outside the checkout");
  const packDir = join(workdir, "pack");
  mkdirSync(packDir);
  const [{ filename }] = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", packDir], {
      cwd: checkout,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    })
  );
  const extractDir = join(workdir, "extract");
  mkdirSync(extractDir);
  execFileSync("tar", ["-xzf", join(packDir, filename), "-C", extractDir]);
  pkg = join(extractDir, "package");
});

after(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

function stripComments(source) {
  // JSDoc `import("...")` types live in comments and are not runtime imports.
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function importSpecifiers(rawSource) {
  const source = stripComments(rawSource);
  const specs = new Set();
  const patterns = [
    /\bimport\s+(?:[^'"()]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+[^'"();]*?\s+from\s+["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) specs.add(m[1]);
  return [...specs];
}

function packageNameOf(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function walkClosure(root, entries) {
  const seen = new Set();
  const escapes = [];
  const missing = [];
  const bare = new Set();
  const queue = entries.map((e) => join(root, e));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) {
      missing.push(file);
      continue;
    }
    for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
      if (spec.startsWith(".")) {
        const target = resolve(dirname(file), spec);
        if (!target.startsWith(root + sep)) escapes.push(`${relative(root, file)} -> ${spec}`);
        else if (target.endsWith(".js") || target.endsWith(".mjs")) queue.push(target);
        else if (!existsSync(target)) missing.push(target);
      } else if (!spec.startsWith("node:") && !builtins.has(spec)) {
        bare.add(packageNameOf(spec));
      }
    }
  }
  return { seen, escapes, missing, bare };
}

test("extracted tarball lives outside the checkout and has no node_modules", () => {
  assert.ok(!pkg.startsWith(checkout + sep));
  assert.ok(!existsSync(join(pkg, "node_modules")));
});

test("every package-root resource the CLI resolves exists in the tarball", () => {
  for (const rel of PACKAGE_RESOURCES) assert.ok(existsSync(join(pkg, rel)), `missing resource ${rel}`);
  for (const [name, target] of Object.entries(manifest.bin)) {
    assert.ok(existsSync(join(pkg, target)), `bin ${name} target missing: ${target}`);
  }
  for (const rel of ENTRY_MODULES) assert.ok(statSync(join(pkg, rel)).isFile(), `missing module ${rel}`);
  assert.ok(existsSync(join(pkg, "src/global/mcp/conversation-read-tools.js")));
  assert.ok(readdirSync(join(pkg, "global-template")).length > 0);
});

test("static import closure stays inside the tarball and uses only declared dependencies", () => {
  const entries = [...ENTRY_MODULES, ...Object.values(manifest.bin).map((p) => p.replace(/^\.\//, ""))];
  const { seen, escapes, missing, bare } = walkClosure(pkg, entries);
  assert.deepEqual(escapes, [], "relative imports must not escape the package");
  assert.deepEqual(missing, [], "every relative import must exist in the tarball");
  assert.ok(seen.size > 20, "closure should cover the real module graph");
  const declared = new Set(Object.keys(manifest.dependencies ?? {}));
  const undeclared = [...bare].filter((name) => !declared.has(name));
  assert.deepEqual(undeclared, [], "bare imports must be declared dependencies");
});

test("extracted CLI runs with a scrubbed env and writes nothing outside HARNESS_HOME", () => {
  const home = join(workdir, "home");
  mkdirSync(home);
  const cwd = join(workdir, "cwd");
  mkdirSync(cwd);
  const env = { PATH: process.env.PATH, HOME: home, HARNESS_HOME: home };
  const result = spawnSync(process.execPath, [join(pkg, "bin/kairo.js"), "--help"], {
    cwd,
    env,
    encoding: "utf8"
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.ok(!output.includes(checkout), "output must not reference the checkout");
  if (result.status === 0) {
    assert.match(result.stdout, /kairo/i);
  } else {
    // Offline limit: declared npm deps are not installed here. The only
    // acceptable failure is a missing DECLARED dependency, never a repo path.
    const m = output.match(/Cannot find package '([^']+)'/);
    assert.ok(m, `unexpected failure (status ${result.status}): ${output.slice(0, 400)}`);
    assert.ok(manifest.dependencies[packageNameOf(m[1])], `missing package ${m[1]} must be a declared dependency`);
  }
  assert.deepEqual(readdirSync(cwd), [], "cwd must stay untouched");
  assert.ok(!existsSync(join(pkg, "node_modules")));
});

test("registry-backed clean-install smoke is wired as an explicit npm script", () => {
  assert.equal(manifest.scripts["smoke:clean-install"], "bash scripts/clean-install-smoke.sh");
  assert.ok(existsSync(join(checkout, "scripts/clean-install-smoke.sh")));
  assert.ok(existsSync(join(checkout, "scripts/lib/clean-install-mcp-handshake.mjs")));
  assert.ok(!manifest.scripts.test.includes("clean-install-smoke"), "must stay out of npm test");
  assert.ok(existsSync(join(pkg, "scripts/clean-install-smoke.sh")), "script ships in the tarball");
});
