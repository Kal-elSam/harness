// The single rule for "this row qualifies as an analyst pick", and the single
// place that turns the catalog's ONE ranking into picker views. Neutral module
// (no imports) so the catalog, the picker, the default pick and unattended
// recovery share it without import cycles.
//
// The order itself (`rank`) and the evidence verdict (`qualification`) are
// computed once, by the shared quality evaluator
// (intelligence/model-intelligence.js rankCandidatesByRequirements, applied in
// project-strategy.js computeBootstrapAnalystCatalog). Nothing here scores,
// re-sorts by evidence or reads a magnitude: it only filters, groups by model
// identity and orders by `rank`.

/**
 * Evidence verdicts a catalog row can carry:
 *  - "qualified": real, comparable evidence for every REQUIRED capability.
 *  - "partial_evidence": real but thin evidence (provisional): ranked after
 *    every comparable candidate, never starred.
 *  - "insufficient_evidence": evidence exists but a required capability has none.
 *  - "no_evidence": no benchmark at all (unscored).
 */
export const QUALIFICATION = Object.freeze({
  QUALIFIED: "qualified",
  PARTIAL: "partial_evidence",
  INSUFFICIENT: "insufficient_evidence",
  NONE: "no_evidence"
});

/** Main view size: the top three qualified, DISTINCT models. */
export const MAIN_VIEW_LIMIT = 3;

/** A row may be starred / picked automatically only with sufficient, comparable required evidence. */
export function recommendationQualifies(model) {
  return model?.qualification === QUALIFICATION.QUALIFIED;
}

/**
 * The analyst picker's MAIN view rule: usable now (`available`), access
 * verified and sufficient, comparable required evidence. Everything else that
 * is still selectable belongs in the manual alternatives view.
 *
 * @param {{available?: boolean, accessVerified?: boolean, qualification?: string}|null|undefined} model
 */
export function qualifiesForMainView(model) {
  return model?.available === true
    && model?.accessVerified !== false
    && recommendationQualifies(model);
}

const isRank = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * Row order: the catalog's `rank` (ascending; unranked rows last), then the
 * stable identifier `candidateKey`. Never evidence, provider, name or input
 * order.
 */
export function compareAnalystRows(a, b) {
  const rankA = isRank(a?.rank) ? a.rank : null;
  const rankB = isRank(b?.rank) ? b.rank : null;
  if (rankA === null || rankB === null) {
    const unranked = Number(rankA === null) - Number(rankB === null);
    if (unranked !== 0) return unranked;
  } else if (rankA !== rankB) {
    return rankA - rankB;
  }
  return String(a?.candidateKey ?? "").localeCompare(String(b?.candidateKey ?? ""));
}

/** Model identity of a row: the catalog's `identityKey` (same model through several subscriptions), else its own candidateKey. */
export function identityOf(model) {
  return model?.identityKey ?? model?.candidateKey ?? `${model?.adapterId}::${model?.modelId}`;
}

/**
 * The ONE classification of the catalog, derived from its order without any
 * recalculation: star, default analyst and picker views all come from here.
 *  - `main`: up to `limit` qualified rows, ONE per model identity (the same
 *    model through several subscriptions occupies one slot: its best-ranked
 *    available, verified route; ties were already broken by candidateKey).
 *  - `manual`: every other verified, available row — the equivalent routes of
 *    a main model, qualified rows beyond the limit and thin/unscored rows.
 *  - `star`: the first main row.
 * Unverified/unavailable rows are in neither list.
 *
 * @param {Array<object>} models
 * @param {{limit?: number}} [options]
 * @returns {{main: object[], manual: object[], star: object|null}}
 */
export function classifyAnalystCatalog(models, { limit = MAIN_VIEW_LIMIT } = {}) {
  const seen = new Set();
  const verified = [];
  for (const model of Array.isArray(models) ? models : []) {
    if (model?.available !== true || model?.accessVerified === false) continue;
    const key = model.candidateKey ?? `${model.adapterId}::${model.modelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    verified.push(model);
  }
  verified.sort(compareAnalystRows);
  const main = [];
  const mainIdentities = new Set();
  for (const model of verified) {
    if (main.length >= limit) break;
    if (!qualifiesForMainView(model)) continue;
    const identity = identityOf(model);
    if (mainIdentities.has(identity)) continue;
    mainIdentities.add(identity);
    main.push(model);
  }
  const inMain = new Set(main);
  return { main, manual: verified.filter((model) => !inMain.has(model)), star: main[0] ?? null };
}
