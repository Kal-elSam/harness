import { existsSync } from "node:fs";
import { join } from "node:path";
import { listBackupSnapshots } from "./backups.js";
import { harnessHomePaths } from "./paths.js";
import { buildAdapterContext } from "./adapter-context.js";
import { listAdapters } from "./registry.js";
import { readGlobalState } from "./state.js";

export async function runGlobalDoctorChecks(homeDir) {
  const paths = harnessHomePaths(homeDir);
  const state = await readGlobalState(paths.statePath);
  const context = buildAdapterContext({ homeDir, packageName: state?.packageName ?? "", coreDir: paths.coreDir });
  const checks = [stateCheck(state), ...coreFileChecks(paths, state)];

  for (const adapter of listAdapters()) {
    const stateEntry = state?.adapters?.find((entry) => entry.id === adapter.id);
    checks.push(await adapter.doctor(context, stateEntry));
  }

  checks.push(await backupsCheck(paths));

  const hasMissingRequired = checks.some((check) => check.status === "missing");
  return { checks, ok: !hasMissingRequired, state, paths };
}

function stateCheck(state) {
  if (!state) {
    return {
      name: "~/.harness/state.json",
      status: "missing",
      detail: 'Not found. Run "harness install" to configure the local ecosystem.'
    };
  }

  return {
    name: "~/.harness/state.json",
    status: "ok",
    detail: `cliVersion=${state.cliVersion ?? "unknown"}, adapters=${state.adapters?.length ?? state.agents?.length ?? 0}`
  };
}

function coreFileChecks(paths, state) {
  const coreFiles = Object.keys(state?.coreFiles ?? {});

  if (coreFiles.length === 0) {
    return [{
      name: "~/.harness/core",
      status: state ? "warning" : "missing",
      detail: "No managed core files recorded."
    }];
  }

  return coreFiles.map((relativePath) => {
    const exists = existsSync(join(paths.root, relativePath));
    return {
      name: `~/.harness/${relativePath}`,
      status: exists ? "ok" : "missing",
      detail: exists ? undefined : "Tracked core file missing on disk."
    };
  });
}

async function backupsCheck(paths) {
  const snapshots = await listBackupSnapshots(paths.backupsDir);

  return {
    name: "~/.harness/backups",
    status: "ok",
    detail: snapshots.length > 0 ? `${snapshots.length} snapshot(s)` : "No snapshots yet."
  };
}
