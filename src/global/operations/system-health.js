/**
 * Format active profile source labels from the real `{ global, project }` contract.
 * Paths are omitted; only source kind labels are shown.
 */
export function formatProfileSourcesLabel(sources) {
  if (!sources || typeof sources !== "object" || Array.isArray(sources)) {
    return "none";
  }

  const labels = [];
  if (sources.global) labels.push("global");
  if (sources.project) labels.push("project");
  return labels.length > 0 ? labels.join(", ") : "none";
}

export function formatSystemHealthLines(diagnostics) {
  const summary = diagnostics?.diagnostics;
  const intelligence = diagnostics?.intelligence?.summary;
  const profile = diagnostics?.profile;
  const capabilities = diagnostics?.capabilities ?? [];
  const authKnown = capabilities.filter((entry) => entry.authenticated != null);
  const authReady = authKnown.filter((entry) => entry.authenticated).length;

  const lines = [
    "Agents",
    `Detected: ${summary?.detected ?? 0}/${capabilities.length}`,
    `Available: ${summary?.available ?? 0}`,
    `Unknown: ${summary?.unknown ?? 0}`,
    `Errors: ${summary?.errors ?? 0}`,
    ...formatAgentStatusLines(capabilities),
    "",
    "Intelligence",
    intelligence?.localAvailable
      ? "Local backend available"
      : "Local backend unavailable",
    intelligence?.cloudAuthenticated
      ? "Cloud backend authenticated"
      : "Cloud backend not configured",
    `Routing: ${diagnostics?.intelligence?.routingPreview?.reason ?? "n/a"}`,
    "",
    "Authentication",
    authKnown.length === 0
      ? "No agent authentication signals yet"
      : `${authReady}/${authKnown.length} agents report ready auth`,
    "",
    "Configuration",
    `CLI version: ${diagnostics?.cliVersion ?? "unknown"}`,
    `Profile sources: ${formatProfileSourcesLabel(profile?.sources)}`
  ];

  const recommendations = diagnostics?.recommendations ?? [];
  if (recommendations.length > 0) {
    lines.push("", "Recommendations");
    for (const recommendation of recommendations) {
      lines.push(`  • ${recommendation}`);
    }
  }

  return lines;
}

export function formatAgentStatusLines(capabilities) {
  return capabilities.map((entry) => {
    const auth = entry.authenticated == null ? "n/a" : (entry.authenticated ? "yes" : "no");
    const version = entry.version ?? "unknown";
    return `${entry.label.padEnd(14)} ${entry.state.padEnd(14)} v${version} auth=${auth}`;
  });
}
