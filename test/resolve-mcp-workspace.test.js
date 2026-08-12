import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  parseWorkspaceFolderPaths,
  resolveMcpWorkspaceCwd
} from "../src/global/mcp/resolve-mcp-workspace.js";
import { publishWorkSnapshot } from "../src/global/next/publish-work-snapshot.js";
import { projectKeyForPath } from "../src/global/next/project-key.js";
import { parseArgs } from "../src/cli.js";
import { resolveMcpServeCwd } from "../src/global/mcp-install.js";

test("parseWorkspaceFolderPaths follows Cursor comma-separated folders", () => {
  assert.deepEqual(parseWorkspaceFolderPaths(""), []);
  assert.deepEqual(parseWorkspaceFolderPaths("  /a  "), ["/a"]);
  assert.deepEqual(
    parseWorkspaceFolderPaths(" /ws/a, , /ws/b "),
    ["/ws/a", "/ws/b"]
  );
  assert.deepEqual(parseWorkspaceFolderPaths("/ws/a:/ws/b"), ["/ws/a:/ws/b"]);
});

test("resolveMcpWorkspaceCwd prefers explicit cwd", () => {
  const got = resolveMcpWorkspaceCwd({
    cwd: "/explicit/ws",
    env: { VSCODE_CWD: "/injected/ws", WORKSPACE_FOLDER_PATHS: "/folders/ws" }
  });
  assert.equal(got, resolve("/explicit/ws"));
});

test("resolveMcpWorkspaceCwd prefers WORKSPACE_FOLDER_PATHS then VSCODE_CWD", () => {
  assert.equal(
    resolveMcpWorkspaceCwd({
      env: {
        WORKSPACE_FOLDER_PATHS: "/ws/a,/ws/b",
        VSCODE_CWD: "/vscode/ws"
      }
    }),
    resolve("/ws/a")
  );
  assert.equal(
    resolveMcpWorkspaceCwd({ env: { VSCODE_CWD: "/vscode/ws" } }),
    resolve("/vscode/ws")
  );
});

test("bare MCP CLI defers HOME cwd to Cursor workspace env", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-mcp-cli-home-"));
  const workspace = join(homeDir, "workspace-a");
  const prevCwd = process.cwd();
  try {
    process.chdir(homeDir);
    const bare = parseArgs(["mcp"]);
    assert.equal(bare.options.cwd, process.cwd());
    assert.equal(
      resolveMcpWorkspaceCwd({
        cwd: resolveMcpServeCwd(bare.options),
        env: { WORKSPACE_FOLDER_PATHS: workspace }
      }),
      resolve(workspace)
    );

    const explicit = parseArgs(["mcp", "--cwd", "/explicit/workspace"]);
    assert.equal(
      resolveMcpWorkspaceCwd({
        cwd: resolveMcpServeCwd(explicit.options),
        env: { WORKSPACE_FOLDER_PATHS: workspace, HOME: homeDir }
      }),
      resolve("/explicit/workspace")
    );
  } finally {
    process.chdir(prevCwd);
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("Cursor HOME spawn + VSCODE_CWD publishes under workspace key", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-mcp-cwd-"));
  const workspaceA = join(homeDir, "workspace-a");
  const prevCwd = process.cwd();
  try {
    process.chdir(homeDir);
    const cwd = resolveMcpWorkspaceCwd({
      env: { ...process.env, VSCODE_CWD: workspaceA, HOME: homeDir }
    });
    assert.equal(cwd, resolve(workspaceA));
    assert.notEqual(cwd, resolve(homeDir));

    const result = await publishWorkSnapshot({
      conversationId: "cursor-ide-cwd-regression",
      provider: "cursor",
      goal: "Bind publish to VSCODE_CWD workspace",
      progress: ["Simulated HOME spawn"],
      now: "Publishing with injected VSCODE_CWD",
      blockers: ["None"],
      next: "Panel reads workspace A"
    }, { homeDir, cwd });

    assert.equal(result.ok, true);
    assert.equal(result.data.projectKey, projectKeyForPath(workspaceA));
    assert.notEqual(result.data.projectKey, projectKeyForPath(homeDir));
  } finally {
    process.chdir(prevCwd);
    await rm(homeDir, { recursive: true, force: true });
  }
});
