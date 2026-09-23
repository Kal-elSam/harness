import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEvaluation } from "../scripts/jev-shadow/evaluate.mjs";
import { createTypeSafeTransport } from "../scripts/jev-shadow/typesafe-client.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "scripts", "jev-shadow", "evaluate.mjs");
const FIXTURE = path.join(HERE, "..", "scripts", "jev-shadow", "tasks.json");
const execFileAsync = promisify(execFile);

const CANARY_KEY = "tsk_CANARY_SECRET_123";

const fixture = {
  clear: [
    { id: "c1", text: "What does this project do?", language: "en", expected: "light" },
    { id: "c2", text: "Why does the auth token refresh fail under load?", language: "en", expected: "heavy" },
    { id: "c3", text: "¿Por qué falla la autenticación cuando hay mucha carga?", language: "es", expected: "heavy" },
  ],
  ambiguous: [
    { id: "a1", text: "Refactor the login form validation", language: "en", note: "size unknown" },
  ],
};

// Local baseline on this fixture: c1 light, c2 heavy (why does + auth),
// c3 light (Spanish text matches no English keyword — the disagreement the
// pilot exists to measure), a1 heavy (refactor).
const canned = new Map([
  ["What does this project do?", { tier: "light", confidence: 0.98, latencyMs: 5, usage: { inputTokens: 10, outputTokens: 1 } }],
  ["Why does the auth token refresh fail under load?", { tier: "heavy", confidence: 0.91, latencyMs: 6, usage: { inputTokens: 12, outputTokens: 1 } }],
  ["¿Por qué falla la autenticación cuando hay mucha carga?", { tier: "heavy", confidence: 0.87, latencyMs: 7, usage: { inputTokens: 12, outputTokens: 1 } }],
  ["Refactor the login form validation", { tier: "standard", confidence: 0.55, latencyMs: 5, usage: { inputTokens: 9, outputTokens: 1 } }],
]);

const mockClassify = async (text) => {
  const found = canned.get(text);
  if (!found) throw new Error(`no canned response for: ${text}`);
  return found;
};

// The documented TypeSafe response shape (docs.typesafe.ai/api):
// { model, answers: { <id>: { type, choice, probabilities, confidence } }, usage }
const documentedResponse = (choice, confidence = 0.9) => ({
  model: "jev-latest",
  answers: {
    effort: {
      type: "choice",
      choice,
      probabilities: { light: 0.05, standard: 0.1, heavy: 0.85 },
      confidence,
    },
  },
  usage: { input_tokens: 312, output_tokens: 48 },
});

test("report shape: rows carry local + jev tiers, confidence, latency, tokens, agreement", async () => {
  const report = await runEvaluation({ fixture, jevClassify: mockClassify });
  assert.equal(report.clear.rows.length, 3);
  const c3 = report.clear.rows.find((row) => row.id === "c3");
  assert.equal(c3.local, "light");
  assert.equal(c3.jev, "heavy");
  assert.equal(c3.agree, false);
  assert.equal(c3.confidence, 0.87);
  assert.equal(c3.latencyMs, 7);
  assert.equal(c3.tokens, 13);
});

test("labels are reported as provisional until human review", async () => {
  const report = await runEvaluation({ fixture, jevClassify: mockClassify });
  assert.equal(report.labels, "provisional");
});

test("summary: both accuracies over the SAME scored cases, disagreements listed", async () => {
  const { summary } = (await runEvaluation({ fixture, jevClassify: mockClassify })).clear;
  assert.equal(summary.total, 3);
  assert.equal(summary.labeled, 3);
  assert.equal(summary.scored, 3);
  assert.equal(summary.jevFailures, 0);
  assert.deepEqual(summary.jevFailureIds, []);
  assert.equal(summary.agreements, 2);
  assert.equal(summary.agreementRate, 2 / 3);
  assert.equal(summary.localAccuracy, 2 / 3); // c3 is the local rule's Spanish miss
  assert.equal(summary.jevAccuracy, 1);
  assert.deepEqual(summary.disagreements, ["c3"]);
});

test("ambiguous cases are reported separately and excluded from accuracy", async () => {
  const report = await runEvaluation({ fixture, jevClassify: mockClassify });
  assert.equal(report.ambiguous.rows.length, 1);
  assert.equal(report.ambiguous.rows[0].expected, undefined);
  assert.match(report.ambiguous.note, /excluded from accuracy/);
  assert.equal(report.clear.summary.labeled, 3); // a1 never leaks into the scored set
});

test("a failing Jev response shrinks the scored set for BOTH accuracies and is reported", async () => {
  const flaky = async (text) => {
    if (text === fixture.clear[0].text) throw new Error("TypeSafe request failed with status 500");
    return canned.get(text);
  };
  const { summary, rows } = (await runEvaluation({ fixture, jevClassify: flaky })).clear;
  const failed = rows.find((row) => row.id === "c1");
  assert.equal(failed.jev, null);
  assert.equal(failed.agree, null);
  assert.match(failed.jevError, /status 500/);
  assert.equal(summary.jevFailures, 1);
  assert.deepEqual(summary.jevFailureIds, ["c1"]);
  assert.equal(summary.scored, 2); // c1 excluded from BOTH denominators
  assert.equal(summary.agreementRate, 1 / 2);
  assert.equal(summary.localAccuracy, 1 / 2); // c2 correct, c3 the Spanish miss
  assert.equal(summary.jevAccuracy, 1);
});

