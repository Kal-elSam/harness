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
    // codex.js's execution adapter now runs a real preflight
    // (verifyCodexSubscriptionAuth -> `codex login status`) before every
    // launch, so a bare `exit 0` stub fails it. Answer that one subcommand
    // the way a logged-in Codex CLI does; every other invocation still
    // just succeeds, matching what these supervisor-mechanics tests need.
    const script = name === "codex"
      ? "#!/bin/sh\nif [ \"$1\" = \"login\" ] && [ \"$2\" = \"status\" ]; then echo \"Logged in using ChatGPT\"; fi\nexit 0\n"
      : "#!/bin/sh\nexit 0\n";
    await writeFile(filePath, script, "utf8");
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
