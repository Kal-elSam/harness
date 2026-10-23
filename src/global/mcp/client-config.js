/**
 * Pure config logic: register/inspect the Kairo MCP entry in Claude Code (JSON) and
 * Codex (TOML). No file IO here (see client-install.js).
 *
 * Format assumptions (from upstream docs/sources; no network used at runtime):
 * - Claude Code: user scope = top-level `mcpServers` object in `~/.claude.json`;
 *   project scope = `mcpServers` in `<project>/.mcp.json`. Stdio entry: `{ type, command, args }`.
 * - Codex: `~/.codex/config.toml`, `[mcp_servers.<name>]` tables with `command`, `args`,
 *   optional `cwd` and a `[mcp_servers.<name>.env]` sub-table.
 *
 * No TOML dependency is declared, so the Codex writer is a minimal section upsert that only
 * rewrites the managed keys (`command`, `args`, `cwd`) of `[mcp_servers.kairo]`, keeps every
 * other line byte-for-byte and refuses (typed error) on anything it cannot classify safely.
 */
import { isDeepStrictEqual } from "node:util";
import { isAbsolute } from "node:path";

export class McpInstallError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "McpInstallError";
    this.code = code;
  }
}

/** Scrub the home dir from a path shown to the user (`~/...`). */
export function displayPath(path, homeDir) {
  if (typeof path !== "string" || !homeDir) return path;
  const home = homeDir.replace(/\/+$/, "");
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export const CLIENT_FORMATS = Object.freeze({
  "claude-code": "json",
  codex: "toml"
});

const SERVER = "kairo";
const MANAGED_KEYS = ["command", "args", "cwd"];

function unparseable(detail) {
  return new McpInstallError("config_unparseable", `Existing config is not safe to edit: ${detail}. Nothing was written.`);
}

export function buildClientEntry(client, { bindRoot = null } = {}) {
  const args = bindRoot ? ["mcp", "--workspace-bound", "--cwd", bindRoot] : ["mcp"];
  if (client === "claude-code") return { type: "stdio", command: "kairo", args };
  if (client === "codex") {
    return bindRoot ? { command: "kairo", args, cwd: bindRoot } : { command: "kairo", args };
  }
  throw new McpInstallError("client_unsupported", `Unsupported MCP client "${client}".`);
}

// ---------- health ----------

function judgeEntry(client, entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { state: "drifted" };
  const { command, args, cwd } = entry;
  if (command !== "kairo" || !Array.isArray(args) || args[0] !== "mcp") return { state: "drifted" };
  // A missing type means stdio for Claude Code; any other transport does not start our server.
  if (client === "claude-code" && entry.type !== undefined && entry.type !== "stdio") return { state: "drifted" };
  if (args.length === 1) {
    const clean = client === "codex" ? cwd === undefined : true;
    return clean ? { state: "ok", bound: false, boundTo: null } : { state: "drifted" };
  }
  const root = args[3];
  const shape = args.length === 4 && args[1] === "--workspace-bound" && args[2] === "--cwd"
    && typeof root === "string" && isAbsolute(root) && root !== "/";
  if (!shape) return { state: "drifted" };
  if (client === "codex" && cwd !== root) return { state: "drifted" };
  return { state: "ok", bound: true, boundTo: root };
}

/** Parsed `kairo` entry from a config text (undefined when absent). Throws McpInstallError if unparseable. */
export function readClientEntry(client, text) {
  const format = CLIENT_FORMATS[client];
  if (!format) throw new McpInstallError("client_unsupported", `Unsupported MCP client "${client}".`);
  if (text == null) return undefined;
  return format === "json" ? readJsonEntry(text) : readTomlEntry(text);
}

export function inspectClientConfigText(client, text) {
  const format = CLIENT_FORMATS[client];
  if (!format) throw new McpInstallError("client_unsupported", `Unsupported MCP client "${client}".`);
  if (text == null) return { state: "missing" };
  let entry;
  try {
    entry = format === "json" ? readJsonEntry(text) : readTomlEntry(text);
  } catch (error) {
    if (error instanceof McpInstallError) return { state: "unparseable", detail: error.message };
    throw error;
  }
  if (entry === undefined) return { state: "missing" };
  return judgeEntry(client, entry);
}

// ---------- JSON ----------

function parseJsonConfig(text) {
  if (text == null) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw unparseable(`invalid JSON (${error.message})`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw unparseable("top level is not an object");
  const servers = parsed.mcpServers;
  if (servers !== undefined && (!servers || typeof servers !== "object" || Array.isArray(servers))) {
    throw unparseable("mcpServers is not an object");
  }
  return parsed;
}

function readJsonEntry(text) {
  return parseJsonConfig(text).mcpServers?.[SERVER];
}

function planJson(text, desired) {
  const config = parseJsonConfig(text);
  const servers = config.mcpServers ?? {};
  const existing = servers[SERVER];
  // Keep user-added keys (env, timeout, ...) of an existing stdio entry; the managed
  // keys always win. An entry of another transport (url/headers) is replaced whole.
  const keepsUserKeys = existing && typeof existing === "object" && !Array.isArray(existing)
    && (existing.type === undefined || existing.type === "stdio");
  const entry = keepsUserKeys ? { ...existing, ...desired } : desired;
  const changed = !isDeepStrictEqual(existing, entry);
  const next = { ...config, mcpServers: { ...servers, [SERVER]: entry } };
  return {
    changed,
    nextText: changed || text == null ? `${JSON.stringify(next, null, 2)}\n` : text,
    preserved: {
      keys: Object.keys(config).filter((key) => key !== "mcpServers"),
      servers: Object.keys(servers).filter((name) => name !== SERVER)
    }
  };
}

// ---------- TOML (minimal, section-scoped) ----------

function splitKeyPath(raw) {
  const segments = [];
  let i = 0;
  while (i < raw.length) {
    while (raw[i] === " " || raw[i] === "\t") i += 1;
    if (i >= raw.length) break;
    let segment;
    if (raw[i] === '"' || raw[i] === "'") {
      const quote = raw[i];
      const end = raw.indexOf(quote, i + 1);
      if (end < 0) return null;
      segment = raw.slice(i + 1, end);
      i = end + 1;
    } else {
      const match = /^[A-Za-z0-9_-]+/.exec(raw.slice(i));
      if (!match) return null;
      segment = match[0];
      i += segment.length;
    }
    segments.push(segment);
    while (raw[i] === " " || raw[i] === "\t") i += 1;
    if (i >= raw.length) break;
    if (raw[i] !== ".") return null;
    i += 1;
  }
  return segments.length > 0 ? segments : null;
}

/** True when the character at `index` is preceded by an odd run of backslashes (i.e. it is escaped). */
function isEscapedAt(line, index) {
  let run = 0;
  for (let i = index - 1; i >= 0 && line[i] === "\\"; i -= 1) run += 1;
  return run % 2 === 1;
}

function endOfBasicString(line, from) {
  for (let i = from; i < line.length; i += 1) {
    if (line[i] === "\\") i += 1;
    else if (line[i] === '"') return i + 1;
  }
  return -1;
}

/** Advance the lexical state across one physical line (strings, comments, brackets). */
function advance(line, state) {
  let i = 0;
  while (i < line.length) {
    if (state.ml) {
      let end = line.indexOf(state.ml, i);
      while (end > 0 && state.ml === '"""' && isEscapedAt(line, end)) end = line.indexOf(state.ml, end + 1);
      if (end < 0) return;
      i = end + 3;
      state.ml = null;
      continue;
    }
    const c = line[i];
    if (c === "#") return;
    if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
      state.ml = line.slice(i, i + 3);
      i += 3;
    } else if (c === '"') {
      const end = endOfBasicString(line, i + 1);
      if (end < 0) throw unparseable("unterminated string");
      i = end;
    } else if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw unparseable("unterminated string");
      i = end + 1;
    } else {
      if (c === "[" || c === "{") state.depth += 1;
      else if (c === "]" || c === "}") state.depth -= 1;
      if (state.depth < 0) throw unparseable("unbalanced brackets");
      i += 1;
    }
  }
}

