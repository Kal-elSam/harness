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
