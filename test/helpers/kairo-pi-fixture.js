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
 */
export async function buildKairoPiFixture({
  name = KAIRO_PI_PACKAGE_NAME,
  version = KAIRO_PI_PACKAGE_VERSION
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "kairo-pi-fixture-"));
  await mkdir(join(root, "dist", "bundle"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({ name, version }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "dist", "bundle", "index.js"), "export {};\n", "utf8");
  await writeFile(join(root, "dist", "bundle", "cli.js"), "// fake Kairo-only Pi fork CLI entry\n", "utf8");

  const entryPath = join(root, "dist", "bundle", "index.js");
  return {
    root,
    entryPath,
    cliPath: join(root, "dist", "bundle", "cli.js"),
    resolveEntryImpl: () => entryPath
  };
}
