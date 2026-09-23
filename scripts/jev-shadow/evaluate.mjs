#!/usr/bin/env node
// Shadow-mode evaluator: compares TypeSafe Jev's effort classification
// (light/standard/heavy) against the local classifyEffort baseline over a
// labeled fixture, and emits a JSON report of agreements, disagreements,
// accuracy vs labels, confidence, latency, and tokens.
//
// LOCAL ANALYSIS ONLY — a Jev answer never changes routing, providers,
// models, permissions, or execution. The real run against api.typesafe.ai is
// MANUAL (task T4): export TYPESAFE_API_KEY in your shell (never paste it in
// chat or files) and run this script directly. Tests inject a transport and
// never touch the network.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classifyEffort } from "../../src/global/intelligence/execution-router.js";
import { createTypeSafeTransport } from "./typesafe-client.mjs";

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
  };
}

async function evalRow(task, jevClassify) {
  const local = classifyEffort(task.text);
  const row = { id: task.id, text: task.text, language: task.language, local };
  if (task.expected) row.expected = task.expected;
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

async function resolveJevClassify(argv) {
  const transportPath = argValue(argv, "--transport");
  if (transportPath) {
    const module = await import(path.resolve(transportPath));
    const classify = module.classify ?? module.default;
    if (typeof classify !== "function") {
      throw new Error(`--transport module must export a classify function: ${transportPath}`);
    }
    return classify;
  }
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "TYPESAFE_API_KEY is not set. The real run against api.typesafe.ai is MANUAL: " +
        "export the key in your shell (never paste it in chat or files) and re-run, " +
        "or pass --transport <module> for a mocked local evaluation."
    );
  }
  return createTypeSafeTransport({ apiKey, baseUrl: process.env.TYPESAFE_BASE_URL || undefined });
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? null : argv[index + 1] ?? null;
}

async function main() {
  const argv = process.argv.slice(2);
  const jevClassify = await resolveJevClassify(argv);
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  const report = await runEvaluation({ fixture, jevClassify });
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
