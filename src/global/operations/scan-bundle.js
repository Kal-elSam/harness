export const CONTROL_PLANE_AUTO_SCAN = Object.freeze({
  includeDiff: true,
  includeExplain: false,
  includeRuntime: false
});

export async function loadCockpitScanBundle({
  homeDir,
  workspaceRoot,
  packageName,
  packageRoot,
  cliVersion,
  buildDashboard,
  buildDiagnostics,
  buildSnapshot,
  buildCompanion = null
}) {
  const [dashboard, diagnostics, snapshot] = await Promise.all([
    buildDashboard({ homeDir, workspaceRoot, cliVersion }),
    buildDiagnostics({ homeDir, workspaceRoot, packageName, packageRoot, cliVersion }),
    buildSnapshot({
      homeDir,
      workspaceRoot,
      packageName,
      packageRoot,
      cliVersion,
      ...CONTROL_PLANE_AUTO_SCAN
    })
  ]);
  let companion = null;
  if (typeof buildCompanion === "function") {
    try {
      companion = await buildCompanion({
        homeDir, workspaceRoot, packageName, packageRoot, cliVersion, dashboard, snapshot
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      companion = {
        ok: false, error: detail, signals: null, engram: null, links: [], alertsCount: null,
        nextSafeAction: {
          kind: "investigate", title: "Investigate companion diagnostics",
          detail, secondary: true, displayOnly: true
        }
      };
    }
  }
  return { dashboard, diagnostics, snapshot, companion };
}

/**
 * Serialize overlapping reloads and drop stale completions.
 * Callers keep prior error/loading until a non-stale success updates state.
 */
export function createSerializedReloader(runLoad) {
  let generation = 0;
  let tail = Promise.resolve();

  return function reload() {
    const gen = ++generation;
    const job = async () => {
      try {
        const result = await runLoad();
        if (gen !== generation) {
          return { stale: true, result: null, error: null };
        }
        return { stale: false, result, error: null };
      } catch (error) {
        if (gen !== generation) {
          return { stale: true, result: null, error: null };
        }
        return { stale: false, result: null, error };
      }
    };
    const next = tail.then(job, job);
    tail = next.then(() => undefined, () => undefined);
    return next;
  };
}
