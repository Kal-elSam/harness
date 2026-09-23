import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEvaluation, resolveTransportConfig, limitFixture, groupByPair, buildProvenance } from "../scripts/jev-shadow/evaluate.mjs";
import { createTypeSafeTransport, GATEWAY_BASE_URL, GATEWAY_MODEL, JEV_QUESTION } from "../scripts/jev-shadow/typesafe-client.mjs";
import { classifyEffort, classifyTask } from "../src/global/intelligence/execution-router.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "scripts", "jev-shadow", "evaluate.mjs");
const FIXTURE = path.join(HERE, "..", "scripts", "jev-shadow", "tasks.json");
const execFileAsync = promisify(execFile);

const CANARY_KEY = "tsk_CANARY_SECRET_123";

const fixture = {
  clear: [
    { id: "c1", text: "What does this project do?", language: "en", expected: "light" },
    { id: "c2", text: "Why does the auth token refresh fail under load?", language: "en", expected: "heavy" },
    { id: "c3", text: "¿Por qué se cae el servicio cuando hay mucha carga?", language: "es", expected: "heavy" },
  ],
  ambiguous: [
    { id: "a1", text: "Refactor the login form validation", language: "en", note: "size unknown" },
  ],
};

// Local baseline on this fixture: c1 light, c2 heavy (why does + auth),
// c3 light (Spanish reasoning with no local keyword in either language — the
// disagreement the pilot exists to measure), a1 heavy (refactor).
const canned = new Map([
  ["What does this project do?", { tier: "light", confidence: 0.98, latencyMs: 5, usage: { inputTokens: 10, outputTokens: 1 } }],
  ["Why does the auth token refresh fail under load?", { tier: "heavy", confidence: 0.91, latencyMs: 6, usage: { inputTokens: 12, outputTokens: 1 } }],
  ["¿Por qué se cae el servicio cuando hay mucha carga?", { tier: "heavy", confidence: 0.87, latencyMs: 7, usage: { inputTokens: 12, outputTokens: 1 } }],
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

test("HTTP errors surface the upstream error code and message, redacted and bounded", async () => {
  const failWith = (body) =>
    createTypeSafeTransport({
      apiKey: CANARY_KEY,
      fetchImpl: async () => ({ ok: false, status: 403, json: async () => body }),
    });

  // Gateway allowlist shape (vercel.com/docs/ai-gateway/security-and-compliance/model-allowlist).
  await assert.rejects(
    failWith({
      error: "Your team has restricted access to this model. Contact the owner of the account for more details.",
      type: "no_providers_available",
      statusCode: 403,
    })("x"),
    (error) => {
      assert.match(error.message, /status 403/);
      assert.match(error.message, /no_providers_available/);
      assert.match(error.message, /restricted access to this model/);
      return true;
    }
  );

  // TypeSafe error shape (vercel.com/docs/ai-gateway/sdks-and-apis/typesafe).
  await assert.rejects(
    failWith({ message: "questions.effort.type: expected one of 'noul', 'choice', 'score'", error_type: "invalid_request" })("x"),
    (error) => {
      assert.match(error.message, /invalid_request/);
      assert.match(error.message, /questions\.effort\.type/);
      return true;
    }
  );

  // Nested OpenAI-style shape.
  await assert.rejects(failWith({ error: { type: "forbidden", message: "nope" } })("x"), (error) => {
    assert.match(error.message, /forbidden: nope/);
    return true;
  });

  // An upstream that echoes the key in its error body must not leak it.
  await assert.rejects(failWith({ type: "auth", error: `bad key ${CANARY_KEY}` })("x"), (error) => {
    assert.ok(!error.message.includes(CANARY_KEY));
    assert.match(error.message, /\[redacted\]/);
    return true;
  });

  // Redact BEFORE truncating: a key straddling the cut must not leave a
  // partial secret that whole-key redaction can no longer match.
  for (let pad = 100; pad <= 125; pad++) {
    await assert.rejects(failWith({ type: "t", error: `${"p".repeat(pad)}${CANARY_KEY}` })("x"), (error) => {
      assert.ok(!error.message.includes(CANARY_KEY.slice(0, 6)), `partial key leaked at pad ${pad}`);
      return true;
    });
  }

  // Same rule on the unrecognized-tier path, which truncates the echoed choice.
  for (let pad = 60; pad <= 85; pad++) {
    const echoing = createTypeSafeTransport({
      apiKey: CANARY_KEY,
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => documentedResponse(`${"p".repeat(pad)}${CANARY_KEY}`) }),
    });
    await assert.rejects(echoing("x"), (error) => {
      assert.ok(!error.message.includes(CANARY_KEY.slice(0, 6)), `partial key leaked in tier echo at pad ${pad}`);
      return true;
    });
  }

  // Unreadable body: keep the bare status, never a parse crash.
  await assert.rejects(failWith(Promise.reject(new Error("bad json")))("x"), (error) => {
    assert.equal(error.message, "TypeSafe request failed with status 403");
    return true;
  });

  // Long upstream messages stay bounded so the report stays readable.
  await assert.rejects(failWith({ type: "x", error: "y".repeat(1000) })("x"), (error) => {
    assert.ok(error.message.length < 200, `too long: ${error.message.length}`);
    return true;
  });
});

