import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KAIRO_PI_PACKAGE_NAME, KAIRO_PI_PACKAGE_VERSION } from "../../src/global/host/launch-gentle-shell.js";

/**
 * Build a fake, on-disk "@kal-elsam/kairo-pi-coding-agent" package tree that
 * matches the shape launch-gentle-shell.js walks: a package.json at the
 * root and dist/bundle/{index.js,cli.js} beneath it. Returns the root dir
 * and a resolveEntryImpl the launcher can call in place of the real
 * import.meta.resolve() lookup.
 *
 * Pass `withCliEntry: false` to build a package whose package.json and
 * dist/bundle/ directory exist but whose dist/bundle/cli.js is missing —
 * for exercising the missing-bundle failure path.
 */
export async function buildKairoPiFixture({
  name = KAIRO_PI_PACKAGE_NAME,
  version = KAIRO_PI_PACKAGE_VERSION,
  withCliEntry = true
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "kairo-pi-fixture-"));
  await mkdir(join(root, "dist", "bundle"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({ name, version }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "dist", "bundle", "index.js"), "export {};\n", "utf8");
  if (withCliEntry) {
    await writeFile(join(root, "dist", "bundle", "cli.js"), "// fake Kairo-only Pi fork CLI entry\n", "utf8");
  }

  const entryPath = join(root, "dist", "bundle", "index.js");
  return {
    root,
    entryPath,
    cliPath: join(root, "dist", "bundle", "cli.js"),
    resolveEntryImpl: () => entryPath
  };
}

/**
 * Build an entry file with NO package.json anywhere in its ancestor chain,
 * so findPackageRoot() in launch-gentle-shell.js walks all the way up
 * without ever finding a match. Used to exercise the "could not find the
 * package.json" failure path.
 */
export async function buildKairoPiEntryWithoutPackageJson() {
  const root = await mkdtemp(join(tmpdir(), "kairo-pi-no-pkg-"));
  const entryDir = join(root, "dist", "bundle");
  await mkdir(entryDir, { recursive: true });
  const entryPath = join(entryDir, "index.js");
  await writeFile(entryPath, "export {};\n", "utf8");
  return { root, entryPath, resolveEntryImpl: () => entryPath };
}

/**
 * Build a fixture where the real package root (with a matching, valid
 * package.json and a full dist/bundle/cli.js) sits ABOVE an intermediate
 * directory that itself holds a malformed package.json. Exercises the
 * catch-and-keep-walking branch in findPackageRoot(): the malformed file
 * must be skipped rather than aborting the walk, and resolution must still
 * succeed at the real root above it.
 */
export async function buildKairoPiFixtureWithMalformedIntermediatePackageJson({
  name = KAIRO_PI_PACKAGE_NAME,
  version = KAIRO_PI_PACKAGE_VERSION
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "kairo-pi-malformed-pkg-"));
  await mkdir(join(root, "dist", "bundle"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({ name, version }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "dist", "bundle", "cli.js"), "// fake Kairo-only Pi fork CLI entry\n", "utf8");

  const nestedDir = join(root, "nested", "dist", "bundle");
  await mkdir(nestedDir, { recursive: true });
  await writeFile(join(root, "nested", "package.json"), "{ this is not valid json", "utf8");
  const entryPath = join(nestedDir, "index.js");
  await writeFile(entryPath, "export {};\n", "utf8");

  return {
    root,
    entryPath,
    cliPath: join(root, "dist", "bundle", "cli.js"),
    resolveEntryImpl: () => entryPath
  };
}
