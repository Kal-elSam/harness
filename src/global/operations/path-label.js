/**
 * Distinguishable path for confirmation / detail disclosure.
 * Prefer home-relative `~/...`; otherwise keep parent/basename.
 */
export function formatConfirmPath(target, homeDir = null) {
  const raw = String(target ?? "").trim();
  if (!raw) return "target";
  const normalized = raw.replaceAll("\\", "/");
  if (normalized === "~" || normalized.startsWith("~/")) return normalized;

  const home = homeDir ? String(homeDir).replaceAll("\\", "/").replace(/\/$/, "") : "";
  if (home && (normalized === home || normalized.startsWith(`${home}/`))) {
    return `~${normalized.slice(home.length)}`;
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join("/");
  return parts[0] || normalized;
}