test("rate limits (429/529) are transport failures, never classification errors", async () => {
  // User decision for T4: no automatic retries. A rate-limited case stays a
  // transport failure — excluded from BOTH accuracy denominators, reported in
  // jevFailures — and the batch is not relaunched immediately (TypeSafe asks
  // for exponential backoff when retrying).
  for (const status of [429, 529]) {
    const classify = createTypeSafeTransport({
      apiKey: CANARY_KEY,
      fetchImpl: async () => ({ ok: false, status }),
    });
    await assert.rejects(classify("x"), (error) => {
      assert.match(error.message, new RegExp(`status ${status}`));
      assert.ok(!error.message.includes(CANARY_KEY));
      return true;
    });
  }

  const rateLimited = async () => {
    throw new Error("TypeSafe request failed with status 429");
  };
  const { summary, rows } = (await runEvaluation({ fixture, jevClassify: rateLimited })).clear;
  for (const row of rows) {
    assert.equal(row.jev, null); // never a fabricated tier
    assert.match(row.jevError, /status 429/);
  }
  assert.equal(summary.jevFailures, 3);
  assert.deepEqual(summary.jevFailureIds, ["c1", "c2", "c3"]);
  assert.equal(summary.scored, 0);
  assert.equal(summary.localAccuracy, null);
  assert.equal(summary.jevAccuracy, null);
});

test("client routes through Vercel AI Gateway with the gateway model id", async () => {
  // Contract: vercel.com/docs/ai-gateway/sdks-and-apis/typesafe — same
  // request/response shape, base URL https://ai-gateway.vercel.sh/typesafe.
  let captured;
  const fetchImpl = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200, json: async () => documentedResponse("light", 0.9) };
  };
  const classify = createTypeSafeTransport({
    apiKey: CANARY_KEY,
    baseUrl: GATEWAY_BASE_URL,
    model: GATEWAY_MODEL,
    fetchImpl,
  });
  const result = await classify("Rename this variable");

  assert.equal(captured.url, "https://ai-gateway.vercel.sh/typesafe/v1/systemone");
  assert.equal(captured.init.headers.authorization, `Bearer ${CANARY_KEY}`);
  assert.equal(JSON.parse(captured.init.body).model, "typesafe-ai/jev");
  assert.equal(result.tier, "light");
});

