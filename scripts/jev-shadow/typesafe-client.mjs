// Thin TypeSafe API client for the Jev shadow evaluator, aligned with the
// published HTTP contract (verified 2026-09-23 against docs.typesafe.ai/api):
//
//   POST https://api.typesafe.ai/v1/systemone
//   { state, model, questions: { <id>: { type: "choice", instructions, criteria } } }
//   -> { model, answers: { <id>: { type, choice, probabilities, confidence } }, usage }
//
// The same contract is served by Vercel AI Gateway (verified 2026-09-23
// against vercel.com/docs/ai-gateway/sdks-and-apis/typesafe): base URL
// https://ai-gateway.vercel.sh/typesafe, Gateway API key as Bearer token, and
// model "typesafe-ai/jev". Request and response shapes are unchanged.
//
// Used ONLY by the manual real run (T4) — tests inject their own fetch and
// never touch the network. The API key arrives as a parameter, is sent once
// as a Bearer header, and is never logged, persisted, or included in errors.
//
// T4 note: the documented contract asks for exponential backoff on 429/529.
// This client deliberately does not retry — re-run the script manually if
// rate-limited, or switch to the official @typesafe-ai/sdk (retries built in).
const DEFAULT_BASE_URL = "https://api.typesafe.ai";
const SYSTEMONE_PATH = "/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
export const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/typesafe";
export const GATEWAY_MODEL = "typesafe-ai/jev";
const QUESTION_ID = "effort";

const EFFORT_TIERS = ["light", "standard", "heavy"];

const EFFORT_INSTRUCTIONS = "Classify how much model capability this software task needs.";

const EFFORT_CRITERIA = {
  light: "Trivial mechanical edit or simple question.",
  standard: "Ordinary, well-understood work.",
  heavy: "Reasoning-heavy, risky, or cross-cutting work.",
};

/**
 * @param {{apiKey: string, baseUrl?: string, model?: string, fetchImpl?: Function}} options
 * @returns {(taskText: string) => Promise<{tier: string, confidence: number|null, latencyMs: number, usage: {inputTokens: number|null, outputTokens: number|null}}>}
 */
export function createTypeSafeTransport({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  model = DEFAULT_MODEL,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error("apiKey is required");
  return async function classify(taskText) {
    const startedAt = performance.now();
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${SYSTEMONE_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // The key leaves the process exactly here, in this header only.
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          state: taskText,
          model,
          questions: {
            [QUESTION_ID]: {
              type: "choice",
              instructions: EFFORT_INSTRUCTIONS,
              criteria: EFFORT_CRITERIA,
            },
          },
        }),
      });
    } catch (error) {
      // A fetch/proxy failure can echo request details — redact before rethrow.
      throw safeError(`TypeSafe request failed: ${error?.message ?? error}`, apiKey);
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    if (!response.ok) {
      // Never echo the key, headers, or request body — only the upstream's own
      // error code and message, redacted and bounded, so a 403 explains itself.
      const detail = await readErrorDetail(response, apiKey);
      const suffix = detail ? ` (${detail})` : "";
      throw safeError(`TypeSafe request failed with status ${response.status}${suffix}`, apiKey);
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("TypeSafe returned a non-JSON response");
    }
    return normalizeAnswer(data, latencyMs, apiKey);
  };
}

function normalizeAnswer(data, latencyMs, apiKey) {
  const answer = data?.answers?.[QUESTION_ID];
  const tier = String(answer?.choice ?? "").toLowerCase();
  if (!EFFORT_TIERS.includes(tier)) {
    throw new Error(`TypeSafe returned an unrecognized tier: ${redactThenTruncate(JSON.stringify(answer?.choice), apiKey)}`);
  }
  return {
    tier,
    confidence: typeof answer?.confidence === "number" ? answer.confidence : null,
    latencyMs,
    usage: {
      inputTokens: data?.usage?.input_tokens ?? null,
      outputTokens: data?.usage?.output_tokens ?? null,
    },
  };
}

// Reads the documented error shapes: Gateway `{ error, type }`, TypeSafe
// `{ message, error_type }`, and nested `{ error: { type, message } }`. Any
// unreadable body yields null so the bare status is still reported.
async function readErrorDetail(response, apiKey) {
  let body;
  try {
    body = await response.json?.();
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const nested = body.error && typeof body.error === "object" ? body.error : null;
  const code = body.type ?? body.error_type ?? nested?.type ?? nested?.code;
  const message = nested ? nested.message : body.error ?? body.message;
  const parts = [code, message].filter((part) => typeof part === "string" && part.length > 0);
  return parts.length ? redactThenTruncate(parts.join(": "), apiKey, 120) : null;
}

// Every error this client throws passes through here: the key is redacted
// even if a lower layer (fetch, proxy, response echo) leaked it.
function safeError(message, apiKey) {
  return new Error(redact(message, apiKey));
}

function redact(value, apiKey) {
  return String(value ?? "").split(apiKey).join("[redacted]");
}

// Upstream text is redacted BEFORE truncation: cutting first could leave a
// partial key that whole-key redaction no longer matches.
function redactThenTruncate(value, apiKey, max) {
  return truncate(redact(value, apiKey), max);
}

function truncate(value, max = 80) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
