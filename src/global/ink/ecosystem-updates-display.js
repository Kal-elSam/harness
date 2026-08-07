import { LAYOUT_MODES } from "./layout.js";

/** Display-only ecosystem update lines for Cockpit companion overlay. */
export function formatEcosystemUpdateLines(updates, layoutMode = LAYOUT_MODES.COMPACT) {
  if (updates == null || typeof updates !== "object") return ["Updates · unavailable"];
  const state = typeof updates.state === "string" && updates.state ? updates.state : "error";
  const tools = updates.tools && typeof updates.tools === "object" ? updates.tools : {};
  const pending = ["kairo", "hermes", "gentle", "skills"]
    .map((id) => tools[id])
    .filter((t) => t && t.updateAvailable === true);
  const cache = updates.cacheHit === true ? " · cache" : "";

  if (state !== "available" && state !== "partial" && pending.length === 0) {
    return [`Updates · ${state}${cache}`];
  }

  const lines = [
    pending.length > 0
      ? `Updates · ${pending.length} available${cache}`
      : `Updates · current${cache}`
  ];
  if (layoutMode === LAYOUT_MODES.MINIMAL) return lines;

  for (const tool of pending.slice(0, layoutMode === LAYOUT_MODES.WIDE ? 4 : 2)) {
    const inst = tool.installed ?? "—";
    const latest = tool.latest ?? "—";
    lines.push(`  · ${tool.id} ${inst} → ${latest}`);
  }
  if (pending.length === 0 && layoutMode === LAYOUT_MODES.WIDE) {
    for (const id of ["kairo", "hermes", "gentle", "skills"]) {
      const tool = tools[id];
      if (!tool) continue;
      lines.push(`  · ${id} · ${tool.state ?? "unknown"}`);
    }
  }
  return lines;
}
