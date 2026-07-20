/** Shared “repair needed” rule for sync, diff/snapshot, and cockpit actions. */
export function needsManagedRepair(statusReport) {
  if (!statusReport) return false;
  const needsSddRepair = (statusReport.checks ?? []).some((check) =>
    check.componentId === "sdd-core"
    && check.category === "integration"
    && check.status === "warning"
  );
  return statusReport.overall === "drift"
    || (statusReport.counts?.missing ?? 0) > 0
    || (statusReport.counts?.stale ?? 0) > 0
    || needsSddRepair;
}
