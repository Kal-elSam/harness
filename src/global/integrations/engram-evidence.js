import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { probeCommand } from "../cli-probe.js";

export const KAIRO_ENGRAM_AGENT_IDS = Object.freeze(["cursor", "codex", "opencode", "claude", "pi"]);
export const ENGRAM_SETUP_SLUG_BY_AGENT = Object.freeze({
  cursor: "cursor",
  codex: "codex",
  opencode: "opencode",
  claude: "claude-code",
  pi: "pi"
});
export const ENGRAM_MIN_VERSION = "1.19.0";
export const ENGRAM_MAX_MAJOR = 2;
export const ENGRAM_INTEGRATION_STATUS = Object.freeze({
  MISSING: "missing",
  UNSUPPORTED: "unsupported",
  AVAILABLE: "available",
  UNCONFIGURED: "unconfigured",
  CONFIGURED: "configured",
  CONFLICT: "conflict",
  RESTART_REQUIRED: "restart_required"
});

export function engramSetupSlugForAgent(agentId) {
  const slug = ENGRAM_SETUP_SLUG_BY_AGENT[agentId];
  if (!slug) {
    throw new Error(`Agent "${agentId}" is not managed for Engram setup. Use: ${KAIRO_ENGRAM_AGENT_IDS.join(", ")}.`);
  }
  return slug;
}

export function resolveEngramAgentSelection({
  requestedIds = null,
  detectedIds = [],
  managedIds = KAIRO_ENGRAM_AGENT_IDS
} = {}) {
  const managed = [...managedIds];
  if (requestedIds == null) {
    const detected = new Set(detectedIds);
    return managed.filter((id) => detected.has(id));
  }
  if (requestedIds.length === 1 && requestedIds[0] === "all") return [...managed];
  return requestedIds.map((id) => {
    if (!managed.includes(id)) {
      throw new Error(`Agent "${id}" is not managed for Engram setup. Use: ${managed.join(", ")}.`);
    }
    return id;
  });
}

export function parseEngramVersion(output) {
  const text = String(output ?? "");
  const labeled = text.match(/\bengram\s+v?(\d+\.\d+\.\d+)\b/i);
  if (labeled) return labeled[1];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    if (/update available/i.test(line)) continue;
    const match = line.match(/^v?(\d+\.\d+\.\d+)\b/);
    if (match) return match[1];
  }
  return null;
}

export function classifyEngramVersion(version) {
  const parsed = parseSemver(version);
  const range = `>=${ENGRAM_MIN_VERSION} <${ENGRAM_MAX_MAJOR}.0.0`;
  if (!parsed) {
    return unsupported(`Unable to parse Engram version "${version}". Supported range: ${range}.`);
  }
  if (parsed.major >= ENGRAM_MAX_MAJOR || parsed.major < 1) {
    return unsupported(`Engram ${version} is outside the supported major range (${range}).`);
  }
  if (compareSemver(parsed, parseSemver(ENGRAM_MIN_VERSION)) < 0) {
    return unsupported(
      `Engram ${version} is below the supported baseline ${ENGRAM_MIN_VERSION}. Upgrade Engram manually (Kairo will not update it).`
    );
  }
  return { status: ENGRAM_INTEGRATION_STATUS.AVAILABLE, supported: true, guidance: null };
}

export function inspectEngramBinary({ env = process.env, probe = probeCommand, whichCommand = defaultWhich } = {}) {
  const path = whichCommand("engram", env) || null;
  if (!path) {
    return {
      path: null,
      version: null,
      status: ENGRAM_INTEGRATION_STATUS.MISSING,
      supported: false,
      guidance: "Engram binary not found in PATH. Install Engram separately, then re-run configure."
    };
  }
  const result = probe(path, ["version"], { env, timeoutMs: 5000 });
  const version = parseEngramVersion(`${result.stdout}\n${result.stderr}`);
  if (!version) {
    return {
      path,
      version: null,
      status: ENGRAM_INTEGRATION_STATUS.UNSUPPORTED,
      supported: false,
      guidance: "Engram binary found but `engram version` did not return a parseable version."
    };
  }
  const classified = classifyEngramVersion(version);
  return { path, version, status: classified.status, supported: classified.supported, guidance: classified.guidance };
}

export function inspectEngramAgentConfig(agentId, { homeDir = homedir() } = {}) {
  const slug = engramSetupSlugForAgent(agentId);
  const evidence = collectAgentEvidence(agentId, homeDir);
  const conflicts = evidence.filter((item) => item.conflict);
  let status = ENGRAM_INTEGRATION_STATUS.UNCONFIGURED;
  if (conflicts.length > 0) status = ENGRAM_INTEGRATION_STATUS.CONFLICT;
  else if (isEngramAgentConfigured(agentId, evidence)) {
    status = ENGRAM_INTEGRATION_STATUS.CONFIGURED;
  }
  return { id: agentId, slug, status, evidence };
}

