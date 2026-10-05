export const CONTEXT_FILL_SCHEMA = "kairo.context-fill/v1";
export const CONTEXT_FILL_CACHE_MS = 60_000;

export function projectLabel(cwd) {
  const parts = String(cwd).split("/").filter(Boolean);
  return parts.slice(-2).join("/") || "unknown";
}
