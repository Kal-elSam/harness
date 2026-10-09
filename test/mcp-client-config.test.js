/**
 * Pure config logic for Kairo MCP entries in Claude Code (JSON) and Codex (TOML).
 *
 * Format assumptions (verified against upstream docs/sources, no network used here):
 * - Claude Code: user scope = `mcpServers` object in `~/.claude.json`; project scope =
 *   `mcpServers` in `<project>/.mcp.json`; stdio entry `{ type, command, args }`.
 * - Codex: `~/.codex/config.toml` with `[mcp_servers.<name>]` tables carrying
 *   `command`, `args`, optional `cwd` and `[mcp_servers.<name>.env]`.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  McpInstallError,
  buildClientEntry,
  inspectClientConfigText,
  planClientConfig
} from "../src/global/mcp/client-config.js";

const BLOCK = '[mcp_servers.kairo]\ncommand = "kairo"\nargs = ["mcp"]\n';

test("read-only entries carry no workspace binding for any client", () => {
  for (const client of ["claude-code", "codex"]) {
    const entry = buildClientEntry(client);
    assert.equal(entry.command, "kairo");
    assert.deepEqual(entry.args, ["mcp"]);
    assert.equal(JSON.stringify(entry).includes("--workspace-bound"), false);
    assert.equal("cwd" in entry, false);
  }
});

test("bound entries carry --workspace-bound and the explicit canonical root", () => {
  const claude = buildClientEntry("claude-code", { bindRoot: "/work/app" });
  assert.deepEqual(claude.args, ["mcp", "--workspace-bound", "--cwd", "/work/app"]);
  const codex = buildClientEntry("codex", { bindRoot: "/work/app" });
  assert.deepEqual(codex.args, ["mcp", "--workspace-bound", "--cwd", "/work/app"]);
  assert.equal(codex.cwd, "/work/app");
});

test("json plan: preserves unrelated keys and servers, adds only mcpServers.kairo", () => {
  const original = JSON.stringify({
    numStartups: 3,
    projects: { "/a": { allowedTools: [] } },
    mcpServers: { other: { command: "x", args: ["y"] } }
  }, null, 2);
  const plan = planClientConfig({ client: "claude-code", text: original });
  assert.equal(plan.changed, true);
  const next = JSON.parse(plan.nextText);
  assert.equal(next.numStartups, 3);
  assert.deepEqual(next.projects, { "/a": { allowedTools: [] } });
  assert.deepEqual(next.mcpServers.other, { command: "x", args: ["y"] });
  assert.equal(next.mcpServers.kairo.command, "kairo");
  assert.deepEqual(plan.preserved.servers, ["other"]);
  assert.ok(plan.preserved.keys.includes("numStartups"));
});

test("json plan: idempotent when entry already matches", () => {
  const first = planClientConfig({ client: "claude-code", text: null });
  const second = planClientConfig({ client: "claude-code", text: first.nextText });
  assert.equal(second.changed, false);
  assert.equal(second.nextText, first.nextText);
});

test("json plan: refuses unparseable, non-object and bad mcpServers shapes", () => {
  for (const text of ["{ nope", "[]", "null", '{"mcpServers":[]}', '{"mcpServers":"x"}']) {
    assert.throws(
      () => planClientConfig({ client: "claude-code", text }),
      (error) => error instanceof McpInstallError && error.code === "config_unparseable",
      text
    );
  }
});

test("toml plan: empty/missing file gets only the kairo table", () => {
  assert.equal(planClientConfig({ client: "codex", text: null }).nextText, BLOCK);
  assert.equal(planClientConfig({ client: "codex", text: "" }).nextText, BLOCK);
});

test("toml plan: append keeps every original byte, comments included", () => {
  const original = [
    "# my codex config",
    'model = "gpt-5"   # keep me',
    "",
    "[mcp_servers.engram]",
    'command = "engram"',
    "args = [",
    '  "mcp",   # inline comment',
    "]",
    ""
  ].join("\n");
  const plan = planClientConfig({ client: "codex", text: original });
  assert.equal(plan.changed, true);
  assert.equal(plan.nextText, `${original}\n${BLOCK}`);
  assert.deepEqual(plan.preserved.servers, ["engram"]);
});

test("toml plan: append adds a newline when the file lacks a trailing one", () => {
  const plan = planClientConfig({ client: "codex", text: 'model = "x"' });
  assert.equal(plan.nextText, `model = "x"\n\n${BLOCK}`);
});

test("toml plan: idempotent re-run is byte-identical and not changed", () => {
  const once = planClientConfig({ client: "codex", text: '# c\nmodel = "x"\n' });
  const twice = planClientConfig({ client: "codex", text: once.nextText });
  assert.equal(twice.changed, false);
  assert.equal(twice.nextText, once.nextText);
});

test("toml plan: drifted table is rewritten, other keys and env subtable are kept", () => {
  const original = [
    '[mcp_servers.first]',
    'command = "first"',
    "",
    "[mcp_servers.kairo]",
    "# my note",
    'command = "old-kairo"',
    'args = ["serve"]',
    "startup_timeout_sec = 20",
    "",
    "[mcp_servers.kairo.env]",
    'FOO = "bar"',
    "",
    "[profiles.x]",
    'model = "y"',
    ""
  ].join("\n");
  const plan = planClientConfig({ client: "codex", text: original });
  assert.equal(plan.changed, true);
  assert.equal(plan.nextText, [
    '[mcp_servers.first]',
    'command = "first"',
    "",
    "[mcp_servers.kairo]",
    'command = "kairo"',
    'args = ["mcp"]',
    "# my note",
    "startup_timeout_sec = 20",
    "",
    "[mcp_servers.kairo.env]",
    'FOO = "bar"',
    "",
    "[profiles.x]",
    'model = "y"',
    ""
  ].join("\n"));
});

test("toml plan: multi-line args array is replaced as one statement", () => {
  const original = '[mcp_servers.kairo]\ncommand = "kairo"\nargs = [\n  "mcp",\n  "--bad",\n]\n';
  const plan = planClientConfig({ client: "codex", text: original });
  assert.equal(plan.nextText, BLOCK);
});

test("toml plan: header-looking text inside multi-line strings is not a header", () => {
  const original = 'notes = """\n[mcp_servers.kairo]\nnot a table\n"""\n';
  const plan = planClientConfig({ client: "codex", text: original });
  assert.equal(plan.nextText, `${original}\n${BLOCK}`);
});

test("toml plan: CRLF files keep their endings on untouched lines", () => {
  const original = 'model = "x"\r\n[other]\r\na = 1\r\n';
  const plan = planClientConfig({ client: "codex", text: original });
  assert.ok(plan.nextText.startsWith(original));
  assert.ok(plan.nextText.includes("[mcp_servers.kairo]\r\n"));
});

test("toml plan: refuses ambiguous or invalid input and never guesses", () => {
  const bad = {
    unterminatedString: 'model = "oops\n',
    unterminatedMultiline: 'a = """\nnever closed\n',
    unbalancedArray: "a = [1, 2\n",
    garbageLine: "this is not toml\n",
    arrayOfTables: "[[mcp_servers.kairo]]\ncommand = 'x'\n",
    duplicateTable: `${BLOCK}\n${BLOCK}`,
    inlineParent: 'mcp_servers = { kairo = { command = "x" } }\n',
    dottedRoot: 'mcp_servers.kairo.command = "x"\n',
    dottedInParent: '[mcp_servers]\nkairo = { command = "x" }\n'
  };
  for (const [name, text] of Object.entries(bad)) {
    assert.throws(
      () => planClientConfig({ client: "codex", text }),
      (error) => error instanceof McpInstallError && error.code === "config_unparseable",
      name
    );
  }
});

test("inspect: reports ok / missing / drifted / unparseable for both clients", () => {
  const claudeOk = planClientConfig({ client: "claude-code", text: null }).nextText;
  assert.equal(inspectClientConfigText("claude-code", claudeOk).state, "ok");
  assert.equal(inspectClientConfigText("claude-code", null).state, "missing");
  assert.equal(inspectClientConfigText("claude-code", '{"mcpServers":{}}').state, "missing");
  assert.equal(
    inspectClientConfigText("claude-code", '{"mcpServers":{"kairo":{"command":"kairo","args":["mcp","--bogus"]}}}').state,
    "drifted"
  );
  assert.equal(inspectClientConfigText("claude-code", "{ nope").state, "unparseable");

  const codexOk = planClientConfig({ client: "codex", text: null }).nextText;
  assert.equal(inspectClientConfigText("codex", codexOk).state, "ok");
  assert.equal(inspectClientConfigText("codex", 'model = "x"\n').state, "missing");
  assert.equal(
    inspectClientConfigText("codex", '[mcp_servers.kairo]\ncommand = "node"\nargs = ["mcp"]\n').state,
    "drifted"
  );
  assert.equal(inspectClientConfigText("codex", 'a = "oops\n').state, "unparseable");
});

test("inspect: bound entries are ok and expose the bound root; relative roots drift", () => {
  const text = planClientConfig({ client: "codex", text: null, bindRoot: "/work/app" }).nextText;
  const result = inspectClientConfigText("codex", text);
  assert.equal(result.state, "ok");
  assert.equal(result.bound, true);
  assert.equal(result.boundTo, "/work/app");
  const relative = '[mcp_servers.kairo]\ncommand = "kairo"\nargs = ["mcp", "--workspace-bound", "--cwd", "rel"]\n';
  assert.equal(inspectClientConfigText("codex", relative).state, "drifted");
});

// ---- /code-review findings on integration tip ----

test("json plan: rebinding keeps user-added keys on the existing kairo entry (env, timeout)", () => {
  const text = JSON.stringify({
    mcpServers: { kairo: { type: "stdio", command: "kairo", args: ["mcp"], env: { KAIRO_HOME: "/x" }, timeout: 5 } }
  });
  const plan = planClientConfig({ client: "claude-code", text, bindRoot: "/work/app" });
  assert.equal(plan.changed, true);
  const entry = JSON.parse(plan.nextText).mcpServers.kairo;
  assert.deepEqual(entry.args, ["mcp", "--workspace-bound", "--cwd", "/work/app"]);
  assert.deepEqual(entry.env, { KAIRO_HOME: "/x" });
  assert.equal(entry.timeout, 5);
  assert.equal(entry.type, "stdio");
});

test("json plan: a managed key always wins over the stale value on disk", () => {
  const text = JSON.stringify({ mcpServers: { kairo: { type: "stdio", command: "other", args: ["x"], env: { A: "1" } } } });
  const entry = JSON.parse(planClientConfig({ client: "claude-code", text }).nextText).mcpServers.kairo;
  assert.deepEqual({ type: entry.type, command: entry.command, args: entry.args }, { type: "stdio", command: "kairo", args: ["mcp"] });
  assert.deepEqual(entry.env, { A: "1" });
});

test("json plan: an entry of another transport is replaced whole, its url and headers do not leak into the stdio entry", () => {
  const text = JSON.stringify({ mcpServers: { kairo: { type: "http", url: "https://example.test/mcp", headers: { A: "1" } } } });
  const entry = JSON.parse(planClientConfig({ client: "claude-code", text }).nextText).mcpServers.kairo;
  assert.deepEqual(entry, { type: "stdio", command: "kairo", args: ["mcp"] });
});

test("health: a claude-code entry whose type is not stdio is drifted", () => {
  const text = JSON.stringify({ mcpServers: { kairo: { type: "http", command: "kairo", args: ["mcp"] } } });
  assert.equal(inspectClientConfigText("claude-code", text).state, "drifted");
  const ok = JSON.stringify({ mcpServers: { kairo: { type: "stdio", command: "kairo", args: ["mcp"] } } });
  assert.equal(inspectClientConfigText("claude-code", ok).state, "ok");
});

test("health and plan: a codex cwd that cannot be read is drifted and gets rewritten, never treated as absent", () => {
  const text = `${BLOCK}cwd = """\n/some/dir\n"""\n`;
  assert.equal(inspectClientConfigText("codex", text).state, "drifted");
  const plan = planClientConfig({ client: "codex", text });
  assert.equal(plan.changed, true);
  assert.equal(plan.nextText.includes("/some/dir"), false);
  assert.equal(inspectClientConfigText("codex", plan.nextText).state, "ok");
});

test("toml scan: an escaped backslash right before the closing triple quote closes the string", () => {
  const text = `note = """abc\\\\"""\n${BLOCK}`;
  assert.equal(inspectClientConfigText("codex", text).state, "ok");
  const plan = planClientConfig({ client: "codex", text, bindRoot: "/work/app" });
  assert.ok(plan.nextText.startsWith('note = """abc\\\\"""\n'), "the user's multi-line value is kept byte for byte");
});

test("toml scan: an escaped quote inside a multi-line string does not close it early, and a closer at column 0 does close", () => {
  assert.equal(inspectClientConfigText("codex", `note = """a\\"""b"""\n${BLOCK}`).state, "ok");
  assert.equal(inspectClientConfigText("codex", `note = """\nabc\n"""\n${BLOCK}`).state, "ok");
});

test("toml scan: a table header whose quoted key contains a closing bracket is understood", () => {
  const text = `[mcp_servers."a]b"]\ncommand = "x"\n\n${BLOCK}`;
  assert.equal(inspectClientConfigText("codex", text).state, "ok");
});