export function inspectEngramIntegration({
  env = process.env,
  homeDir = homedir(),
  agentIds = KAIRO_ENGRAM_AGENT_IDS,
  probe = probeCommand,
  whichCommand = defaultWhich
} = {}) {
  const binary = inspectEngramBinary({ env, probe, whichCommand });
  const agents = agentIds.map((id) => inspectEngramAgentConfig(id, { homeDir }));
  let status = binary.status;
  if (binary.supported) {
    if (agents.some((a) => a.status === ENGRAM_INTEGRATION_STATUS.CONFLICT)) {
      status = ENGRAM_INTEGRATION_STATUS.CONFLICT;
    } else if (agents.every((a) => a.status === ENGRAM_INTEGRATION_STATUS.CONFIGURED)) {
      status = ENGRAM_INTEGRATION_STATUS.CONFIGURED;
    } else if (agents.some((a) => a.status === ENGRAM_INTEGRATION_STATUS.CONFIGURED)) {
      status = ENGRAM_INTEGRATION_STATUS.AVAILABLE;
    } else {
      status = ENGRAM_INTEGRATION_STATUS.UNCONFIGURED;
    }
  }
  return { provider: "engram", status, binary, agents, doctorInvoked: false };
}

function collectAgentEvidence(agentId, homeDir) {
  if (agentId === "claude") {
    return [
      fileEvidence(join(homeDir, ".claude", "mcp", "engram.json"), "mcp"),
      jsonKeyEvidence(join(homeDir, ".claude", "settings.json"), ["mcpServers", "engram"], "mcp")
    ];
  }
  if (agentId === "codex") {
    return [
      tomlSectionEvidence(join(homeDir, ".codex", "config.toml"), "mcp_servers.engram", "mcp"),
      fileEvidence(join(homeDir, ".codex", "engram-instructions.md"), "protocol")
    ];
  }
  if (agentId === "opencode") {
    return [
      jsonKeyEvidence(join(homeDir, ".config", "opencode", "opencode.json"), ["mcp", "engram"], "mcp"),
      fileEvidence(join(homeDir, ".config", "opencode", "plugins", "engram.ts"), "plugin")
    ];
  }
  if (agentId === "cursor") {
    return [
      jsonKeyEvidence(join(homeDir, ".cursor", "mcp.json"), ["mcpServers", "engram"], "mcp"),
      fileEvidence(join(homeDir, ".cursor", "rules", "engram.mdc"), "protocol")
    ];
  }
  if (agentId === "pi") {
    return [
      piSettingsPackagesEvidence(join(homeDir, ".pi", "agent", "settings.json")),
      jsonKeyEvidence(join(homeDir, ".pi", "agent", "mcp.json"), ["mcpServers", "engram"], "mcp")
    ];
  }
  throw new Error(`Unsupported Engram agent "${agentId}".`);
}

function isEngramAgentConfigured(agentId, evidence) {
  if (agentId === "pi") {
    return evidence.length > 0 && evidence.every((item) => item.present && !item.conflict);
  }
  return evidence.some((item) => item.present && item.kind === "mcp");
}

function piSettingsPackagesEvidence(path) {
  const required = ["npm:gentle-engram", "npm:pi-mcp-adapter"];
  if (!existsSync(path)) {
    return { path, kind: "settings", present: false, conflict: false, required };
  }
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (data == null || typeof data !== "object" || Array.isArray(data)) {
      return { path, kind: "settings", present: false, conflict: true, required, detail: "invalid structure" };
    }
    const packages = Array.isArray(data.packages) ? data.packages : null;
    if (packages == null) {
      return { path, kind: "settings", present: false, conflict: true, required, detail: "invalid structure" };
    }
    const normalized = packages.map((entry) => String(entry));
    const present = required.every((req) =>
      normalized.some((entry) => entry === req || entry.startsWith(`${req}@`))
    );
    return { path, kind: "settings", present, conflict: false, required };
  } catch {
    return { path, kind: "settings", present: false, conflict: true, required, detail: "unreadable json" };
  }
}

function fileEvidence(path, kind) {
  return { path, kind, present: existsSync(path), conflict: false };
}

function jsonKeyEvidence(path, keyPath, kind) {
  if (!existsSync(path)) return { path, kind, present: false, conflict: false, keyPath };
  try {
    let cursor = JSON.parse(readFileSync(path, "utf8"));
    for (const key of keyPath) {
      if (cursor == null || typeof cursor !== "object") {
        return { path, kind, present: false, conflict: true, keyPath, detail: "invalid structure" };
      }
      cursor = cursor[key];
    }
    return { path, kind, present: cursor != null && typeof cursor === "object", conflict: false, keyPath };
  } catch {
    return { path, kind, present: false, conflict: true, keyPath, detail: "unreadable json" };
  }
}

function tomlSectionEvidence(path, section, kind) {
  if (!existsSync(path)) return { path, kind, present: false, conflict: false, section };
  try {
    const text = readFileSync(path, "utf8");
    const present = new RegExp(`\\[\\s*${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\]`).test(text);
    return { path, kind, present, conflict: false, section };
  } catch {
    return { path, kind, present: false, conflict: true, section, detail: "unreadable toml" };
  }
}

function unsupported(guidance) {
  return { status: ENGRAM_INTEGRATION_STATUS.UNSUPPORTED, supported: false, guidance };
}

function parseSemver(version) {
  const match = String(version ?? "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

function compareSemver(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function defaultWhich(command, env) {
  const result = probeCommand("which", [command], { env, timeoutMs: 3000 });
  return result.ok ? result.stdout.trim() : null;
}
