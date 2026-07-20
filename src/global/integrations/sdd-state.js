import { SDD_FILE_OUTCOMES } from "./sdd-evidence.js";
import { derivePersona, normalizePersonaAgentIds } from "./sdd-persona.js";

/** Empty v4 SDD block: persona off, no managed files, no receipt. */
export function defaultSddState() {
  return {
    persona: "off",
    personaAgentIds: [],
    agentIds: [],
    files: [],
    lastReceiptId: null,
    updatedAt: null
  };
}

/** Coerce any prior/absent shape into a valid v4 SDD block. */
export function normalizeSddState(raw) {
  if (!raw || typeof raw !== "object") return defaultSddState();
  const personaAgentIds = Object.hasOwn(raw, "personaAgentIds")
    ? (Array.isArray(raw.personaAgentIds) ? normalizePersonaAgentIds(raw.personaAgentIds) : [])
    : (raw.persona === "teaching" && Array.isArray(raw.agentIds)
      ? normalizePersonaAgentIds(raw.agentIds) : []);
  return {
    persona: derivePersona(personaAgentIds),
    personaAgentIds,
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

/** Legacy receipts without personaTransition derive consumers from teaching + files. */
function resolvePersonaAgentIds(receipt, current, files) {
  if (receipt?.personaTransition) return normalizePersonaAgentIds(receipt.personaTransition.after);
  if (!files.length || (receipt.persona ?? current.persona) !== "teaching") return [];
  return current.personaAgentIds.length ? current.personaAgentIds : collectAgentIds(files);
}

/** True when rollback mutated disk via successful delete/restore (even if global ok=false). */
export function hasSuccessfulSddRollbackMutations(actions) {
  return (actions ?? []).some((entry) =>
    entry?.ok && !entry.noop && (entry.action === "delete" || entry.action === "restore" || entry.action === "persona")
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
  const personaAgentIds = resolvePersonaAgentIds(receipt, current, files);

  return {
    ...(state ?? {}),
    sdd: {
      persona: derivePersona(personaAgentIds),
      personaAgentIds,
      agentIds: collectAgentIds(files),
      files,
      lastReceiptId: receipt.id ?? current.lastReceiptId,
      updatedAt: now()
    }
  };
}

/** Reconcile each successful delete/restore/persona; refresh agentIds/persona from remaining files. */
export function reconcileSddStateAfterRollback(state, {
  receipt, actions, now = () => new Date().toISOString()
} = {}) {
  const current = normalizeSddState(state?.sdd);
  const managed = new Map(current.files.map((file) => [file.destinationPath, { ...file }]));
  const receiptFiles = new Map((receipt?.files ?? []).map((file) => [file.destinationPath, file]));
  const backups = new Map((receipt?.backups ?? []).map((entry) => [entry.path, entry]));

  for (const action of actions ?? []) {
    if (!action?.ok || action.dryRun || action.action === "persona" || action.action === "skip") continue;
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
  const personaAction = (actions ?? []).find((entry) => entry.action === "persona" && entry.ok);
  let personaAgentIds = current.personaAgentIds;
  if (files.length === 0 && !personaAction) personaAgentIds = [];
  else if (personaAction) personaAgentIds = normalizePersonaAgentIds(personaAction.before ?? []);

  return {
    ...(state ?? {}),
    sdd: {
      ...current,
      files,
      agentIds: collectAgentIds(files),
      personaAgentIds,
      persona: derivePersona(personaAgentIds),
      lastReceiptId: receipt?.id ?? current.lastReceiptId,
      updatedAt: now()
    }
  };
}
