// The single rule for "this recommendation qualifies as an analyst pick".
// Neutral module (no imports) so the picker, the default pick and unattended
// recovery share it without import cycles.

/**
 * Minimum evidence confidence for the recommended star. The star is a claim
 * ("Kairo recommends this one"), so it needs real evidence behind it; the
 * row itself stays selectable either way.
 */
export const MIN_RECOMMENDATION_CONFIDENCE = 0.5;

function numericOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * A recommendation keeps its star / may be picked automatically when its
 * evidence confidence (the model's own, else the recommendation's) reaches
 * MIN_RECOMMENDATION_CONFIDENCE. No confidence field = legacy entry, kept.
 */
export function recommendationQualifies(model, recommendation) {
  const confidence = model?.confidence ?? recommendation?.confidence ?? null;
  return confidence == null || numericOr(confidence, 0) >= MIN_RECOMMENDATION_CONFIDENCE;
}

function isMeasured(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Valid confidence: a finite number in 0..1. Anything else is "no confidence", never a pass. */
function hasValidConfidence(model) {
  return isMeasured(model?.confidence) && model.confidence >= 0 && model.confidence <= 1;
}

/**
 * The analyst picker's MAIN view rule (one rule, no fit threshold): the
 * candidate is usable now (`available`), its access is verified, it has real
 * evidence for BOTH reasoning and coding, and its confidence is valid and
 * reaches MIN_RECOMMENDATION_CONFIDENCE. A measured 0 counts as evidence;
 * null/absent does not. Everything else that is still selectable belongs in
 * the manual alternatives view.
 *
 * @param {{available?: boolean, accessVerified?: boolean, confidence?: number, evidence?: {reasoning?: number|null, coding?: number|null}}|null|undefined} model
 */
export function qualifiesForMainView(model) {
  return model?.available === true
    && model?.accessVerified !== false
    && isMeasured(model?.evidence?.reasoning)
    && isMeasured(model?.evidence?.coding)
    && hasValidConfidence(model)
    && model.confidence >= MIN_RECOMMENDATION_CONFIDENCE;
}
