import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { parseArgs, buildMcpCliOptions } from "../src/cli.js";
import {
  WORKSPACE_BINDING_CODES,
  resolveWorkspaceWriteBinding
} from "../src/global/mcp/workspace-binding.js";
import { canonicalizeProjectPath, projectKeyForPath } from "../src/global/next/project-key.js";
import {
  createToolHandlers, KAIRO_MCP_READ_TOOLS, KAIRO_MCP_WRITE_TOOLS, registerKairoMcpTools
} from "../src/global/mcp/kairo-mcp.js";
import { listWorkSnapshots } from "../src/global/next/work-snapshot.js";
import { loadEnrollment } from "../src/global/next/work-enroll.js";
import { runMcpCli } from "../src/global/mcp-install.js";
import { parseWorkspaceMcpArgv, startWorkspaceMcp } from "../src/global/mcp/workspace-mcp-entry.js";

const payload = {
  conversationId: "pilot-chat",
  provider: "cursor",
  goal: "Bind writes to this folder",
  progress: ["Slice 01"],
  now: "Publishing from bound MCP",
  blockers: [],
  next: "Keep the other workspace empty"
};

test("parseArgs records --workspace-bound and explicit --cwd", () => {
  const parsed = parseArgs(["mcp", "--workspace-bound", "--cwd", "."]);
  assert.equal(parsed.options.workspaceBound, true);
  assert.equal(parsed.options.cwdExplicit, true);
  assert.equal(parseArgs(["mcp"]).options.workspaceBound, false);
});

