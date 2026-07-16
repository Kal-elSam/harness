import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { formatCliCommand } from "./brand/cli.js";
import { ensureIntegrationProvidersRegistered } from "./integrations/index.js";
import { requireIntegrationProvider } from "./integrations/provider-registry.js";
import { buildEngramIntegrationChecks } from "./component-integration-cli.js";
import { KAIRO_ENGRAM_AGENT_IDS } from "./integrations/engram-evidence.js";

const GRAPH_REPORT_COMMIT_PATTERN = /Built from commit:\s*`([0-9a-f]+)`/i;

export async function runComponentEcosystemChecks({
  installedComponents,
  workspaceRoot = null,
  homeDir = null
} = {}) {
  const installedIds = new Set(installedComponents.map((component) => component.id));
  const checks = [];

  if (installedIds.has("engram-memory")) {
    checks.push(...await buildEngramChecks({ homeDir }));
  }

  if (installedIds.has("graphify-context")) {
    checks.push(...await buildGraphifyChecks(workspaceRoot));
  }

  return checks;
}

async function buildEngramChecks({ homeDir }) {
  ensureIntegrationProvidersRegistered();
  try {
    const provider = requireIntegrationProvider("engram");
    const inspection = await provider.inspect({
      homeDir: homeDir ?? undefined,
      agentIds: KAIRO_ENGRAM_AGENT_IDS
    });
    return buildEngramIntegrationChecks(inspection);
  } catch (error) {
    return [{
      name: "engram:binary",
      status: "warning",
      category: "integration",
      componentId: "engram-memory",
      detail: error instanceof Error ? error.message : "Engram inspection failed."
    }];
  }
}

async function buildGraphifyChecks(workspaceRoot) {
  const checks = [];

  if (!workspaceRoot) {
    checks.push({
      name: "graphify:workspace",
      status: "warning",
      category: "integration",
      componentId: "graphify-context",
      detail: "No workspace root; graph freshness checks skipped. Run doctor from a repo cwd."
    });
    return checks;
  }

  const resolvedRoot = resolve(workspaceRoot);
  const graphifyAvailable = isCommandAvailable("graphify");

  checks.push({
    name: "graphify:cli",
    status: graphifyAvailable ? "ok" : "warning",
    category: "integration",
    componentId: "graphify-context",
    detail: graphifyAvailable
      ? "graphify CLI found in PATH."
      : "graphify CLI not found in PATH. Install separately when you want local graph generation."
  });

  const graphPath = join(resolvedRoot, "graphify-out", "graph.json");
  const reportPath = join(resolvedRoot, "graphify-out", "GRAPH_REPORT.md");

  if (!existsSync(graphPath)) {
    checks.push({
      name: "graphify:graph.json",
      status: "warning",
      category: "integration",
      componentId: "graphify-context",
      detail: existsSync(join(resolvedRoot, "graphify-out"))
        ? "graphify-out/graph.json is absent. Run `graphify update .` when the workspace is ready."
        : "graphify-out/ not found. Run `graphify update .` when the workspace is ready."
    });
    return checks;
  }

  const freshness = await readGraphFreshness(resolvedRoot, reportPath);
  checks.push({
    name: "graphify:graph.json",
    status: freshness.status,
    category: "integration",
    componentId: "graphify-context",
    detail: freshness.detail
  });

  return checks;
}

async function readGraphFreshness(workspaceRoot, reportPath) {
  if (!existsSync(reportPath)) {
    return {
      status: "warning",
      detail: "graphify-out/graph.json exists but GRAPH_REPORT.md is missing. Run `graphify update .` to refresh metadata."
    };
  }

  const report = await readFile(reportPath, "utf8");
  const match = report.match(GRAPH_REPORT_COMMIT_PATTERN);

  if (!match) {
    return {
      status: "ok",
      detail: "graphify-out/graph.json present. Commit metadata unavailable in GRAPH_REPORT.md."
    };
  }

  const graphCommit = match[1];
  const headCommit = resolveGitHead(workspaceRoot);

  if (!headCommit) {
    return {
      status: "warning",
      detail: `graphify-out/graph.json present (built from ${graphCommit}). Git HEAD unavailable for staleness check.`
    };
  }

  const isFresh = headCommit.startsWith(graphCommit) || graphCommit.startsWith(headCommit);
  if (isFresh) {
    return {
      status: "ok",
      detail: `graphify-out/graph.json in sync with HEAD (${headCommit.slice(0, 8)}).`
    };
  }

  return {
    status: "warning",
    detail: `graphify-out/graph.json may be stale (graph ${graphCommit}, HEAD ${headCommit.slice(0, 8)}). Run \`graphify update .\` or ${formatCliCommand("sync")} for managed assets only.`
  };
}

function resolveGitHead(workspaceRoot) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) return null;
  const head = result.stdout.trim();
  return head.length > 0 ? head : null;
}

function isCommandAvailable(command) {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().length > 0;
}
