/**
 * MCP install for Claude Code and Codex. Every test uses a temp HOME and explicit
 * injected paths: the real ~/.claude*, ~/.codex*, ~/.cursor* are never read or written.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseArgs } from "../src/cli.js";
import { detectAgentMcpRegistration, resolveMcpConfigPath } from "../src/global/connections.js";
import { runMcpInstall } from "../src/global/mcp-install.js";

async function tempHome(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "kairo-mcp-clients-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  await mkdir(home, { recursive: true });
  return { root, home };
}

const run = (options) => runMcpInstall({ json: true, quiet: true, ...options });
const exists = (path) => readFile(path).then(() => true, () => false);

test("client config paths resolve under the injected home", () => {
  assert.equal(resolveMcpConfigPath("claude-code", { homeDir: "/h" }), "/h/.claude.json");
  assert.equal(resolveMcpConfigPath("codex", { homeDir: "/h" }), "/h/.codex/config.toml");
  assert.equal(resolveMcpConfigPath("cursor", { homeDir: "/h" }), "/h/.cursor/mcp.json");
});

test("plan is the default: shows the change and writes nothing", async (t) => {
  const { home } = await tempHome(t);
  for (const [client, rel] of [["claude-code", ".claude.json"], ["codex", ".codex/config.toml"]]) {
    const result = await run({ client, homeDir: home });
    assert.equal(result.applied, false);
    assert.equal(result.plan.client, client);
    assert.equal(result.plan.wouldWrite, true);
    assert.equal(result.plan.state, "missing");
    assert.equal(result.plan.entry.command, "kairo");
    assert.deepEqual(result.plan.entry.args, ["mcp"]);
    assert.equal(JSON.stringify(result.plan.entry).includes("--workspace-bound"), false);
    assert.match(result.plan.applyWith, new RegExp(`--client ${client}.*--yes`));
    assert.equal(await exists(join(home, rel)), false);
  }
  assert.deepEqual(await readdir(home), []);
});

test("plan output does not leak the absolute home path", async (t) => {
  const { home } = await tempHome(t);
  const result = await run({ client: "codex", homeDir: home });
  assert.equal(JSON.stringify(result).includes(home), false);
  assert.match(result.plan.path, /^~\/\.codex\/config\.toml$/);
});

test("claude-code apply: backup + atomic write, unrelated keys and servers preserved", async (t) => {
  const { home } = await tempHome(t);
  const path = join(home, ".claude.json");
  const original = JSON.stringify({
    numStartups: 7,
    projects: { "/some/project": { allowedTools: ["Bash"] } },
    mcpServers: { other: { type: "stdio", command: "x", args: ["y"] } }
  }, null, 2);
  await writeFile(path, original);

  const receipt = await run({ client: "claude-code", homeDir: home, yes: true, now: () => 111 });
  assert.equal(receipt.applied, true);
  assert.equal(receipt.wrote, true);
  assert.ok(receipt.backupPath.endsWith(".claude.json.kairo-backup.111"));
  assert.equal(await readFile(join(home, ".claude.json.kairo-backup.111"), "utf8"), original);

  const next = JSON.parse(await readFile(path, "utf8"));
  assert.equal(next.numStartups, 7);
  assert.deepEqual(next.projects, { "/some/project": { allowedTools: ["Bash"] } });
  assert.deepEqual(next.mcpServers.other, { type: "stdio", command: "x", args: ["y"] });
  assert.equal(next.mcpServers.kairo.command, "kairo");
  assert.deepEqual(next.mcpServers.kairo.args, ["mcp"]);
  const leftovers = (await readdir(home)).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});

test("claude-code apply on a missing file creates it without a backup", async (t) => {
  const { home } = await tempHome(t);
  const receipt = await run({ client: "claude-code", homeDir: home, yes: true });
  assert.equal(receipt.backupPath, null);
  assert.equal(JSON.parse(await readFile(join(home, ".claude.json"), "utf8")).mcpServers.kairo.command, "kairo");
});

test("codex apply: backup, comments and other sections preserved byte-for-byte", async (t) => {
  const { home } = await tempHome(t);
  const path = join(home, ".codex", "config.toml");
  await mkdir(join(home, ".codex"));
  const original = '# personal\nmodel = "gpt-5" # keep\n\n[mcp_servers.engram]\ncommand = "engram"\nargs = ["mcp"]\n';
  await writeFile(path, original);

  const receipt = await run({ client: "codex", homeDir: home, yes: true, now: () => 222 });
  assert.equal(receipt.applied, true);
  assert.equal(await readFile(`${path}.kairo-backup.222`, "utf8"), original);
  assert.equal(
    await readFile(path, "utf8"),
    `${original}\n[mcp_servers.kairo]\ncommand = "kairo"\nargs = ["mcp"]\n`
  );
  assert.deepEqual(
    (await readdir(join(home, ".codex"))).filter((name) => name.endsWith(".tmp")),
    []
  );
});

test("re-running apply is a no-op: no write, no extra backup, identical bytes", async (t) => {
  const { home } = await tempHome(t);
  for (const [client, path] of [
    ["claude-code", join(home, ".claude.json")],
    ["codex", join(home, ".codex", "config.toml")]
  ]) {
    await run({ client, homeDir: home, yes: true, now: () => 1 });
    const before = await readFile(path, "utf8");
    const dir = join(path, "..");
    const filesBefore = (await readdir(dir)).sort();
    const again = await run({ client, homeDir: home, yes: true, now: () => 2 });
    assert.equal(again.wrote, false);
    assert.equal(again.backupPath, null);
    assert.equal(await readFile(path, "utf8"), before);
    assert.deepEqual((await readdir(dir)).sort(), filesBefore);
    const plan = await run({ client, homeDir: home });
    assert.equal(plan.plan.wouldWrite, false);
    assert.equal(plan.plan.state, "ok");
  }
});

test("unparseable existing config is refused with a typed error and nothing is written", async (t) => {
  const { home } = await tempHome(t);
  await mkdir(join(home, ".codex"));
  const cases = [
    ["claude-code", join(home, ".claude.json"), "{ not json"],
    ["codex", join(home, ".codex", "config.toml"), 'model = "unterminated\n']
  ];
  for (const [client, path, body] of cases) {
    await writeFile(path, body);
    for (const yes of [false, true]) {
      await assert.rejects(
        run({ client, homeDir: home, yes }),
        (error) => error.code === "config_unparseable"
      );
    }
    assert.equal(await readFile(path, "utf8"), body);
    assert.deepEqual(
      (await readdir(join(path, ".."))).filter((name) => name.includes("kairo-backup")),
      []
    );
  }
});

test("drift is detected by the health surface and repaired by apply", async (t) => {
  const { home } = await tempHome(t);
  await mkdir(join(home, ".codex"));
  await writeFile(join(home, ".claude.json"), JSON.stringify({
    mcpServers: { kairo: { command: "kairo", args: ["mcp", "--bogus"] } }
  }));
  await writeFile(join(home, ".codex", "config.toml"), '[mcp_servers.kairo]\ncommand = "node"\nargs = ["x"]\n');

  for (const client of ["claude-code", "codex"]) {
    const before = await detectAgentMcpRegistration({ client, homeDir: home });
    assert.equal(before.connected, false);
    assert.equal(before.state, "error");
    assert.match(before.detail, /drift|unhealthy/i);
    assert.equal(before.detail.includes(home), false);
    await run({ client, homeDir: home, yes: true });
    const after = await detectAgentMcpRegistration({ client, homeDir: home });
    assert.equal(after.connected, true);
    assert.equal(after.state, "connected");
  }
});

test("health states: missing file, missing entry, unparseable", async (t) => {
  const { home } = await tempHome(t);
  for (const client of ["claude-code", "codex"]) {
    const none = await detectAgentMcpRegistration({ client, homeDir: home });
    assert.equal(none.state, "not_connected");
    assert.equal(none.connected, false);
  }
  await writeFile(join(home, ".claude.json"), "{ nope");
  const broken = await detectAgentMcpRegistration({ client: "claude-code", homeDir: home });
  assert.equal(broken.state, "error");
  assert.match(broken.detail, /unparseable|parse/i);
});

test("--bind rejects '/', the home dir, relative and missing paths; nothing is written", async (t) => {
  const { home, root } = await tempHome(t);
  const file = join(root, "afile");
  await writeFile(file, "x");
  for (const bind of ["/", home, "relative/dir", ".", join(root, "missing"), file, ""]) {
    for (const client of ["claude-code", "codex"]) {
      await assert.rejects(
        run({ client, homeDir: home, yes: true, bind }),
        (error) => error.code === "bind_rejected",
        `${client} ${JSON.stringify(bind)}`
      );
    }
  }
  assert.deepEqual(await readdir(home), []);
});

test("--bind writes --workspace-bound with the canonical (realpath) project root", async (t) => {
  const { home, root } = await tempHome(t);
  const project = join(root, "project");
  await mkdir(project);
  const link = join(root, "project-link");
  await symlink(project, link);

  await run({ client: "claude-code", homeDir: home, yes: true, bind: link });
  const claude = JSON.parse(await readFile(join(home, ".claude.json"), "utf8")).mcpServers.kairo;
  assert.deepEqual(claude.args, ["mcp", "--workspace-bound", "--cwd", project]);

  await run({ client: "codex", homeDir: home, yes: true, bind: link });
  const toml = await readFile(join(home, ".codex", "config.toml"), "utf8");
  assert.ok(toml.includes(`args = ["mcp", "--workspace-bound", "--cwd", ${JSON.stringify(project)}]`));
  assert.ok(toml.includes(`cwd = ${JSON.stringify(project)}`));

  for (const client of ["claude-code", "codex"]) {
    const health = await detectAgentMcpRegistration({ client, homeDir: home });
    assert.equal(health.state, "connected");
    assert.equal(health.bound, true);
  }
});

test("a bound entry is never produced implicitly from the process cwd", async (t) => {
  const { home, root } = await tempHome(t);
  const project = join(root, "project");
  await mkdir(project);
  const previous = process.cwd();
  process.chdir(project);
  t.after(() => process.chdir(previous));
  await run({ client: "claude-code", homeDir: home, yes: true });
  await run({ client: "codex", homeDir: home, yes: true });
  assert.equal((await readFile(join(home, ".claude.json"), "utf8")).includes("--workspace-bound"), false);
  assert.equal((await readFile(join(home, ".codex", "config.toml"), "utf8")).includes("--workspace-bound"), false);
});

test("claude-code project scope writes <project>/.mcp.json only, and only with --bind", async (t) => {
  const { home, root } = await tempHome(t);
  const project = join(root, "project");
  await mkdir(project);
  await assert.rejects(
    run({ client: "claude-code", homeDir: home, yes: true, projectScope: true }),
    (error) => error.code === "bind_required"
  );
  await assert.rejects(
    run({ client: "codex", homeDir: home, yes: true, projectScope: true, bind: project }),
    (error) => error.code === "scope_unsupported"
  );
  assert.deepEqual(await readdir(home), []);

  const receipt = await run({
    client: "claude-code", homeDir: home, yes: true, projectScope: true, bind: project
  });
  assert.equal(receipt.scope, "project");
  const written = JSON.parse(await readFile(join(project, ".mcp.json"), "utf8"));
  assert.deepEqual(written.mcpServers.kairo.args, ["mcp", "--workspace-bound", "--cwd", project]);
  assert.deepEqual(await readdir(home), []);
  assert.deepEqual((await readdir(project)).sort(), [".mcp.json"]);
});

test("cursor path is unchanged and rejects --bind", async (t) => {
  const { home, root } = await tempHome(t);
  const project = join(root, "project");
  await mkdir(project);
  await assert.rejects(
    run({ client: "cursor", homeDir: home, yes: true, bind: project }),
    (error) => error.code === "bind_unsupported"
  );
  await assert.rejects(
    run({ client: "nope", homeDir: home }),
    /Unsupported MCP client/
  );
});

test("CLI parses --client claude-code|codex, --bind and --project-scope", () => {
  const parsed = parseArgs(["mcp", "install", "--client", "codex", "--bind", "/abs/p", "--yes"]);
  assert.equal(parsed.options.mcpAction, "install");
  assert.equal(parsed.options.mcpClient, "codex");
  assert.equal(parsed.options.mcpBind, "/abs/p");
  assert.equal(parsed.options.yes, true);
  const scoped = parseArgs(["mcp", "install", "--client=claude-code", "--bind=/abs/p", "--project-scope"]);
  assert.equal(scoped.options.mcpClient, "claude-code");
  assert.equal(scoped.options.mcpBind, "/abs/p");
  assert.equal(scoped.options.mcpProjectScope, true);
  const relative = parseArgs(["mcp", "install", "--client", "codex", "--bind", "rel"]);
  assert.equal(relative.options.mcpBind, "rel");
});
