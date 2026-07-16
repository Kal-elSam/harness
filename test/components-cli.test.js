import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessBin = join(packageRoot, "bin/harness.js");

test("harness components prints bundled catalog", () => {
  const result = spawnSync(process.execPath, [harnessBin, "components"], {
    cwd: packageRoot,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Kairo Runtime components \(scope: agent-global\)/);
  assert.match(result.stdout, /Bundled: 4/);
  assert.match(result.stdout, /orchestrator \(1\.0\.0\) \[default\]/);
  assert.match(result.stdout, /sdd-core \(2\.0\.0\) \[default\]/);
  assert.match(result.stdout, /engram-memory \(1\.0\.0\) \[optional\]/);
  assert.match(result.stdout, /graphify-context \(1\.0\.0\) \[optional\]/);
  assert.match(result.stdout, /Assets: orchestrator\.md/);
  assert.match(result.stdout, /Assets: workflow\.md, spec-sizing\.md, handoff\.md/);
  assert.match(result.stdout, /skills\/sdd-init\/SKILL\.md/);
  assert.match(result.stdout, /Adapter hints: cursor, codex, claude, opencode/);
  assert.match(result.stdout, /Workspace: 0/);
});
