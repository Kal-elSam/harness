import cursorManaged from "../adapters/cursor.js";
import codexManaged from "../adapters/codex.js";
import opencodeManaged from "../adapters/opencode.js";
import claudeManaged from "../adapters/claude.js";
import piManaged from "../adapters/pi.js";
import { createAgentCapabilityAdapter } from "./create-capability-adapter.js";

const cursor = createAgentCapabilityAdapter({
  id: "cursor",
  label: "Cursor",
  managedAdapter: cursorManaged,
  executable: "cursor",
  opaqueAuth: true
});

const codex = createAgentCapabilityAdapter({
  id: "codex",
  label: "Codex",
  managedAdapter: codexManaged,
  executable: "codex",
  runExecutable: "codex"
});

const opencode = createAgentCapabilityAdapter({
  id: "opencode",
  label: "OpenCode",
  managedAdapter: opencodeManaged,
  executable: "opencode",
  runExecutable: "opencode"
});

const claude = createAgentCapabilityAdapter({
  id: "claude",
  label: "Claude Code",
  managedAdapter: claudeManaged,
  executable: "claude",
  authArgs: ["auth", "status"],
  runExecutable: "claude"
});

const pi = createAgentCapabilityAdapter({
  id: "pi",
  label: "Pi",
  managedAdapter: piManaged,
  executable: "pi",
  opaqueAuth: true,
  runExecutable: "pi"
});

const CAPABILITY_ADAPTERS = [cursor, codex, opencode, claude, pi];

export const AGENT_CAPABILITY_IDS = CAPABILITY_ADAPTERS.map((adapter) => adapter.id);

export function listCapabilityAdapters() {
  return [...CAPABILITY_ADAPTERS];
}

export function resolveCapabilityAdapter(id) {
  const adapter = CAPABILITY_ADAPTERS.find((candidate) => candidate.id === id);
  if (!adapter) {
    throw new Error(`Unknown agent capability "${id}". Use ${AGENT_CAPABILITY_IDS.join(", ")}.`);
  }
  return adapter;
}