test("stored transport errors are truncated to a bounded length", async () => {
  const noisy = async () => {
    throw new Error("x".repeat(500));
  };
  const { rows } = (await runEvaluation({ fixture, jevClassify: noisy })).clear;
  for (const row of rows) {
    assert.ok(row.jevError.length <= 201, `jevError length ${row.jevError.length}`);
    assert.ok(row.jevError.endsWith("…"));
  }
});

test("client posts the documented contract to the exact systemone URL", async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, json: async () => documentedResponse("heavy", 0.596) };
  };
  const classify = createTypeSafeTransport({ apiKey: CANARY_KEY, fetchImpl });
  const result = await classify("Investigate the race condition in the payment webhook handler");

  assert.equal(captured.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.authorization, `Bearer ${CANARY_KEY}`);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, "jev-latest");
  assert.equal(body.state, "Investigate the race condition in the payment webhook handler");
  assert.equal(body.questions.effort.type, "choice");
  assert.equal(typeof body.questions.effort.instructions, "string");
  assert.deepEqual(Object.keys(body.questions.effort.criteria).sort(), ["heavy", "light", "standard"]);

  assert.equal(result.tier, "heavy");
  assert.equal(result.confidence, 0.596);
  assert.equal(result.usage.inputTokens, 312);
  assert.equal(result.usage.outputTokens, 48);
  assert.ok(!JSON.stringify(result).includes(CANARY_KEY));
});

test("client errors never contain the key — status, tier echo, fetch rejection, non-JSON", async () => {
  const unauthorized = createTypeSafeTransport({
    apiKey: CANARY_KEY,
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  await assert.rejects(unauthorized("x"), (error) => {
    assert.match(error.message, /status 401/);
    assert.ok(!error.message.includes(CANARY_KEY));
    return true;
  });

  const weirdTier = createTypeSafeTransport({
    apiKey: CANARY_KEY,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => documentedResponse("purple") }),
  });
  await assert.rejects(weirdTier("x"), (error) => {
    assert.match(error.message, /purple/);
    assert.ok(!error.message.includes(CANARY_KEY));
    return true;
  });

  // A hostile/buggy upstream could echo the key inside the choice value or a
  // fetch error message — the client must redact it on every path.
  const echoingTier = createTypeSafeTransport({
    apiKey: CANARY_KEY,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => documentedResponse(`leak:${CANARY_KEY}`) }),
  });
  await assert.rejects(echoingTier("x"), (error) => {
    assert.ok(!error.message.includes(CANARY_KEY));
    assert.match(error.message, /\[redacted\]/);
    return true;
  });

  const echoingFetch = createTypeSafeTransport({
    apiKey: CANARY_KEY,
    fetchImpl: async () => {
      throw new Error(`proxy echoed authorization: Bearer ${CANARY_KEY}`);
    },
  });
  await assert.rejects(echoingFetch("x"), (error) => {
    assert.ok(!error.message.includes(CANARY_KEY));
    assert.match(error.message, /\[redacted\]/);
    return true;
  });

  const nonJson = createTypeSafeTransport({
    apiKey: CANARY_KEY,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => Promise.reject(new Error("bad json")) }),
  });
  await assert.rejects(nonJson("x"), (error) => {
    assert.match(error.message, /non-JSON/);
    assert.ok(!error.message.includes(CANARY_KEY));
    return true;
  });
});

test("CLI without TYPESAFE_API_KEY fails closed with the manual-run message (no network)", async () => {
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  await assert.rejects(execFileAsync("node", [CLI], { env }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /TYPESAFE_API_KEY is not set/);
    assert.match(error.stderr, /MANUAL/);
    return true;
  });
});

test("real fixture: shape, sizes, language mix, and provisional-labels wording", async () => {
  const data = JSON.parse(await readFile(FIXTURE, "utf8"));
  assert.match(data.description, /PROVISIONAL/i);
  assert.ok(data.clear.length >= 12 && data.clear.length <= 18, `clear: ${data.clear.length}`);
  assert.ok(data.ambiguous.length >= 4 && data.ambiguous.length <= 6, `ambiguous: ${data.ambiguous.length}`);
  for (const task of data.clear) {
    assert.ok(["light", "standard", "heavy"].includes(task.expected), task.id);
    assert.ok(["es", "en"].includes(task.language), task.id);
  }
  for (const task of data.ambiguous) assert.equal(task.expected, undefined, task.id);
  for (const lang of ["es", "en"]) {
    assert.ok(data.clear.some((task) => task.language === lang), `clear missing ${lang}`);
    assert.ok(data.ambiguous.some((task) => task.language === lang), `ambiguous missing ${lang}`);
  }
});
