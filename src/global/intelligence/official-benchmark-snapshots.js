// Manufacturer-published benchmark snapshots — deliberately NOT a live API
// (OpenAI/Anthropic don't expose one; their comparison tables are static
// blog posts). Hand-curated and versioned instead, refreshed only when a
// vendor publishes a new one. This is the source that finally gives Codex
// and Claude real cross-vendor evidence — Hugging Face's leaderboards have
// zero coverage of either (verified separately; see
// model-capability-registry-sources.js's HF comment), since neither is
// hosted on the HF Hub.
//
// Hard rule, per explicit decision: manufacturer-reported is never treated
// as independent. Every entry here is `verified: false` in the registry —
// OpenAI grading its own model against a competitor's public score is real
// data worth keeping, but it is not the same epistemic weight as an
// independently-run, third-party eval. Provenance (source, published date,
// exact benchmark version, and the vendor's own methodology caveat) is
// kept alongside every number specifically so this distinction survives
// into anything built on top of it.

/**
 * Each entry is one benchmark's real, cross-vendor comparison table as
 * published by ONE vendor at ONE point in time. `caveat` is the vendor's
 * own stated methodology note — never omitted, since it changes how much
 * weight the number deserves (e.g. "safeguards can zero out a task").
 * Values below were verified directly (Anthropic's page, fetched live) or
 * cross-checked against multiple independent third-party sources (OpenAI's
 * page blocks direct fetches; corroborated via Vellum, llm-stats, and
 * Artificial Analysis's own coverage of the same launch) — not copied
 * from a single unverified paste.
 */
