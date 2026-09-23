#!/usr/bin/env node
// Shadow-mode evaluator: compares TypeSafe Jev's effort classification
// (light/standard/heavy) against the local classifyEffort baseline over a
// labeled fixture, and emits a JSON report of agreements, disagreements,
// accuracy vs labels, confidence, latency, and tokens.
//
// LOCAL ANALYSIS ONLY — a Jev answer never changes routing, providers,
// models, permissions, or execution. The real run is MANUAL (task T4): export
// AI_GATEWAY_API_KEY (Vercel AI Gateway) or TYPESAFE_API_KEY (direct) in your
// shell (never paste it in chat or files) and run this script directly. Use
// --limit 1 for a one-case smoke run before the full fixture. Tests inject a
// transport and never touch the network.
//
// Every CLI report carries `provenance`: sha256 of the local router and the
// fixture, plus the Jev question, route, and model actually sent (null for a
// custom --transport, whose question is unknown here). Reports whose router
// hashes differ are different baselines and must not be compared as one.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyEffort } from "../../src/global/intelligence/execution-router.js";
import { createTypeSafeTransport, DEFAULT_MODEL, GATEWAY_BASE_URL, GATEWAY_MODEL, JEV_QUESTION } from "./typesafe-client.mjs";
import { ROUTER_PATH, sha256File } from "./provenance.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(HERE, "tasks.json");

/**
 * Pure comparison core, injectable for tests.
 * @param {{fixture: {clear: object[], ambiguous?: object[]}, jevClassify: (text: string) => Promise<{tier: string, confidence?: number|null, latencyMs?: number|null, usage?: object}>}} input
 */
export async function runEvaluation({ fixture, jevClassify }) {
  const clearRows = [];
  for (const task of fixture.clear) clearRows.push(await evalRow(task, jevClassify));
  const ambiguousRows = [];
  for (const task of fixture.ambiguous ?? []) ambiguousRows.push(await evalRow(task, jevClassify));
  const contrastRows = [];
  for (const task of fixture.contrast ?? []) contrastRows.push(await evalRow(task, jevClassify));
  return {
    generatedAt: new Date().toISOString(),
    // Fixture labels are human-judgment labels pending human review (T5) —
    // not verified ground truth. Read accuracy numbers accordingly.
    labels: "provisional",
    clear: { rows: clearRows, summary: summarize(clearRows) },
    ambiguous: {
      rows: ambiguousRows,
      note: "No expected tier — excluded from accuracy. Human review required.",
    },
    contrast: {
      rows: contrastRows,
      summary: summarizeContrast(contrastRows),
      note: "Paired cases; the local classifier answers standard for all by design. Read pair separation, not overall accuracy.",
    },
  };
}

async function evalRow(task, jevClassify) {
  const local = classifyEffort(task.text);
  const row = { id: task.id, text: task.text, language: task.language, local };
  if (task.expected) row.expected = task.expected;
  if (task.pair) row.pair = task.pair;
  if (task.note) row.note = task.note;
  try {
    const jev = await jevClassify(task.text);
    row.jev = jev.tier;
    row.confidence = jev.confidence ?? null;
    row.latencyMs = jev.latencyMs ?? null;
    row.tokens = jev.usage ? (jev.usage.inputTokens ?? 0) + (jev.usage.outputTokens ?? 0) : null;
    row.agree = row.jev === row.local;
  } catch (error) {
    // One bad Jev response must not kill the whole evaluation. Secret
    // redaction is the transport's job (the bundled client redacts the key
    // from every error it throws); here we only bound the stored message.
    row.jev = null;
    row.jevError = truncateError(error?.message ?? String(error));
    row.agree = null;
  }
  return row;
}

function truncateError(message, max = 200) {
  const text = String(message);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function summarize(rows) {
  const answered = rows.filter((row) => row.jev !== null);
  const agreements = answered.filter((row) => row.agree).length;
  const labeled = rows.filter((row) => row.expected);
  // Both classifiers are scored over the SAME cases — labeled rows where Jev
  // actually answered — so the comparison is fair. Failed answers are
  // reported explicitly, never silently dropped from the denominator.
  const scored = labeled.filter((row) => row.jev !== null);
  const failed = labeled.filter((row) => row.jev === null);
  const localCorrect = scored.filter((row) => row.local === row.expected).length;
  const jevCorrect = scored.filter((row) => row.jev === row.expected).length;
  return {
    total: rows.length,
    labeled: labeled.length,
    scored: scored.length,
    jevFailures: failed.length,
    jevFailureIds: failed.map((row) => row.id),
    agreements,
    agreementRate: answered.length ? agreements / answered.length : null,
    localAccuracy: scored.length ? localCorrect / scored.length : null,
    jevAccuracy: scored.length ? jevCorrect / scored.length : null,
    disagreements: answered.filter((row) => !row.agree).map((row) => row.id),
  };
}

/**
 * Groups rows by `pair`, keeping first-seen order. Map.groupBy would do this,
 * but it needs Node 21+ and CI still tests on Node 20.
 * @returns {Map<string, object[]>}
 */
export function groupByPair(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.pair)) groups.set(row.pair, []);
    groups.get(row.pair).push(row);
  }
  return groups;
}