const HEADER = /^\[(\[)?\s*(.+?)\s*\](\])?\s*(?:#.*)?$/;
const KEY_VALUE = /^((?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*')(?:\s*\.\s*(?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*'))*)\s*=\s*\S/;

/** Classify the text into statements with exact line ranges. */
function scanToml(text) {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const statements = [];
  const state = { ml: null, depth: 0 };
  let table = [];
  let index = 0;
  while (index < lines.length) {
    const raw = lines[index].replace(/\r$/, "");
    const trimmed = raw.trim();
    const start = index;
    let stmt;
    if (trimmed === "") stmt = { kind: "blank" };
    else if (trimmed.startsWith("#")) stmt = { kind: "comment" };
    else if (trimmed.startsWith("[")) {
      const match = HEADER.exec(trimmed);
      const segs = match && splitKeyPath(match[2]);
      if (!match || !segs || Boolean(match[1]) !== Boolean(match[3])) throw unparseable(`invalid table header at line ${start + 1}`);
      stmt = { kind: "header", array: Boolean(match[1]), segs };
      table = segs;
    } else {
      const match = KEY_VALUE.exec(trimmed);
      const segs = match && splitKeyPath(match[1]);
      if (!match || !segs) throw unparseable(`unrecognized line ${start + 1}`);
      stmt = { kind: "kv", segs, table };
    }
    advance(raw, state);
    while ((state.ml || state.depth > 0) && index + 1 < lines.length) {
      index += 1;
      advance(lines[index].replace(/\r$/, ""), state);
    }
    if (state.ml || state.depth !== 0) throw unparseable("unterminated multi-line value");
    statements.push({ ...stmt, start, end: index });
    index += 1;
  }
  return { lines, eol, statements, endsWithNewline: text === "" || text.endsWith("\n") };
}

