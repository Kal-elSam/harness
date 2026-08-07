import { inspectObsidianVault as defaultInspect } from "./obsidian-vault.js";

function envelope(partial = {}) {
  return {
    state: "unconfigured",
    vaultPath: null,
    kairoRoot: null,
    noteCount: 0,
    lastPublishAt: null,
    pendingProposals: 0,
    diagnostics: [],
    error: null,
    ...partial
  };
}

export function emptyObsidianVaultStatus() {
  return envelope({ state: "error", error: "error" });
}

export function summarizeObsidianVaultStatus(raw) {
  if (raw == null || typeof raw !== "object") return emptyObsidianVaultStatus();
  const noteCount = Array.isArray(raw.notes)
    ? raw.notes.length
    : (typeof raw.noteCount === "number" && Number.isFinite(raw.noteCount) ? raw.noteCount : 0);
  return envelope({
    state: typeof raw.state === "string" && raw.state ? raw.state : "error",
    vaultPath: raw.vaultPath ?? null,
    kairoRoot: raw.kairoRoot ?? null,
    noteCount,
    lastPublishAt: typeof raw.lastPublishAt === "string" ? raw.lastPublishAt : null,
    pendingProposals: typeof raw.pendingProposals === "number" && raw.pendingProposals > 0
      ? Math.floor(raw.pendingProposals)
      : 0,
    diagnostics: Array.isArray(raw.diagnostics) ? raw.diagnostics.map(String) : [],
    error: raw.error == null ? null : String(raw.error)
  });
}

/**
 * Read-only vault status for Cockpit. No writes / no auto-sync.
 * Without an absolute vaultPath → unconfigured (never guesses a home vault).
 */
export async function loadObsidianVaultStatus({
  vaultPath = null,
  lastPublishAt = null,
  pendingProposals = 0,
  inspectObsidianVault = defaultInspect
} = {}) {
  if (vaultPath == null || vaultPath === "") {
    return envelope({
      state: "unconfigured",
      diagnostics: ["vaultPath not configured"],
      lastPublishAt,
      pendingProposals: typeof pendingProposals === "number" ? Math.max(0, Math.floor(pendingProposals)) : 0
    });
  }
  try {
    const inspected = await inspectObsidianVault({ vaultPath });
    return summarizeObsidianVaultStatus({
      ...inspected,
      noteCount: inspected?.notes?.length ?? 0,
      lastPublishAt,
      pendingProposals
    });
  } catch (err) {
    return envelope({
      state: "error",
      vaultPath: String(vaultPath),
      error: String(err?.message ?? err),
      diagnostics: [String(err?.message ?? err)],
      lastPublishAt,
      pendingProposals: typeof pendingProposals === "number" ? Math.max(0, Math.floor(pendingProposals)) : 0
    });
  }
}
