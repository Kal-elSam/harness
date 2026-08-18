/**
 * VSIX write MCP: publish only. Global/unbound reads stay on `kairo mcp`.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  createPublishWorkSnapshotHandler,
  workSnapshotPublishSchema
} from "./work-snapshot-tool.js";
import {
  WORKSPACE_BINDING_CODES,
  resolveWorkspaceWriteBinding
} from "./workspace-binding.js";

export function parseWorkspaceMcpArgv(argv = []) {
  const args = [...argv];
  if (args[0] === "mcp") args.shift();
  let workspaceBound = false;
  let cwd;
  let cwdExplicit = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--workspace-bound") workspaceBound = true;
    else if (args[i] === "--cwd") {
      cwd = args[++i];
      cwdExplicit = true;
    }
  }
  return { workspaceBound, cwd, cwdExplicit };
}

function mcpResult({ ok, code, data = null, diagnostics = [], isError = false }) {
  const structuredContent = { ok, code, data, diagnostics };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent, ...(isError ? { isError: true } : {})
  };
}

export function startWorkspaceMcp(argv = process.argv.slice(2), deps = {}) {
  const parsed = parseWorkspaceMcpArgv(argv);
  const merged = { ...deps, ...parsed };
  const binding = resolveWorkspaceWriteBinding({
    workspaceBound: merged.workspaceBound === true,
    cwdExplicit: merged.cwdExplicit === true,
    cwd: merged.cwd,
    processCwd: merged.processCwd ?? process.cwd(),
    userHome: merged.userHome,
    env: merged.env ?? process.env
  });
  const publish = createPublishWorkSnapshotHandler({
    homeDir: merged.homeDir, cwd: binding.cwd, now: merged.now,
    writeAtomic: merged.writeAtomic, publishWorkSnapshot: merged.publishWorkSnapshot,
    mcpResult
  });
  const serve = deps.serveStdio ?? serveStdio;
  return serve(() => {
    const server = new (deps.McpServer ?? McpServer)({ name: "kairo-workspace", version: "0.8.0" });
    const register = deps.registerTool ?? ((name, config, handler) => server.registerTool(name, config, handler));
    register("kairo_publish_work_snapshot", {
      description: "Publish kairo.work-snapshot/v1 for the runtime workspace (enrolls conversation)",
      inputSchema: workSnapshotPublishSchema
    }, async (args = {}) => {
      if (!binding.writable) {
        const code = binding.code ?? WORKSPACE_BINDING_CODES.UNBOUND;
        return mcpResult({ ok: false, code, data: null, diagnostics: [code], isError: true });
      }
      return publish(args);
    });
    return server;
  });
}

const invoked = process.argv[1] ?? "";
if (/(?:kairo-workspace\.cjs|workspace-mcp-entry\.js)$/.test(invoked)) void startWorkspaceMcp();
