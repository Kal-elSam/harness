import { SDD_FILE_OUTCOMES } from "./sdd-evidence.js";
import { SDD_PERSONA_IDS } from "./sdd-destinations.js";

/** Empty v4 SDD block: persona off, no managed files, no receipt. */
export function defaultSddState() {
  return {
    persona: "off",
    agentIds: [],
    files: [],
    lastReceiptId: null,
    updatedAt: null
  };
}

/** Coerce any prior/absent shape into a valid v4 SDD block. */
export function normalizeSddState(raw) {
  if (!raw || typeof raw !== "object") return defaultSddState();
  return {
    persona: SDD_PERSONA_IDS.includes(raw.persona) ? raw.persona : "off",
    agentIds: Array.isArray(raw.agentIds) ? [...raw.agentIds] : [],
    files: Array.isArray(raw.files) ? raw.files.map(normalizeSddFile) : [],
    lastReceiptId: typeof raw.lastReceiptId === "string" ? raw.lastReceiptId : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
  };
}

function normalizeSddFile(entry) {
  return {
    destinationPath: entry.destinationPath,
    relativePath: entry.relativePath ?? "SKILL.md",
    skillId: entry.skillId,
    agentIds: Array.isArray(entry.agentIds) ? [...entry.agentIds] : [],
    hash: entry.hash ?? null,
    skillHash: entry.skillHash ?? null,
    action: entry.action ?? null
  };
}

function verifiedNoopHash(file) {
  const disk = file.afterHash ?? file.diskHash ?? file.beforeHash ?? null;
  if (disk == null || file.canonicalHash == null || disk !== file.canonicalHash) return null;
  return disk;
}

/** Track only applied(+afterHash) or noop with verified hash equality. No legacy fallback. */
export function shouldTrackSddReceiptFile(file) {
  if (!file || typeof file !== "object") return false;
  if (file.outcome === SDD_FILE_OUTCOMES.APPLIED) return file.afterHash != null;
  if (file.outcome === SDD_FILE_OUTCOMES.NOOP) return verifiedNoopHash(file) != null;
  return false;
}

function trackingHash(file) {
  if (file.outcome === SDD_FILE_OUTCOMES.APPLIED) return file.afterHash ?? null;
  if (file.outcome === SDD_FILE_OUTCOMES.NOOP) return verifiedNoopHash(file);
  return null;
}

function collectAgentIds(files) {
  const ids = new Set();
  for (const file of files) {
    for (const id of file.agentIds ?? []) ids.add(id);
  }
  return [...ids].sort();
}

/** True when rollback mutated disk via successful delete/restore (even if global ok=false). */
export function hasSuccessfulSddRollbackMutations(actions) {
  return (actions ?? []).some((entry) =>
    entry?.ok && (entry.action === "delete" || entry.action === "restore")
  );
}

/** Merge receipt into v4 SDD block for applied/verified files only. */
export function recordSddMaterialization(state, { receipt, now = () => new Date().toISOString() } = {}) {
  const current = normalizeSddState(state?.sdd);
  const managed = new Map(current.files.map((file) => [file.destinationPath, file]));

  for (const file of receipt.files ?? []) {
    if (!shouldTrackSddReceiptFile(file)) continue;
    const hash = trackingHash(file);
    if (hash == null) continue;
    managed.set(file.destinationPath, {
      destinationPath: file.destinationPath,
      relativePath: file.relativePath ?? "SKILL.md",
      skillId: file.skillId,
      agentIds: [...(file.agentIds ?? [])],
      hash,
      skillHash: file.skillHash ?? null,
      action: file.action
    });
  }

  const files = [...managed.values()].sort((left, right) =>
    left.destinationPath.localeCompare(right.destinationPath)
  );
  const agentIds = collectAgentIds(files);

  return {
    ...(state ?? {}),
    sdd: {
      persona: files.length === 0 ? "off" : (receipt.persona ?? current.persona),
      agentIds,
      files,
      lastReceiptId: receipt.id ?? current.lastReceiptId,
      updatedAt: now()
    }
  };
}

/** Reconcile each successful delete/restore; refresh agentIds/persona from remaining files. */
export function reconcileSddStateAfterRollback(state, {
  receipt, actions, now = () => new Date().toISOString()
} = {}) {
  const current = normalizeSddState(state?.sdd);
  const managed = new Map(current.files.map((file) => [file.destinationPath, { ...file }]));
  const receiptFiles = new Map((receipt?.files ?? []).map((file) => [file.destinationPath, file]));
  const backups = new Map((receipt?.backups ?? []).map((entry) => [entry.path, entry]));

  for (const action of actions ?? []) {
    if (!action?.ok || action.dryRun || action.action === "skip") continue;
    if (action.action === "delete") {
      managed.delete(action.path);
      continue;
    }
    if (action.action !== "restore") continue;
    const file = receiptFiles.get(action.path);
    const beforeHash = backups.get(action.path)?.beforeHash ?? file?.beforeHash ?? null;
    if (beforeHash == null || !file) continue;
    managed.set(action.path, {
      destinationPath: action.path,
      relativePath: file.relativePath ?? "SKILL.md",
      skillId: file.skillId,
      agentIds: [...(file.agentIds ?? [])],
      hash: beforeHash,
      skillHash: file.skillHash ?? null,
      action: file.action
    });
  }

  const files = [...managed.values()].sort((left, right) =>
    left.destinationPath.localeCompare(right.destinationPath)
  );

  return {
    ...(state ?? {}),
    sdd: {
      ...current,
      files,
      agentIds: collectAgentIds(files),
      persona: files.length === 0 ? "off" : current.persona,
      lastReceiptId: receipt?.id ?? current.lastReceiptId,
      updatedAt: now()
    }
  };
}