test("transport config: gateway key wins, direct key keeps the direct contract, none fails closed", () => {
  const gateway = resolveTransportConfig({ AI_GATEWAY_API_KEY: CANARY_KEY, TYPESAFE_API_KEY: "other" });
  assert.deepEqual(gateway, {
    route: "vercel-gateway",
    apiKey: CANARY_KEY,
    baseUrl: "https://ai-gateway.vercel.sh/typesafe",
    model: "typesafe-ai/jev",
  });

  const direct = resolveTransportConfig({ TYPESAFE_API_KEY: CANARY_KEY });
  assert.equal(direct.route, "typesafe-direct");
  assert.equal(direct.apiKey, CANARY_KEY);
  assert.equal(direct.baseUrl, undefined);
  assert.equal(direct.model, undefined);

  assert.throws(() => resolveTransportConfig({}), (error) => {
    assert.match(error.message, /AI_GATEWAY_API_KEY/);
    assert.match(error.message, /TYPESAFE_API_KEY/);
    return true;
  });
});

test("--limit keeps the first N clear cases and drops ambiguous and contrast ones for a smoke run", () => {
  const limited = limitFixture({ ...fixture, contrast: [{ id: "x", pair: "p", text: "t", expected: "light" }] }, 1);
  assert.deepEqual(limited.clear.map((task) => task.id), ["c1"]);
  assert.deepEqual(limited.ambiguous, []);
  assert.deepEqual(limited.contrast, []);
  assert.equal(limitFixture(fixture, null), fixture);
  for (const bad of ["0", "-1", "abc", "1.5"]) {
    assert.throws(() => limitFixture(fixture, bad), /--limit/);
  }
});

test("CLI without any API key fails closed with the manual-run message (no network)", async () => {
  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  delete env.AI_GATEWAY_API_KEY;
  await assert.rejects(execFileAsync("node", [CLI], { env }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /AI_GATEWAY_API_KEY or TYPESAFE_API_KEY is not set/);
    assert.match(error.stderr, /MANUAL/);
    return true;
  });
});

test("contrast cases are summarized by pair separation, separately from clear cases", async () => {
  const contrastFixture = {
    clear: [],
    contrast: [
      { id: "p1-light", pair: "p1", text: "p1 light", language: "en", expected: "light" },
      { id: "p1-standard", pair: "p1", text: "p1 standard", language: "en", expected: "standard" },
      { id: "p2-standard", pair: "p2", text: "p2 standard", language: "es", expected: "standard" },
      { id: "p2-heavy", pair: "p2", text: "p2 heavy", language: "es", expected: "heavy" },
      { id: "p3-standard", pair: "p3", text: "p3 standard", language: "en", expected: "standard" },
      { id: "p3-heavy", pair: "p3", text: "p3 heavy", language: "en", expected: "heavy" },
    ],
  };
  // p1 separated correctly; p2 collapsed to one tier; p3 has a transport failure.
  const answers = { "p1 light": "light", "p1 standard": "standard", "p2 standard": "standard", "p2 heavy": "standard", "p3 standard": "standard" };
  const jevClassify = async (text) => {
    if (!(text in answers)) throw new Error("TypeSafe request failed with status 500");
    return { tier: answers[text], confidence: 0.5, latencyMs: 1, usage: { inputTokens: 1, outputTokens: 0 } };
  };

  const report = await runEvaluation({ fixture: contrastFixture, jevClassify });
  assert.equal(report.clear.rows.length, 0);
  assert.equal(report.contrast.rows.length, 6);
  assert.equal(report.contrast.rows[0].pair, "p1");
  const { summary } = report.contrast;
  assert.equal(summary.pairs, 3);
  assert.equal(summary.pairsScored, 2); // p3 excluded: one side never answered
  assert.equal(summary.jevPairsSeparated, 1);
  assert.deepEqual(summary.jevFailureIds, ["p3-heavy"]);
  assert.deepEqual(
    summary.byPair.map(({ pair, jevSeparated }) => [pair, jevSeparated]),
    [["p1", true], ["p2", false], ["p3", null]]
  );
  // Local separation is computed over the same scored pairs, never over p3.
  assert.equal(typeof summary.localPairsSeparated, "number");
  assert.equal(summary.byPair.find((entry) => entry.pair === "p3").localSeparated, null);
  assert.match(report.contrast.note, /pair/i);
});

