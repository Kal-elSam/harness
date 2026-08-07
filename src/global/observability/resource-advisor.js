/**
 * Deterministic Local Resource Advisor — observe and recommend only.
 * Never deletes, compacts, or kills. Deep-scan is explicit opt-in.
 */

export function recommendSystemResources(resources, { deepScan = false } = {}) {
  const recommendations = [];
  if (resources == null || typeof resources !== "object") {
    return { recommendations, deepScan: false };
  }
  const state = typeof resources.state === "string" ? resources.state : "error";
  if (state === "unavailable" || state === "error" || state === "incompatible") {
    return { recommendations, deepScan: Boolean(deepScan) };
  }

  const diskPct = resources.disk?.freePercent;
  if (typeof diskPct === "number" && Number.isFinite(diskPct)) {
    if (diskPct < 10) {
      recommendations.push({
        id: "free-disk-critical",
        severity: "critical",
        title: "Free disk space",
        detail: "Disk free below 10%. Clear caches manually after review — Kairo performs no removals."
      });
    } else if (diskPct < 20) {
      recommendations.push({
        id: "free-disk-warning",
        severity: "warning",
        title: "Disk space running low",
        detail: "Disk free below 20%. Prefer quitting unused apps before large downloads."
      });
    }
  }

  const ramPct = resources.memory?.freePercent;
  if (typeof ramPct === "number" && Number.isFinite(ramPct) && ramPct < 15) {
    recommendations.push({
      id: "quit-heavy-apps",
      severity: "warning",
      title: "Quit heavy apps",
      detail: "Memory free below 15%. Quit unused agents/browsers; Kairo never terminates processes."
    });
  }

  const tracked = Array.isArray(resources.processes?.tracked) ? resources.processes.tracked : [];
  const busy = tracked.filter((entry) =>
    entry != null && typeof entry === "object"
    && typeof entry.name === "string"
    && Number.isInteger(entry.count) && entry.count >= 2
  );
  if (busy.length > 0) {
    const names = busy.map((entry) => entry.name).join(", ");
    recommendations.push({
      id: "inspect-tracked-apps",
      severity: "info",
      title: "Inspect local heavy apps",
      detail: `Tracked pressure: ${names}. Review in Activity Monitor — no auto-quit.`
    });
  }

  if (deepScan === true) {
    recommendations.push({
      id: "deep-scan-known-caches",
      severity: "info",
      title: "Inspect known local caches",
      detail: "Opt-in deep scan only. Lists known cache/DB locations for human review — performs no removals."
    });
  }

  return { recommendations, deepScan: deepScan === true };
}
