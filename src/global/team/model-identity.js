// Host-agnostic model identity: what was requested versus what was observed to run.
// An alias sent to a host never proves a version, and a request never proves an execution.

export const CLAUDE_ALIASES = ['sonnet', 'opus', 'haiku', 'fable'];
export const IDENTITY_STATUSES = ['matched', 'mismatch', 'unverified'];
const SEVERITY = { none: 0, version: 1, family: 2, provider: 3 };

const clean = value => (typeof value === 'string' && value.trim() ? value.trim() : null);
const stripped = model => model.toLowerCase().replace(/^[^/]*\//, '').replace(/#.*$/, '');

export function isClaudeAlias(model) {
  const value = clean(model);
  return value !== null && CLAUDE_ALIASES.includes(value.toLowerCase());
}

export function inferProvider(model) {
  const value = clean(model);
  if (!value) return null;
  const id = stripped(value);
  if (isClaudeAlias(id) || /^claude(?:[-.]|$)/.test(id)) return 'claude';
  if (/^(?:gpt|codex|o\d)/.test(id)) return 'codex';
  if (/^gemini/.test(id)) return 'gemini';
  return null;
}

/** Name segments without version numbers: claude-haiku-4-5-20251001 and haiku are both "haiku". */
export function modelFamily(model) {
  const value = clean(model);
  if (!value) return null;
  const parts = stripped(value).split(/[-._:\s]+/).filter(part => part && !/\d/.test(part) && !['claude', 'latest'].includes(part));
  return parts.length ? parts.join('-') : null;
}

const versionKey = model => stripped(model).replace(/-(?:\d{8}|latest)$/, '');

function divergenceOf(requested, observed, requestedProvider, observedProvider) {
  const left = requestedProvider ?? inferProvider(requested), right = observedProvider ?? inferProvider(observed);
  if (left && right && left !== right) return 'provider';
  const a = modelFamily(requested), b = modelFamily(observed);
  if (a && b && a !== b) return 'family';
  if (!a || !b) return versionKey(requested) === versionKey(observed) ? 'none' : 'family';
  // A plain alias asks for the family, so any version of it matches.
  if (isClaudeAlias(requested)) return 'none';
  return versionKey(requested) === versionKey(observed) ? 'none' : 'version';
}

/** Observed ids by frequency, most frequent first; ties keep first-seen order. */
function ranked(list) {
  const counts = new Map();
  for (const item of list) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].sort((x, y) => y[1] - x[1]).map(([model]) => model);
}

/**
 * Pure comparison of a requested identity with the identities observed to run.
 * No observation, or a request that names no concrete model (agent-own), is
 * unverified: the divergence is then unknown rather than none.
 */
export function assessModelIdentity({ requestedProvider, requestedModel, dispatchedAlias, observedProvider, observedModel, observedModels } = {}) {
  const requested = clean(requestedModel);
  const list = (Array.isArray(observedModels) ? observedModels : [observedModel]).map(clean).filter(Boolean);
  const base = { requestedModelId: requested, dispatchedModelAlias: clean(dispatchedAlias), observedModelId: null };
  if (!list.length) return { ...base, identityStatus: 'unverified', divergence: 'unverified' };
  const [top] = ranked(list);
  if (!requested || requested === 'agent-own') return { ...base, observedModelId: top, identityStatus: 'unverified', divergence: 'unverified' };
  const worst = list.map(model => divergenceOf(requested, model, clean(requestedProvider), clean(observedProvider)))
    .reduce((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), 'none');
  return { ...base, observedModelId: top, identityStatus: worst === 'none' ? 'matched' : 'mismatch', divergence: worst };
}

/**
 * Launch-time comparison: nothing is observed yet. A same-family alias is
 * unproven (null), never a confirmed match and never a fallback.
 * @returns {{ fallbackDetected: boolean|null, divergence: string }}
 */
export function compareLaunchModel({ selectedProvider, selectedModel, launchedProvider, launchedModel }) {
  const selected = clean(selectedModel), launched = clean(launchedModel);
  if (!selected || !launched) return { fallbackDetected: null, divergence: 'unverified' };
  const claude = clean(launchedProvider) === 'claude' && clean(selectedProvider) === 'claude';
  if (claude && (isClaudeAlias(launched) || isClaudeAlias(selected)) && modelFamily(launched) && modelFamily(launched) === modelFamily(selected)) {
    return { fallbackDetected: null, divergence: 'unverified' };
  }
  if (launched === selected) return { fallbackDetected: false, divergence: 'none' };
  return { fallbackDetected: true, divergence: divergenceOf(selected, launched, clean(selectedProvider), clean(launchedProvider)) };
}

/** Ledger fields for one record; every launch is unverified until something observes it. */
export function identityFields({ adapterId, modelId, dispatchedModelAlias, observedModels }) {
  const result = assessModelIdentity({ requestedProvider: adapterId, requestedModel: modelId, dispatchedAlias: dispatchedModelAlias, observedModels });
  return {
    requestedModelId: result.requestedModelId,
    ...(result.dispatchedModelAlias ? { dispatchedModelAlias: result.dispatchedModelAlias } : {}),
    ...(result.observedModelId ? { observedModelId: result.observedModelId } : {}),
    identityStatus: result.identityStatus,
  };
}

/** Rows written before the identity fields existed have no identityStatus. */
export function hasIdentity(row) {
  return IDENTITY_STATUSES.includes(row?.identityStatus);
}

/**
 * Which model a recorded outcome may be credited to. Legacy and matched rows keep
 * their recorded model, and so do unverified ones (no proof moves credit); a proven
 * mismatch goes to the model that ran, and credits none without an observed model.
 * @returns {{ adapterId: string, modelId: string } | null}
 */
export function creditedIdentity(row) {
  if (!hasIdentity(row) || row.identityStatus !== 'mismatch') return { adapterId: row.adapterId, modelId: row.modelId };
  const observed = clean(row.observedModelId);
  if (!observed) return null;
  return { adapterId: inferProvider(observed) ?? row.adapterId, modelId: observed };
}

/** Human label for a ledger row; legacy rows read exactly as before. */
export function identityLabel(row) {
  if (!hasIdentity(row)) return row.modelId;
  if (row.identityStatus === 'mismatch') return `requested ${row.modelId}, observed ${row.observedModelId ?? 'unknown'}`;
  if (row.identityStatus === 'matched') return row.observedModelId ? `${row.modelId}, observed ${row.observedModelId}` : row.modelId;
  return `${row.modelId}, identity unverified${row.observedModelId ? `, observed ${row.observedModelId}` : ''}`;
}

/** Outcome rows as telemetry may credit them; legacy and matched rows are returned unchanged. */
export function creditedOutcomes(rows) {
  return (rows ?? []).flatMap(row => {
    const credit = creditedIdentity(row);
    if (!credit) return [];
    return credit.adapterId === row.adapterId && credit.modelId === row.modelId ? [row] : [{ ...row, ...credit }];
  });
}
