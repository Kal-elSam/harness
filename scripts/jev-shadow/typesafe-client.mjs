// Thin TypeSafe API client for the Jev shadow evaluator. Used ONLY by the
// manual real run (T4) — tests inject their own fetch and never touch the
// network. The API key arrives as a parameter, is sent once as a Bearer
// header, and is never logged, persisted, or included in errors.
//
// VERIFY against TypeSafe docs before the first real run (T4): the endpoint
// path and the request/response shapes below are UNVERIFIED assumptions based
// on the pilot plan's "Choice question" description. Override the base URL
// via the TYPESAFE_BASE_URL env var if the real deployment differs.
const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const CHOICE_PATH = "/v1/choice"; // VERIFY (T4)

const EFFORT_TIERS = ["light", "standard", "heavy"];

const EFFORT_QUESTION =
  "Classify how much model capability this software task needs. " +
  "'light' = trivial mechanical edit or simple question; " +
  "'standard' = ordinary, well-understood work; " +
  "'heavy' = reasoning-heavy, risky, or cross-cutting work.";

/**
 * @param {{apiKey: string, baseUrl?: string, fetchImpl?: Function}} options
 * @returns {(taskText: string) => Promise<{tier: string, confidence: number|null, latencyMs: number, usage: {inputTokens: number|null, outputTokens: number|null}}>}
 */
export function createTypeSafeTransport({ apiKey, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("apiKey is required");
  return async function classify(taskText) {
    const startedAt = performance.now();
    const response = await fetchImpl(`${baseUrl}${CHOICE_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The key leaves the process exactly here, in this header only.
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // VERIFY (T4): assumed Choice-question payload shape.
        question: EFFORT_QUESTION,
        choices: EFFORT_TIERS,
        input: taskText,
      }),
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    if (!response.ok) {
      // Deliberately generic: never echo the key, headers, or request body.
      throw new Error(`TypeSafe request failed with status ${response.status}`);
    }
    const data = await response.json();
    return normalizeChoice(data, latencyMs);
  };
}

function normalizeChoice(data, latencyMs) {
  // VERIFY (T4): assumed response shape { choice, confidence, usage }.
  const tier = String(data?.choice ?? "").toLowerCase();
  if (!EFFORT_TIERS.includes(tier)) {
    throw new Error(`TypeSafe returned an unrecognized tier: ${JSON.stringify(data?.choice)}`);
  }
  return {
    tier,
    confidence: typeof data?.confidence === "number" ? data.confidence : null,
    latencyMs,
    usage: {
      inputTokens: data?.usage?.input_tokens ?? null,
      outputTokens: data?.usage?.output_tokens ?? null,
    },
  };
}
