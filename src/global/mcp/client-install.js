/**
 * Plan/apply Kairo MCP registration for Claude Code and Codex.
 * Same discipline as the Cursor installer: plan by default, `--yes` applies, timestamped
 * backup before any write, atomic write, idempotent, refuses unparseable config.
 * The entry always launches the same `kairo mcp` server (same shared operations).
 */
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { writeAtomicText } from "../runtime/write-atomic-json.js";
import { canonicalizeProjectPath } from "../next/project-key.js";
import { printJson } from "../json-output.js";
import { commandHeader } from "../brand/index.js";
import { formatCliCommand } from "../brand/cli.js";
import { resolveHomeDir } from "../paths.js";
import { MCP_CLIENTS, resolveMcpConfigPath } from "../connections.js";
import { McpInstallError, displayPath, planClientConfig } from "./client-config.js";

function reject(message) {
  return new McpInstallError("bind_rejected", message);
}

/**
 * Validate an explicit project to bind: absolute, existing directory, canonical (realpath),
 * never `/` and never the home directory. Never derived from the process cwd.
 */
export async function resolveBindRoot(bind, { homeDir, statFn = stat } = {}) {
  if (typeof bind !== "string" || !bind.trim() || !isAbsolute(bind)) {
    throw reject("--bind requires an absolute project path.");
  }
  const canonical = canonicalizeProjectPath(bind);
  let info;
  try {
    info = await statFn(canonical);
  } catch {
    throw reject("--bind path does not exist.");
  }
  if (!info.isDirectory()) throw reject("--bind path is not a directory.");
  const forbidden = new Set(["/", canonicalizeProjectPath(homeDir), canonicalizeProjectPath(homedir())]);
  if (forbidden.has(canonical)) throw reject("--bind refuses '/' and the home directory; pick one project.");
  return canonical;
}

function backupPath(path, stamp) {
  return `${path}.kairo-backup.${stamp}`;
}

async function readText(path, readFileFn) {
  try {
    return await readFileFn(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function runClientMcpInstall({
  client,
  yes = false,
  json = false,
  quiet = false,
  bind,
  projectScope = false,
  homeDir = resolveHomeDir(),
  readFileFn = readFile,
  mkdirFn = mkdir,
  copyFileFn = copyFile,
  writeAtomicTextFn = writeAtomicText,
  now = () => Date.now()
} = {}) {
  if (projectScope && client !== "claude-code") {
    throw new McpInstallError("scope_unsupported", `--project-scope is only available for claude-code (got ${client}).`);
  }
  if (projectScope && bind == null) {
    throw new McpInstallError("bind_required", "--project-scope writes .mcp.json inside one project: pass --bind <absolute project path>.");
  }
  const bindRoot = bind == null ? null : await resolveBindRoot(bind, { homeDir });

  const path = projectScope
    ? join(bindRoot, ".mcp.json")
    : resolveMcpConfigPath(client, { homeDir });
  const text = await readText(path, readFileFn);
  const plan = planClientConfig({ client, text, bindRoot });
  const shown = displayPath(path, homeDir);
  const scope = projectScope ? "project" : "user";
  const stamp = now();

  if (!yes) {
    const applyWith = formatCliCommand(
      `mcp install --client ${client}${bindRoot ? ` --bind ${displayPath(bindRoot, homeDir)}` : ""}${projectScope ? " --project-scope" : ""} --yes`
    );
    const payload = {
      ok: true,
      applied: false,
      plan: {
        client,
        scope,
        path: shown,
        state: plan.state,
        wouldWrite: plan.changed,
        backupPath: text != null && plan.changed ? displayPath(backupPath(path, stamp), homeDir) : null,
        entry: plan.entry,
        preserved: plan.preserved,
        note: noteFor(client, plan, shown, bindRoot),
        applyWith
      }
    };
    if (json) {
      if (!quiet) printJson(payload);
    } else if (!quiet) {
      console.log(commandHeader("MCP install"));
      console.log(`Client · ${MCP_CLIENTS[client].label} (${scope} scope)`);
      console.log(`Path · ${shown}`);
      console.log(`Entry · ${JSON.stringify(plan.entry)}`);
      console.log(`Status · ${plan.state}${plan.changed ? " (will write)" : " (up to date)"}`);
      console.log(`Preserved · ${JSON.stringify(plan.preserved)}`);
      console.log(payload.plan.note);
      console.log(`Apply · ${applyWith}`);
    }
    return payload;
  }

  let backup = null;
  if (plan.changed) {
    await mkdirFn(dirname(path), { recursive: true });
    if (text != null) {
      backup = backupPath(path, stamp);
      await copyFileFn(path, backup);
    }
    await writeAtomicTextFn(path, plan.nextText);
  }
  const receipt = {
    ok: true,
    applied: true,
    client,
    scope,
    path: shown,
    wrote: plan.changed,
    backupPath: backup ? displayPath(backup, homeDir) : null,
    entry: plan.entry,
    note: `Restart ${MCP_CLIENTS[client].label} to load the kairo_* tools.`
  };
  if (json) {
    if (!quiet) printJson(receipt);
  } else if (!quiet) {
    console.log(commandHeader("MCP install"));
    console.log(plan.changed ? `Wrote · ${shown}` : `MCP · up to date (${shown})`);
    if (receipt.backupPath) console.log(`Backup · ${receipt.backupPath}`);
    console.log(receipt.note);
  }
  return receipt;
}

function noteFor(client, plan, shown, bindRoot) {
  const label = MCP_CLIENTS[client].label;
  if (!plan.changed) return `Kairo MCP already registered for ${label}; nothing to write.`;
  const mode = bindRoot
    ? "bound to one explicit project (write tools enabled; fails closed if the client launches it elsewhere)"
    : "read-only (no workspace binding)";
  return `Will register kairo in ${shown} as ${mode}. Nothing is written without --yes.`;
}
