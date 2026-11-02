// Frozen AA reference: current first-party generalist coding families from
// OpenAI, Anthropic and Google, one default/highest-effort catalog identity per
// family. Includes providers absent from the configured team. No quota, price,
// entitlement, or live catalog determines membership. Updating the cohort or
// evidence requires a new version; scores are the normalized AA cache values.
export const FRONTIER_REFERENCE = Object.freeze({
  version: "aa-generalist-2026-10-29/v1",
  fetchedAt: "2026-10-29T17:05:02.316Z",
  metric: "intelligenceIndex",
  quantile: 0.75,
  // Nearest-rank Q3; ties at the boundary are included.
  pool: Object.freeze([
  {
    "slug": "gpt-6-astra",
    "intelligenceIndex": 56.9
  },
  {
    "slug": "gpt-6-1-sol",
    "intelligenceIndex": 54.5
  },
  {
    "slug": "gpt-6-1-terra",
    "intelligenceIndex": 51
  },
  {
    "slug": "gpt-6-luna",
    "intelligenceIndex": 27.8
  },
  {
    "slug": "claude-opus-5-5",
    "intelligenceIndex": 58.4
  },
  {
    "slug": "claude-sonnet-5-5",
    "intelligenceIndex": 54.2
  },
  {
    "slug": "claude-fable-5-1",
    "intelligenceIndex": 49
  },
  {
    "slug": "claude-haiku-5-5",
    "intelligenceIndex": 36.2
  },
  {
    "slug": "gemini-4-carbon",
    "intelligenceIndex": 59.4
  },
  {
    "slug": "gemini-4-argon",
    "intelligenceIndex": 50.4
  },
  {
    "slug": "gemini-3-8-flash",
    "intelligenceIndex": 30.5
  },
  {
    "slug": "gemini-3-5-flash-lite",
    "intelligenceIndex": 11.7
  }
].map(Object.freeze))
});
const values = FRONTIER_REFERENCE.pool.map(row => row.intelligenceIndex).sort((a, b) => a - b);
export const FRONTIER_CUTOFF = values[Math.ceil(values.length * FRONTIER_REFERENCE.quantile) - 1];

/** Classify normalized AA intelligence evidence, never a price or a model name. */
export function frontierEvidence(model) {
  const value = model?.intelligenceIndex;
  const verified = model?.evidenceStatus !== "unscored" && Number.isFinite(value) && value >= 0;
  return { version: FRONTIER_REFERENCE.version, cutoff: FRONTIER_CUTOFF,
    status: verified ? (value >= FRONTIER_CUTOFF ? "frontier" : "non_frontier") : "capability_unverified" };
}
