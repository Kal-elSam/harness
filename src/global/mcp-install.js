/**
 * Register Kairo as an MCP server in a client config (Cursor v1).
 * Consent-gated: plan by default, --yes applies. Atomic write + backup.
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { writeAtomicJson } from "./runtime/write-atomic-json.js";
import {
  MCP_CLIENTS,
  detectAgentMcpRegistration,
  resolveMcpConfigPath
} from "./connections.js";
import { printJson } from "./json-output.js";
import { commandHeader } from "./brand/index.js";
import { formatCliCommand } from "./brand/cli.js";

export const KAIRO_MCP_SERVER_ENTRY = Object.freeze({
  command: "kairo",
  args: Object.freeze(["mcp"])
});

function backupPath(configPath, stamp = Date.now()) {
  return `${configPath}.kairo-backup.${stamp}`;
}

export function buildMcpInstallPlan({
  client = "cursor",
  homeDir = homedir(),
  existing = null,
  alreadyConnected = false
} = {}) {
  const clientMeta = MCP_CLIENTS[client] ?? MCP_CLIENTS.cursor;
  const path = resolveMcpConfigPath(client, { homeDir });
  const next = {
    ...(existing && typeof existing === "object" ? existing : {}),
    mcpServers: {
      ...((existing && typeof existing === "object" && existing.mcpServers) || {}),
      kairo: { command: KAIRO_MCP_SERVER_ENTRY.command, args: [...KAIRO_MCP_SERVER_ENTRY.args] }
    }
  };
  return {
    client: clientMeta.id,
    clientLabel: clientMeta.label,
    path,
    alreadyConnected,
    wouldWrite: !alreadyConnected || JSON.stringify(existing?.mcpServers?.kairo)
      !== JSON.stringify(next.mcpServers.kairo),
    entry: next.mcpServers.kairo,
    next,
    backupPath: backupPath(path),
    note: alreadyConnected
      ? "Kairo MCP already registered; --yes rewrites the entry if it drifted."
      : `Will add mcpServers.kairo to ${path}. Reload Cursor MCP after apply.`
  };
}

async function readExistingConfig(path, readFileFn) {
  try {
    const raw = await readFileFn(path, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Plan (default) or apply (--yes) Cursor MCP registration for Kairo.
 */
export async function runMcpInstall({
  client = "cursor",
  yes = false,
  json = false,
  homeDir = homedir(),
  readFileFn = readFile,
  mkdirFn = mkdir,
  copyFileFn = copyFile,
  writeAtomicJsonFn = writeAtomicJson,
  detectAgent = detectAgentMcpRegistration,
  now = () => Date.now()
} = {}) {
  if (client !== "cursor") {
    throw new Error(
      `Unsupported MCP client "${client}". v1 supports --client=cursor only.`
    );
  }

  const detection = await detectAgent({ client, homeDir, readFileFn });
  const path = detection.path ?? resolveMcpConfigPath(client, { homeDir });
  const existing = await readExistingConfig(path, readFileFn);
  const plan = buildMcpInstallPlan({
    client,
    homeDir,
    existing,
    alreadyConnected: detection.connected === true
  });
  plan.backupPath = backupPath(path, now());

  if (!yes) {
    const payload = {
      ok: true,
      applied: false,
      plan: {
        path: plan.path,
        client: plan.client,
        alreadyConnected: plan.alreadyConnected,
        wouldWrite: plan.wouldWrite,
        entry: plan.entry,
        note: plan.note,
        applyWith: formatCliCommand("mcp install --yes")
      }
    };
    if (json) {
      printJson(payload);
    } else {
      console.log(commandHeader("MCP install"));
      console.log(`Client · ${plan.clientLabel}`);
      console.log(`Path · ${plan.path}`);
      console.log(`Entry · ${JSON.stringify(plan.entry)}`);
      console.log(plan.note);
      console.log(`Apply · ${formatCliCommand("mcp install --yes")}`);
    }
    return payload;
  }

  await mkdirFn(dirname(path), { recursive: true });
  if (existing != null) {
    await copyFileFn(path, plan.backupPath);
  }

  await writeAtomicJsonFn(path, plan.next);

  const receipt = {
    ok: true,
    applied: true,
    path,
    backupPath: existing != null ? plan.backupPath : null,
    entry: plan.entry,
    client: plan.client,
    note: "Reload Cursor MCP (Command Palette → MCP: Restart) to load kairo_* tools."
  };

  if (json) {
    printJson(receipt);
  } else {
    console.log(commandHeader("MCP install"));
    console.log(`Wrote · ${path}`);
    if (receipt.backupPath) console.log(`Backup · ${receipt.backupPath}`);
    console.log(receipt.note);
  }
  return receipt;
}

export async function runMcpCli(options = {}) {
  const action = options.mcpAction ?? "serve";
  if (action === "install") {
    return runMcpInstall({
      client: options.mcpClient ?? "cursor",
      yes: options.yes === true,
      json: options.json === true,
      homeDir: options.homeDir
    });
  }
  if (action === "serve" || action == null) {
    const { runKairoMcp } = await import("./mcp/kairo-mcp.js");
    return runKairoMcp({
      cwd: options.cwd,
      packageRoot: options.packageRoot,
      packageName: options.packageName,
      version: options.version
    });
  }
  throw new Error(
    `Unknown mcp action "${action}". Use: ${formatCliCommand("mcp")} or ${formatCliCommand("mcp install [--yes]")}`
  );
}