function isKairoHeader(stmt) {
  return stmt.kind === "header" && !stmt.array && stmt.segs.length === 2
    && stmt.segs[0] === "mcp_servers" && stmt.segs[1] === SERVER;
}

/** Locate the managed table; refuse any shape we cannot edit without guessing. */
function locateSection(scan) {
  const { statements } = scan;
  let headerAt = -1;
  for (let i = 0; i < statements.length; i += 1) {
    const stmt = statements[i];
    if (stmt.kind === "header" && stmt.array && stmt.segs[0] === "mcp_servers") {
      throw unparseable("array-of-tables under mcp_servers is not supported");
    }
    if (stmt.kind === "kv") {
      const full = [...stmt.table, ...stmt.segs];
      if (full[0] === "mcp_servers" && (full.length === 1 || full[1] === SERVER) && stmt.table.length <= 1) {
        throw unparseable("mcp_servers is defined inline or with dotted keys");
      }
    }
    if (isKairoHeader(stmt)) {
      if (headerAt >= 0) throw unparseable("duplicate [mcp_servers.kairo] table");
      headerAt = i;
    }
  }
  if (headerAt < 0) return null;
  let endAt = statements.length;
  for (let i = headerAt + 1; i < statements.length; i += 1) {
    if (statements[i].kind === "header") { endAt = i; break; }
  }
  const managed = {};
  for (let i = headerAt + 1; i < endAt; i += 1) {
    const stmt = statements[i];
    if (stmt.kind === "kv" && stmt.segs.length === 1 && MANAGED_KEYS.includes(stmt.segs[0])) {
      if (managed[stmt.segs[0]]) throw unparseable(`duplicate ${stmt.segs[0]} key`);
      managed[stmt.segs[0]] = stmt;
    }
  }
  return { headerAt, endAt, header: statements[headerAt], managed };
}

/** Minimal value reader: basic/literal strings and arrays of them. Anything else -> undefined. */
function parseValue(source) {
  let i = 0;
  const skip = () => {
    for (;;) {
      while (/\s/.test(source[i] ?? "")) i += 1;
      if (source[i] !== "#") return;
      while (i < source.length && source[i] !== "\n") i += 1;
    }
  };
  const value = () => {
    skip();
    if (source[i] === '"') {
      const end = endOfBasicString(source, i + 1);
      if (end < 0) return undefined;
      try {
        const parsed = JSON.parse(source.slice(i, end));
        i = end;
        return parsed;
      } catch { return undefined; }
    }
    if (source[i] === "'") {
      const end = source.indexOf("'", i + 1);
      if (end < 0) return undefined;
      const parsed = source.slice(i + 1, end);
      i = end + 1;
      return parsed;
    }
    if (source[i] === "[") {
      i += 1;
      const items = [];
      for (;;) {
        skip();
        if (source[i] === "]") { i += 1; return items; }
        const item = value();
        if (typeof item !== "string") return undefined;
        items.push(item);
        skip();
        if (source[i] === ",") i += 1;
        else if (source[i] !== "]") return undefined;
      }
    }
    return undefined;
  };
  const parsed = value();
  if (parsed === undefined) return undefined;
  skip();
  return i >= source.length ? parsed : undefined;
}

