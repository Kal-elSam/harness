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
    skillId: entry.skillId,
    agentIds: Array.isArray(entry.agentIds) ? [...entry.agentIds] : [],
    hash: entry.hash ?? null,
    action: entry.action ?? null
  };
}

/** Merge receipt into v4 SDD block; track create/update/noop only, leave conflicts alone. */
export function recordSddMaterialization(state, { receipt, now = () => new Date().toISOString() } = {}) {
  const current = normalizeSddState(state?.sdd);
  const managed = new Map(current.files.map((file) => [file.destinationPath, file]));

  for (const file of receipt.files ?? []) {
    if (file.action === "conflict") continue;
    const hash = file.afterHash ?? file.canonicalHash ?? file.diskHash ?? null;
    if (hash == null) continue;
    managed.set(file.destinationPath, {
      destinationPath: file.destinationPath,
      skillId: file.skillId,
      agentIds: [...(file.agentIds ?? [])],
      hash,
      action: file.action
    });
  }

  const files = [...managed.values()].sort((left, right) =>
    left.destinationPath.localeCompare(right.destinationPath)
  );

  return {
    ...(state ?? {}),
    sdd: {
      persona: receipt.persona ?? current.persona,
      agentIds: receipt.agentIds ? [...receipt.agentIds] : current.agentIds,
      files,
      lastReceiptId: receipt.id ?? current.lastReceiptId,
      updatedAt: now()
    }
  };
}
