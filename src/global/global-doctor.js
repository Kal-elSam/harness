import { listBackupSnapshots } from "./backups.js";
import { buildAdapterContext } from "./adapter-context.js";
import { runComponentEcosystemChecks } from "./component-ecosystem-checks.js";
import { detectGlobalDrift, hasRepairableDrift } from "./drift.js";
import { harnessHomePaths } from "./paths.js";
import { resolveComponent } from "./component-registry.js";
import { readGlobalState } from "./state.js";
import { formatCliCommand } from "./brand/cli.js";
import {
  BACKEND_IDS,
  inspectIntelligenceBackends
} from "./intelligence/index.js";

export async function runGlobalDoctorChecks(homeDir, {
  packageRoot,
  workspaceRoot = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  inspectBackends = inspectIntelligenceBackends
} = {}) {
  const paths = harnessHomePaths(homeDir);
  const state = await readGlobalState(paths.statePath);
  const installedComponents = (state?.components ?? []).map((entry) => resolveComponent(entry.id, { workspaceRoot }));
  const context = buildAdapterContext({
    homeDir,
    packageName: state?.packageName ?? "",
    packageRoot,
    workspaceRoot,
    components: installedComponents
  });
  const checks = packageRoot
    ? await detectGlobalDrift({ homeDir, paths, state, packageRoot, workspaceRoot, context })
    : [stateOnlyCheck(state)];

  if (packageRoot) {
    checks.push(await backupsCheck(paths));
    checks.push(...await runComponentEcosystemChecks({
      installedComponents,
      workspaceRoot
    }));
  }

  checks.push(await intelligenceProvidersCheck({ env, fetchImpl, inspectBackends }));

  const hasMissing = checks.some((check) => check.status === "missing");
  const hasStale = checks.some((check) => check.status === "stale");

  return {
    checks,
    ok: !hasMissing && !hasStale,
    hasDrift: hasRepairableDrift(checks),
    state,
    paths
  };
}

async function intelligenceProvidersCheck({ env, fetchImpl, inspectBackends }) {
  try {
    const backends = await inspectBackends({ env, fetchImpl });
    const parts = [];

    if (backends.some((entry) => entry.id === BACKEND_IDS.OLLAMA && entry.available)) {
      parts.push("Ollama available");
    }

    const go = backends.find((entry) => entry.id === BACKEND_IDS.OPENCODE_GO);
    const zen = backends.find((entry) => entry.id === BACKEND_IDS.OPENCODE_ZEN);
    const runtime = backends.find((entry) => entry.id === BACKEND_IDS.OPENCODE);

    if (go?.configured || go?.hasApiKey) {
      parts.push(formatCloudProvider("OpenCode Go", go));
    }
    if (zen?.configured || zen?.hasApiKey) {
      parts.push(formatCloudProvider("OpenCode Zen", zen));
    }
    if (runtime?.available || runtime?.detected) {
      const providers = runtime.evidence?.authProviders?.length
        ? runtime.evidence.authProviders.join(", ")
        : "CLI installed";
      parts.push(`OpenCode CLI runtime (${providers}; not authenticated by Kairo)`);
    }
    if (backends.some((entry) => entry.id === BACKEND_IDS.OPENROUTER && entry.hasApiKey)) {
      parts.push("OpenRouter configured (env key; entitlement unverified)");
    }

    return {
      name: "intelligence providers",
      status: "ok",
      category: "intelligence",
      detail: parts.length > 0
        ? `${parts.join("; ")}. Cloud invoke still needs --cloud-consent --yes. API keys never prove subscription or balance.`
        : `Optional. Start Ollama, install OpenCode CLI, or set OPENCODE_API_KEY / OPENROUTER_API_KEY. See ${formatCliCommand("intelligence status")}.`
    };
  } catch (error) {
    return {
      name: "intelligence providers",
      status: "warning",
      category: "intelligence",
      detail: `Intelligence provider inspection failed (${error?.message ?? error}). Overall doctor health is unchanged.`
    };
  }
}

function formatCloudProvider(label, entry) {
  const identity = entry.authenticated
    ? "authenticated"
    : entry.configured || entry.hasApiKey
      ? "configured"
      : "detected";
  const entitlement = entry.entitlement ?? "unknown";
  return `${label} (${identity}; entitlement=${entitlement})`;
}

function stateOnlyCheck(state) {
  if (!state) {
    return {
      name: "~/.harness/state.json",
      status: "missing",
      category: "state",
      detail: `Not found. Run "${formatCliCommand("install")}" to configure the local ecosystem.`
    };
  }

  return {
    name: "~/.harness/state.json",
    status: "ok",
    category: "state",
    detail: `cliVersion=${state.cliVersion ?? "unknown"}`
  };
}

async function backupsCheck(paths) {
  const snapshots = await listBackupSnapshots(paths.backupsDir);

  return {
    name: "~/.harness/backups",
    status: "ok",
    category: "backups",
    detail: snapshots.length > 0 ? `${snapshots.length} snapshot(s)` : "No snapshots yet."
  };
}
