/** Text helpers retained after U7 Pi-TUI widget retirement. */
export const TEAM_SETUP_NEXT_STEP = "Next: run kairo → press a to analyze, A to approve.";

export function formatSessionIdentity(session) {
  if (session?.state !== "bound") return "session: unbound";
  return `session: ${session.id.slice(0, 8)} · ${session.mode ?? "ask"}`;
}

export function availabilityNotices(team) {
  const groups = new Map();
  for (const row of team?.rows ?? []) {
    if (row.availability?.state !== "blocked") continue;
    const limit = row.availability.limit ?? null;
    const warning = row.availability.warning ?? "Blocked.";
    const key = limit ? `${row.via}|window:${limit.window ?? "usage"}` : `${row.via}|${warning}`;
    const group = groups.get(key) ?? { key, warning, windowLimited: Boolean(limit), roles: [] };
    group.roles.push(`${row.role} (${row.model})`);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ key, warning, windowLimited, roles }) => ({
    key,
    message: windowLimited
      ? `${warning} — affects ${roles.join(", ")}. Kairo will try to recover the team automatically.`
      : `${warning} — affects ${roles.join(", ")}. ${TEAM_SETUP_NEXT_STEP}`
  }));
}

/** No-op Pi-TUI widget factories — interactive Pi shell UI is retired (U7). */
export function createKairoWorkspaceWidget() { return []; }
export function createKairoTextWidget(lines = []) { return Array.isArray(lines) ? lines : []; }
export function createShellSidebarWidget() { return undefined; }
export function createShellBottomStripWidget() { return undefined; }
export function createCompactShellSummaryWidget() { return []; }
export function createShellWelcomeWidget() { return undefined; }