// A pair is separated when BOTH of its cases get their (different) expected
// tier. Pairs with a failed Jev answer are unscored for both classifiers, the
// same fairness rule the clear summary applies to single cases.
function summarizeContrast(rows) {
  const byPair = [...groupByPair(rows)].map(([pair, pairRows]) => {
    const scored = pairRows.every((row) => row.jev !== null);
    return {
      pair,
      ids: pairRows.map((row) => row.id),
      jevSeparated: scored ? pairRows.every((row) => row.jev === row.expected) : null,
      localSeparated: scored ? pairRows.every((row) => row.local === row.expected) : null,
    };
  });
  const scoredPairs = byPair.filter((entry) => entry.jevSeparated !== null);
  const failed = rows.filter((row) => row.jev === null);
  return {
    pairs: byPair.length,
    pairsScored: scoredPairs.length,
    jevPairsSeparated: scoredPairs.filter((entry) => entry.jevSeparated).length,
    localPairsSeparated: scoredPairs.filter((entry) => entry.localSeparated).length,
    jevFailures: failed.length,
    jevFailureIds: failed.map((row) => row.id),
    byPair,
  };
}

async function resolveJevClassify(argv) {
  const transportPath = argValue(argv, "--transport");
  if (transportPath) {
    const module = await import(path.resolve(transportPath));
    const classify = module.classify ?? module.default;
    if (typeof classify !== "function") {
      throw new Error(`--transport module must export a classify function: ${transportPath}`);
    }
    return { classify, route: "custom-transport", model: null };
  }
  const { route, apiKey, baseUrl, model } = resolveTransportConfig(process.env);
  return { classify: createTypeSafeTransport({ apiKey, baseUrl, model }), route, model };
}

/**
 * What a report was produced with. A custom transport's question and model
 * are unknown here, so they are recorded as null — never assumed.
 */
export function buildProvenance({ routerSha256, fixtureSha256, route, model }) {
  const custom = route === "custom-transport";
  return {
    routerSha256,
    fixtureSha256,
    jevQuestion: custom ? null : JEV_QUESTION,
    route,
    model: custom ? null : model ?? DEFAULT_MODEL,
  };
}

/**
 * Picks the credential and endpoint from the environment. A Gateway key wins
 * when both are set: it cannot authenticate against api.typesafe.ai (that
 * mismatch caused the first T4 attempt's 401s), so it must never be sent there.
 */
export function resolveTransportConfig(env) {
  if (env.AI_GATEWAY_API_KEY) {
    return {
      route: "vercel-gateway",
      apiKey: env.AI_GATEWAY_API_KEY,
      baseUrl: GATEWAY_BASE_URL,
      model: GATEWAY_MODEL,
    };
  }
  if (env.TYPESAFE_API_KEY) {
    return {
      route: "typesafe-direct",
      apiKey: env.TYPESAFE_API_KEY,
      baseUrl: env.TYPESAFE_BASE_URL || undefined,
      model: undefined,
    };
  }
  throw new Error(
    "AI_GATEWAY_API_KEY or TYPESAFE_API_KEY is not set. The real run is MANUAL: " +
      "export the key in your shell (never paste it in chat or files) and re-run, " +
      "or pass --transport <module> for a mocked local evaluation."
  );
}

/**
 * Smoke-run slice: the first N clear cases, no ambiguous or contrast ones. A null limit
 * returns the fixture untouched.
 */
export function limitFixture(fixture, limit) {
  if (limit === null || limit === undefined) return fixture;
  const count = Number(limit);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`--limit must be a positive integer, got: ${limit}`);
  }
  return { clear: fixture.clear.slice(0, count), ambiguous: [], contrast: [] };
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? null : argv[index + 1] ?? null;
}

async function main() {
  const argv = process.argv.slice(2);
  const { classify: jevClassify, route, model } = await resolveJevClassify(argv);
  const limit = argValue(argv, "--limit");
  const fixture = limitFixture(JSON.parse(await readFile(FIXTURE_PATH, "utf8")), limit);
  const report = await runEvaluation({ fixture, jevClassify });
  // A smoke report must never be mistaken for the full T4 run.
  if (limit !== null) report.limit = Number(limit);
  report.provenance = buildProvenance({
    routerSha256: await sha256File(ROUTER_PATH),
    fixtureSha256: await sha256File(FIXTURE_PATH),
    route,
    model,
  });
  const json = JSON.stringify(report, null, 2) + "\n";
  const out = argValue(argv, "--out");
  if (out) await writeFile(path.resolve(out), json);
  else process.stdout.write(json);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
