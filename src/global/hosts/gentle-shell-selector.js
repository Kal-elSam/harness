// Pure launch-model decision for Gentle Shell. No I/O: the extension supplies a
// prepared snapshot and the host model registry. A model the user chose by hand
// is left alone unless Kairo's admission evidence says it has no quota.
const MANUAL_SOURCES = new Set(['binding', 'profile']);
const JUDGES = ['jd-judge-a', 'jd-judge-b'];
const JD_ROLES = Object.freeze({ 'jd-judge-a': 'Reviewer', 'jd-judge-b': 'Reviewer', 'jd-fix-agent': 'Builder' });
const REVIEW_LENSES = new Set(['review-risk', 'review-resilience', 'review-readability', 'review-reliability', 'review-refuter', 'review-validator']);

export const isManualSource = source => typeof source === 'string'
  && (MANUAL_SOURCES.has(source) || source.startsWith('pin:') || source.startsWith('frozen:'));

const none = reason => ({ model: null, reason });
const answer = (model, reason) => ({ model, reason });

/** Kairo model id to Pi "provider/id": only when exactly one registry entry matches. */
function toPiModel(candidate, registryModels) {
  const matches = (registryModels ?? []).filter(entry => entry?.id === candidate.modelId);
  if (matches.length === 1) return { ok: true, provider: matches[0].provider, model: `${matches[0].provider}/${matches[0].id}` };
  return { ok: false, reason: matches.length ? 'ambiguous-model' : 'unknown-model' };
}

/** Admitted candidates of a role that map to a Pi model, in Kairo order. */
function admittedMapped(entry, registryModels) {
  const mapped = [];
  let failure = null;
  for (const candidate of entry?.candidates ?? []) {
    if (candidate.admitted !== true) continue;
    const pi = toPiModel(candidate, registryModels);
    if (pi.ok) mapped.push(pi);
    else failure ??= pi.reason;
  }
  return { mapped, failure };
}

/**
 * @param {{request: {agent: string, model: string|null, source: string|null},
 *   snapshot: {roles: Record<string, {candidates: {provider: string, modelId: string, admitted: boolean}[]}>, agents: Record<string, string>}|null,
 *   registryModels: {provider: string, id: string}[]}} input
 * @returns {{model: string|null, reason: string}}
 */
export function decideLaunchModel({ request, snapshot, registryModels }) {
  const agent = request?.agent;
  if (!snapshot || typeof agent !== 'string') return none('no-snapshot');
  if (REVIEW_LENSES.has(agent)) return none('review-lens');
  const manual = isManualSource(request.source);

  if (agent in JD_ROLES) {
    if (manual) return none('manual-judgment-day');
    const entry = snapshot.roles[JD_ROLES[agent]];
    const { mapped, failure } = admittedMapped(entry, registryModels);
    if (!JUDGES.includes(agent)) return mapped.length ? answer(mapped[0].model, 'routed') : none(failure ?? 'no-admitted-model');
    const first = mapped[0];
    const other = first && mapped.find(item => item.provider !== first.provider);
    if (!first) return none(failure ?? 'no-admitted-model');
    if (!other) return none('judges-share-provider');
    return answer(agent === 'jd-judge-a' ? first.model : other.model, 'routed-independent');
  }

  const role = snapshot.agents?.[agent];
  const entry = role ? snapshot.roles[role] : null;
  if (!entry) return none('unknown-agent');
  if (manual) {
    const id = String(request.model ?? '').split('/').slice(1).join('/');
    const chosen = entry.candidates.find(item => item.modelId === id);
    if (!chosen || chosen.admitted !== false) return none('manual-kept');
  }
  const { mapped, failure } = admittedMapped(entry, registryModels);
  if (!mapped.length) return none(failure ?? 'no-admitted-model');
  return answer(mapped[0].model, manual ? 'manual-out-of-quota' : 'routed');
}