function statementValue(scan, stmt) {
  const joined = scan.lines.slice(stmt.start, stmt.end + 1).map((l) => l.replace(/\r$/, "")).join("\n");
  const eq = joined.indexOf("=");
  return parseValue(joined.slice(eq + 1));
}

function readTomlEntry(text) {
  const scan = scanToml(text);
  const section = locateSection(scan);
  if (!section) return undefined;
  const entry = {};
  for (const key of MANAGED_KEYS) {
    const stmt = section.managed[key];
    // Present but not a plain string/array of strings: null, so it never reads as absent.
    if (stmt) entry[key] = statementValue(scan, stmt) ?? null;
  }
  return entry;
}

function renderManaged(entry) {
  const lines = [
    `command = ${JSON.stringify(entry.command)}`,
    `args = [${entry.args.map((arg) => JSON.stringify(arg)).join(", ")}]`
  ];
  if (entry.cwd !== undefined) lines.push(`cwd = ${JSON.stringify(entry.cwd)}`);
  return lines;
}

function planToml(text, desired) {
  const scan = scanToml(text ?? "");
  const section = locateSection(scan);
  const eol = scan.eol;
  const preserved = {
    keys: [],
    servers: scan.statements
      .filter((s) => s.kind === "header" && !s.array && s.segs[0] === "mcp_servers" && s.segs.length === 2 && s.segs[1] !== SERVER)
      .map((s) => s.segs[1])
  };
  preserved.sections = scan.statements
    .filter((s) => s.kind === "header")
    .map((s) => s.segs.join("."))
    .filter((name) => name !== "mcp_servers.kairo");

  const body = renderManaged(desired);
  if (!section) {
    const base = text ?? "";
    let out = base;
    if (out !== "" && !out.endsWith("\n")) out += eol;
    if (out !== "" && !/(\r?\n){2}$/.test(out)) out += eol;
    out += `[mcp_servers.${SERVER}]${eol}${body.join(eol)}${eol}`;
    return { changed: true, nextText: out, preserved };
  }

  const current = {};
  for (const key of MANAGED_KEYS) {
    const stmt = section.managed[key];
    current[key] = stmt ? (statementValue(scan, stmt) ?? null) : undefined;
  }
  if (isDeepStrictEqual(current, { command: desired.command, args: desired.args, cwd: desired.cwd })) {
    return { changed: false, nextText: text, preserved };
  }

  const drop = new Set();
  for (const stmt of Object.values(section.managed)) {
    for (let line = stmt.start; line <= stmt.end; line += 1) drop.add(line);
  }
  const headerEnd = section.header.end;
  const out = [];
  scan.lines.forEach((line, lineIndex) => {
    if (drop.has(lineIndex)) return;
    out.push(line);
    if (lineIndex === headerEnd) body.forEach((b) => out.push(`${b}${eol === "\r\n" ? "\r" : ""}`));
  });
  const joined = out.join("\n") + (scan.endsWithNewline ? "\n" : "");
  return { changed: true, nextText: joined, preserved };
}

// ---------- entry points ----------

export function planClientConfig({ client, text = null, bindRoot = null }) {
  const format = CLIENT_FORMATS[client];
  if (!format) throw new McpInstallError("client_unsupported", `Unsupported MCP client "${client}".`);
  const desired = buildClientEntry(client, { bindRoot });
  const { state } = inspectClientConfigText(client, text);
  const result = format === "json" ? planJson(text, desired) : planToml(text, desired);
  return { client, format, entry: desired, state, ...result };
}