test("real contrast fixture: paired, single-language, and length never decides a pair", async () => {
  const data = JSON.parse(await readFile(FIXTURE, "utf8"));
  assert.equal(data.contrast.length, 8);
  const pairs = groupByPair(data.contrast);
  assert.equal(pairs.size, 4);
  for (const [pair, tasks] of pairs) {
    assert.equal(tasks.length, 2, pair);
    assert.notEqual(tasks[0].expected, tasks[1].expected, `${pair}: labels must differ`);
    assert.equal(tasks[0].language, tasks[1].language, `${pair}: one language per pair`);
    // Both cases sit on the same side of the local 100-char light threshold.
    assert.equal(tasks[0].text.length > 100, tasks[1].text.length > 100, `${pair}: length straddles the threshold`);
  }
  for (const lang of ["es", "en"]) {
    assert.ok(data.contrast.some((task) => task.language === lang), `contrast missing ${lang}`);
  }
});

test("contrast set under the CURRENT router: only the recovery-code cases are local keyword hits", async () => {
  // The "8/8 local standard, zero keyword hits" control held for the router
  // before the Spanish risk fix (main b3e2725). Since #341 (5fc1c29)
  // es-contrast-heavy-2 hits "codigo de recuperacion"; since #342 (1b27571)
  // en-contrast-heavy-2 hits "recovery code". Both are heavy, so the local
  // classifier now separates both storage pairs. Reports record routerSha256
  // so runs from different routers are never compared as one baseline.
  const data = JSON.parse(await readFile(FIXTURE, "utf8"));
  const expectedLocal = {
    "es-contrast-heavy-2": { tier: "heavy", hits: ["codigo de recuperacion"] },
    "en-contrast-heavy-2": { tier: "heavy", hits: ["recovery code"] },
  };
  for (const task of data.contrast) {
    const profile = classifyTask(task.text);
    const hits = [...profile.repetitive, ...profile.reasoning, ...profile.multiFile, ...profile.risk];
    const expected = expectedLocal[task.id] ?? { tier: "standard", hits: [] };
    assert.deepEqual(hits, expected.hits, task.id);
    assert.equal(classifyEffort(task.text), expected.tier, task.id);
  }
});

test("CLI report records provenance: router and fixture hashes, Jev question, route", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "jev-prov-"));
  const stub = path.join(dir, "stub.mjs");
  await writeFile(stub, 'export const classify = async () => ({ tier: "standard", confidence: 0.5, latencyMs: 1, usage: { inputTokens: 1, outputTokens: 0 } });\n');
  const { stdout } = await execFileAsync("node", [CLI, "--transport", stub, "--limit", "1"]);
  const report = JSON.parse(stdout);
  const sha = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
  const ROUTER = path.join(HERE, "..", "src", "global", "intelligence", "execution-router.js");
  assert.deepEqual(report.provenance, {
    routerSha256: await sha(ROUTER),
    fixtureSha256: await sha(FIXTURE),
    // A custom transport's question is unknown to the evaluator: recorded as
    // null, never assumed to be the bundled client's question.
    jevQuestion: null,
    route: "custom-transport",
    model: null,
  });
});

test("provenance for the real routes records the exact Jev question and model sent", () => {
  const hashes = { routerSha256: "r".repeat(64), fixtureSha256: "f".repeat(64) };
  assert.deepEqual(buildProvenance({ ...hashes, route: "vercel-gateway", model: GATEWAY_MODEL }), {
    ...hashes,
    jevQuestion: JEV_QUESTION,
    route: "vercel-gateway",
    model: "typesafe-ai/jev",
  });
  // The direct route leaves model unset; the client's default is what is sent.
  assert.equal(buildProvenance({ ...hashes, route: "typesafe-direct", model: undefined }).model, "jev-latest");
  assert.equal(JEV_QUESTION.type, "choice");
  assert.deepEqual(Object.keys(JEV_QUESTION.criteria).sort(), ["heavy", "light", "standard"]);
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