test("VSCODE_CWD never authorizes writes; flags stay mandatory", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-bind-un-"));
  const ws = join(root, "ws");
  await mkdir(ws);
  try {
    const env = { VSCODE_CWD: "/", WORKSPACE_FOLDER_PATHS: ws, HOME: homedir() };
    assert.equal(resolveWorkspaceWriteBinding({ env, processCwd: homedir(), cwd: homedir() }).code, WORKSPACE_BINDING_CODES.UNBOUND);
    assert.equal(resolveWorkspaceWriteBinding({
      workspaceBound: true, cwdExplicit: true, cwd: ws, processCwd: ws, env
    }).writable, true);
    assert.equal(resolveWorkspaceWriteBinding({
      workspaceBound: true, cwdExplicit: true, cwd: ".", processCwd: homedir(), userHome: homedir(), env: { VSCODE_CWD: ws }
    }).code, WORKSPACE_BINDING_CODES.MISMATCH);
    assert.equal(resolveWorkspaceWriteBinding({
      workspaceBound: true, cwdExplicit: true, cwd: "/", processCwd: "/", userHome: homedir()
    }).code, WORKSPACE_BINDING_CODES.MISMATCH);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("multi-root is ambiguous; cwd/process mismatch fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-bind-amb-"));
  const a = join(root, "a");
  const b = join(root, "b");
  await mkdir(a);
  await mkdir(b);
  try {
    assert.equal(
      resolveWorkspaceWriteBinding({
        workspaceBound: true,
        cwdExplicit: true,
        cwd: a,
        processCwd: a,
        env: { WORKSPACE_FOLDER_PATHS: `${a},${b}` }
      }).code,
      WORKSPACE_BINDING_CODES.AMBIGUOUS
    );
    assert.equal(
      resolveWorkspaceWriteBinding({
        workspaceBound: true, cwdExplicit: true, cwd: a, processCwd: b
      }).code,
      WORKSPACE_BINDING_CODES.MISMATCH
    );
    assert.equal(
      resolveWorkspaceWriteBinding({
        workspaceBound: true, cwdExplicit: false, cwd: a, processCwd: a
      }).code,
      WORKSPACE_BINDING_CODES.UNBOUND
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unique WORKSPACE_FOLDER_PATHS may match --cwd when process cwd is HOME", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-bind-home-"));
  const ws = join(root, "ws");
  const other = join(root, "other");
  await mkdir(ws);
  await mkdir(other);
  try {
    const home = homedir();
    assert.equal(resolveWorkspaceWriteBinding({
      workspaceBound: true,
      cwdExplicit: true,
      cwd: ws,
      processCwd: home,
      userHome: home,
      env: { HOME: home, WORKSPACE_FOLDER_PATHS: ws }
    }).writable, true);
    assert.equal(resolveWorkspaceWriteBinding({
      workspaceBound: true,
      cwdExplicit: true,
      cwd: ws,
      processCwd: home,
      userHome: home,
      env: { HOME: home }
    }).code, WORKSPACE_BINDING_CODES.MISMATCH);
    assert.equal(resolveWorkspaceWriteBinding({
      workspaceBound: true,
      cwdExplicit: true,
      cwd: ws,
      processCwd: home,
      userHome: home,
      env: { HOME: home, WORKSPACE_FOLDER_PATHS: other }
    }).code, WORKSPACE_BINDING_CODES.MISMATCH);
    assert.equal(resolveWorkspaceWriteBinding({
      workspaceBound: true,
      cwdExplicit: true,
      cwd: ws,
      processCwd: home,
      userHome: home,
      env: { HOME: home, VSCODE_CWD: ws }
    }).code, WORKSPACE_BINDING_CODES.MISMATCH);
    assert.equal(resolveWorkspaceWriteBinding({
      workspaceBound: true,
      cwdExplicit: true,
      cwd: ws,
      processCwd: home,
      userHome: home,
      env: { HOME: home, WORKSPACE_FOLDER_PATHS: `${ws},${other}` }
    }).code, WORKSPACE_BINDING_CODES.AMBIGUOUS);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("diverging symlink vs unique folder fails closed; aliases still converge", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-bind-div-"));
  const realA = join(root, "real-a");
  const realB = join(root, "real-b");
  const linkA = join(root, "link-a");
  await mkdir(realA);
  await mkdir(realB);
  await symlink(realA, linkA);
  try {
    const home = homedir();
    const diverged = resolveWorkspaceWriteBinding({
      workspaceBound: true,
      cwdExplicit: true,
      cwd: linkA,
      processCwd: home,
      userHome: home,
      env: { HOME: home, WORKSPACE_FOLDER_PATHS: realB }
    });
    assert.equal(diverged.writable, false);
    assert.equal(diverged.code, WORKSPACE_BINDING_CODES.MISMATCH);

    const viaAlias = resolveWorkspaceWriteBinding({
      workspaceBound: true,
      cwdExplicit: true,
      cwd: linkA,
      processCwd: home,
      userHome: home,
      env: { HOME: home, WORKSPACE_FOLDER_PATHS: realA }
    });
    assert.equal(viaAlias.writable, true);
    assert.equal(viaAlias.cwd, canonicalizeProjectPath(realA));
    assert.equal(viaAlias.projectKey, projectKeyForPath(realA));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("symlink aliases converge; two bindings isolate project keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "kairo-bind-sy-"));
  const real = join(root, "real");
  const link = join(root, "link");
  await mkdir(real);
  await symlink(real, link);
  try {
    const viaLink = resolveWorkspaceWriteBinding({
      workspaceBound: true, cwdExplicit: true, cwd: ".", processCwd: link
    });
    const viaReal = resolveWorkspaceWriteBinding({
      workspaceBound: true, cwdExplicit: true, cwd: ".", processCwd: real
    });
    assert.equal(viaLink.writable && viaReal.writable, true);
    assert.equal(viaLink.cwd, canonicalizeProjectPath(real));
    assert.equal(viaLink.projectKey, viaReal.projectKey);
    assert.equal(viaLink.projectKey, projectKeyForPath(realpathSync(link)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MCP publish is absent unless bound; unbound writes nothing", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-bind-mcp-"));
  const ws = join(homeDir, "ws");
  await mkdir(ws);
  try {
    const unbound = createToolHandlers({
      homeDir, cwd: ws, env: { VSCODE_CWD: ws, WORKSPACE_FOLDER_PATHS: ws }
    });
    const denied = await unbound.kairo_publish_work_snapshot(payload);
    assert.equal(denied.structuredContent.code, WORKSPACE_BINDING_CODES.UNBOUND);
    assert.equal((await listWorkSnapshots(homeDir, ws)).length, 0);
    assert.equal(await loadEnrollment(homeDir, ws, payload.conversationId), null);

    const bound = createToolHandlers({
      homeDir,
      cwd: ws,
      cwdExplicit: true,
      workspaceBound: true,
      processCwd: ws,
      env: { VSCODE_CWD: "/", WORKSPACE_FOLDER_PATHS: ws }
    });
    const ok = await bound.kairo_publish_work_snapshot(payload);
    assert.equal(ok.structuredContent.ok, true);
    assert.equal(ok.structuredContent.data.projectKey, projectKeyForPath(ws));
    assert.equal((await listWorkSnapshots(homeDir, ws)).length, 1);
    assert.equal(
      (await bound.kairo_publish_work_snapshot({ ...payload, conversationId: "evil", cwd: "/other" }))
        .structuredContent.code,
      "forbidden_identity_fields"
    );

    const registered = [];
    registerKairoMcpTools((name) => registered.push(name), {
      homeDir, cwd: ws, workspaceBound: true, cwdExplicit: true, processCwd: ws
    });
    assert.deepEqual(registered, [...KAIRO_MCP_WRITE_TOOLS]);
    const readonly = [];
    registerKairoMcpTools((name) => readonly.push(name), { homeDir });
    assert.deepEqual(readonly, [...KAIRO_MCP_READ_TOOLS]);
    assert.equal(KAIRO_MCP_WRITE_TOOLS.every((n) => !KAIRO_MCP_READ_TOOLS.includes(n)), true);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});

test("CLI dispatch registers publish only when workspace-bound", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-bind-cli-"));
  const ws = join(homeDir, "ws");
  await mkdir(ws);
  try {
    const boundNames = [];
    const bound = buildMcpCliOptions(
      parseArgs(["mcp", "--workspace-bound", "--cwd", ws]).options,
      {
        homeDir,
        processCwd: ws,
        env: { HOME: homeDir },
        registerTool: (name) => boundNames.push(name),
        serveStdio: (factory) => factory()
      }
    );
    assert.equal(bound.workspaceBound, true);
    await runMcpCli(bound);
    assert.deepEqual(boundNames, [...KAIRO_MCP_WRITE_TOOLS]);
    assert.deepEqual(parseWorkspaceMcpArgv(["mcp", "--workspace-bound", "--cwd", ws]), {
      workspaceBound: true, cwd: ws, cwdExplicit: true
    });
    const entryNames = [];
    await startWorkspaceMcp(["mcp", "--workspace-bound", "--cwd", ws], {
      homeDir, processCwd: ws, env: { HOME: homeDir },
      registerTool: (name) => entryNames.push(name),
      serveStdio: (factory) => factory()
    });
    assert.deepEqual(entryNames, [...KAIRO_MCP_WRITE_TOOLS]);

    const unboundNames = [];
    await runMcpCli(buildMcpCliOptions(parseArgs(["mcp"]).options, {
      homeDir,
      processCwd: ws,
      env: { HOME: homeDir },
      registerTool: (name) => unboundNames.push(name),
      serveStdio: (factory) => factory()
    }));
    assert.equal(unboundNames.includes("kairo_publish_work_snapshot"), false);
    assert.deepEqual(unboundNames, [...KAIRO_MCP_READ_TOOLS]);
    assert.equal((await listWorkSnapshots(homeDir, ws)).length, 0);
    assert.equal(await loadEnrollment(homeDir, ws, payload.conversationId), null);
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
});
