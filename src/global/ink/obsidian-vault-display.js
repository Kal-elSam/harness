import { LAYOUT_MODES } from "./layout.js";

/** Display-only Obsidian vault lines — never shows paths, write CTAs, or sync controls. */
export function formatObsidianVaultLines(status, layoutMode = LAYOUT_MODES.COMPACT) {
  if (status == null || typeof status !== "object") return ["Obsidian · unavailable"];
  const state = typeof status.state === "string" && status.state ? status.state : "error";
  const notes = typeof status.noteCount === "number" && Number.isFinite(status.noteCount)
    ? status.noteCount
    : 0;
  const pending = typeof status.pendingProposals === "number" && status.pendingProposals > 0
    ? status.pendingProposals
    : 0;

  if (state === "unconfigured") return ["Obsidian · unconfigured"];
  if (state === "missing") return ["Obsidian · missing"];
  if (state !== "available" && state !== "partial") {
    return [`Obsidian · ${state}`];
  }

  const head = state === "partial"
    ? `Obsidian · partial · ${notes} notes`
    : `Obsidian · ${notes} notes`;
  const lines = [head];
  if (layoutMode === LAYOUT_MODES.MINIMAL) return lines;

  if (pending > 0) lines.push(`  · pending · ${pending}`);
  else if (layoutMode === LAYOUT_MODES.COMPACT) lines.push("  · no auto-sync");

  if (layoutMode === LAYOUT_MODES.WIDE) {
    const pub = typeof status.lastPublishAt === "string" && status.lastPublishAt
      ? status.lastPublishAt.slice(0, 19)
      : "never";
    lines.push(`  · last publish · ${pub}`);
    if (pending === 0) lines.push("  · no auto-sync");
  }
  return lines;
}
