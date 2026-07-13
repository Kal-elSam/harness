import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Prepend stub executables to PATH for the duration of fn.
 * Needed so CI (without agent CLIs) can exercise launchable adapters.
 */
export async function withStubExecutables(names, fn) {
  const binDir = await mkdtemp(join(tmpdir(), "kairo-stub-bin-"));
  for (const name of names) {
    const filePath = join(binDir, name);
    await writeFile(filePath, "#!/bin/sh\nexit 0\n", "utf8");
    await chmod(filePath, 0o755);
  }

  const previousPath = process.env.PATH ?? "";
  process.env.PATH = `${binDir}${delimiter}${previousPath}`;

  try {
    return await fn(binDir);
  } finally {
    process.env.PATH = previousPath;
  }
}