export const OFFICIAL_BENCHMARK_SNAPSHOTS = [
  {
    source: "openai-official",
    url: "https://openai.com/index/gpt-6-astra/",
    published: "2026-09-03",
    benchmark: "terminal-bench", benchmarkVersion: "4.0",
    // Corrected from an earlier 57.7 (a transcription error introduced by
    // paraphrasing a search summary instead of the source) after
    // cross-checking multiple independent citations of OpenAI's own
    // launch page. Other real numbers exist for other configs — Astra at
    // "xhigh"/"max" reasoning effort, and Artificial Analysis's own
    // independently-measured snapshot — but those are different real
    // measurements, not this one; they belong in their own entries if
    // ever added, never blended into this vendor's reported baseline.
    caveat: "OpenAI's own reported results, run at maximum reasoning effort in an environment that may differ from production.",
    scores: [
      { adapterId: "codex", modelId: "gpt-6-astra", value: 57.9 },
      { adapterId: "codex", modelId: "gpt-5.6-sol", value: 37.3 },
      { adapterId: "claude", modelId: "claude-fable-5-1", value: 55.8 }
    ]
  },
  {
    source: "openai-official",
    url: "https://openai.com/index/gpt-6-astra/",
    published: "2026-09-03",
    benchmark: "gpqa-diamond", benchmarkVersion: null,
    caveat: "OpenAI's own reported results, run at maximum reasoning effort in an environment that may differ from production.",
    scores: [
      { adapterId: "codex", modelId: "gpt-6-astra", value: 96.0 },
      { adapterId: "codex", modelId: "gpt-5.6-sol", value: 94.6 }
    ]
  },
  {
    source: "anthropic-official",
    url: "https://www.anthropic.com/claude-fable-and-mythos-5-1",
    published: "2026-09-03",
    benchmark: "terminal-bench", benchmarkVersion: "4.0",
    caveat: "Fable 5.1 was evaluated with its production safeguards enabled; on tasks where safeguards intervened, it scored zero, which can understate its real capability relative to models evaluated without that constraint.",
    scores: [
      { adapterId: "claude", modelId: "claude-fable-5-1", value: 55.8 },
      { adapterId: "claude", modelId: "claude-opus-5", value: 52.3 },
      { adapterId: "codex", modelId: "gpt-5.6-sol", value: 37.3 }
    ]
  },
  {
    source: "anthropic-official",
    url: "https://www.anthropic.com/claude-fable-and-mythos-5-1",
    published: "2026-09-03",
    benchmark: "terminal-bench-science", benchmarkVersion: "0.1",
    caveat: "Fable 5.1 was evaluated with its production safeguards enabled; on tasks where safeguards intervened, it scored zero.",
    scores: [
      { adapterId: "claude", modelId: "claude-fable-5-1", value: 52.6 },
      { adapterId: "claude", modelId: "claude-opus-5", value: 29.0 },
      { adapterId: "codex", modelId: "gpt-5.6-sol", value: 22.4 }
    ]
  },
  {
    source: "anthropic-official",
    url: "https://www.anthropic.com/claude-fable-and-mythos-5-1",
    published: "2026-09-03",
    benchmark: "cursorbench", benchmarkVersion: "3.2.0",
    caveat: "Anthropic's own reported results; real statistical variance applies, not stated per-model on this page.",
    scores: [
      { adapterId: "claude", modelId: "claude-fable-5-1", value: 73.4 },
      { adapterId: "claude", modelId: "claude-opus-5", value: 70.0 },
      { adapterId: "codex", modelId: "gpt-5.6-sol", value: 67.2 }
    ]
  }
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Structural integrity check for hand-curated snapshot data — this can't
 * verify a number is *correct* against the live source (nothing here can
 * re-fetch OpenAI's blocked page), but it can catch the failure modes that
 * actually happened while authoring this file: a missing citation, a
 * malformed date, an unreferenced adapter/model, or an accidental exact
 * duplicate row within the same vendor snapshot. Throws on the first
 * violation — fail loud, never ingest a malformed entry silently.
 * @param {Array<object>} snapshots
 */
export function validateSnapshotIntegrity(snapshots) {
  const seen = new Set();
  snapshots.forEach((snapshot, index) => {
    const where = `snapshot[${index}] (${snapshot.source ?? "?"}/${snapshot.benchmark ?? "?"})`;
    if (!snapshot.source) throw new Error(`${where}: missing source`);
    if (!/^https:\/\//.test(snapshot.url ?? "")) throw new Error(`${where}: url must be a real https link, got ${snapshot.url}`);
    if (!DATE_PATTERN.test(snapshot.published ?? "")) throw new Error(`${where}: published must be an ISO date (YYYY-MM-DD), got ${snapshot.published}`);
    if (!snapshot.benchmark) throw new Error(`${where}: missing benchmark`);
    if (!snapshot.caveat) throw new Error(`${where}: missing the vendor's own methodology caveat`);
    if (!Array.isArray(snapshot.scores) || !snapshot.scores.length) throw new Error(`${where}: scores must be a non-empty array`);
    for (const score of snapshot.scores) {
      if (!score.adapterId || !score.modelId) throw new Error(`${where}: every score needs adapterId and modelId, got ${JSON.stringify(score)}`);
      if (score.value != null && !Number.isFinite(score.value)) throw new Error(`${where}: score.value must be a finite number or null, got ${score.value}`);
      const key = `${snapshot.source}|${snapshot.benchmark}|${snapshot.benchmarkVersion}|${score.adapterId}|${score.modelId}`;
      if (seen.has(key)) throw new Error(`${where}: duplicate row for ${score.adapterId}/${score.modelId} — same vendor reporting the same benchmark/model twice is almost certainly a copy-paste mistake`);
      seen.add(key);
    }
  });
}

/**
 * Registers every model named in a snapshot and records its real reported
 * score as evidence — always `verified: false` (manufacturer-reported is
 * never independent, regardless of which vendor published it), with the
 * vendor's own caveat preserved as `modelConfig` so it isn't lost.
 * Validates snapshot integrity first (see validateSnapshotIntegrity) —
 * never ingests a structurally malformed entry.
 * @param {ReturnType<import("./model-capability-registry.js").createCapabilityRegistry>} registry
 * @param {Array<object>} [snapshots] - defaults to OFFICIAL_BENCHMARK_SNAPSHOTS
 */
export function ingestOfficialSnapshotEvidence(registry, snapshots = OFFICIAL_BENCHMARK_SNAPSHOTS) {
  validateSnapshotIntegrity(snapshots);
  for (const snapshot of snapshots) {
    for (const { adapterId, modelId, value } of snapshot.scores) {
      if (value == null) continue;
      const id = registry.registerIdentity(adapterId, modelId);
      registry.addEvidence(id, {
        metric: snapshot.benchmark, value, source: snapshot.source,
        benchmarkVersion: snapshot.benchmarkVersion, modelConfig: snapshot.caveat,
        date: snapshot.published, verified: false
      });
    }
  }
  return registry;
}
