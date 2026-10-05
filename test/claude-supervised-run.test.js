import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { startRun } from "../src/global/runtime/run-manager.js";
import { DelegatedWriteAdmissionError } from "../src/global/runtime/delegated-write-admission.js";

test("Claude productive startRun is refused by delegated write admission (unverified write floor)", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-claude-supervisor-"));
  const binDir = await mkdtemp(join(tmpdir(), "kairo-claude-bin-"));
  const executable = join(binDir, "claude");
  await writeFile(executable, "#!/bin/sh\nprintf '%s\\n' '{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\",\"subscriptionType\":\"pro\"}'\n");
  await chmod(executable, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}${delimiter}${previousPath ?? ""}`;
  try {
    await assert.rejects(
      () => startRun({
        homeDir, runId: "run_reserved", agentId: "claude", task: "Implement",
        cwd: homeDir, permissions: [], allowUnsafePermissions: false,
        permissionSource: "cockpit", wait: true,
        spawnImpl() {
          throw new Error("spawn must not run under unverified write admission");
        }
      }),
      (error) => error instanceof DelegatedWriteAdmissionError
        && error.code === "delegated_write_admission_denied"
        && /Claude/.test(error.message)
    );
  } finally {
    process.env.PATH = previousPath;
  }
});
