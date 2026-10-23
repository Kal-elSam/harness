import { readFile as defaultReadFile } from "node:fs/promises";

/** Read local outcome rows without making optional evaluation data a startup dependency. */
export async function readEffortOutcomes(filePath, readFile = defaultReadFile) {
  let contents;
  try { contents = await readFile(filePath, "utf8"); } catch { return []; }
  const rows = [];
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { return []; }
    if (typeof row?.model !== "string" || !row.model.trim() || (row.outcome !== "pass" && row.outcome !== "fail")) return [];
    rows.push(row);
  }
  return rows;
}

/** S48: small local samples are priors, not independent benchmark measurements. */
export function ingestEffortOutcomeEvidence(registry, rows, { minRows = 5 } = {}) {
  const byModel = new Map();
  for (const row of rows ?? []) {
    if (typeof row?.model !== "string" || !row.model.startsWith("claude-")) continue;
    if (row.outcome !== "pass" && row.outcome !== "fail") continue;
    if (!byModel.has(row.model)) byModel.set(row.model, []);
    byModel.get(row.model).push(row);
  }
  for (const [model, outcomes] of byModel) {
    if (outcomes.length < minRows) continue;
    const dates = outcomes.map(row => row.timestamp).filter(date => typeof date === "string" && Number.isFinite(Date.parse(date)));
    const date = dates.reduce((latest, value) => !latest || Date.parse(value) > Date.parse(latest) ? value : latest, null);
    const id = registry.registerIdentity("claude", model);
    registry.addEvidence(id, {
      // The registry drops unknown flags; effort.* also encodes prior status for scoring.
      metric: "effort.passRate", prior: true,
      value: outcomes.filter(row => row.outcome === "pass").length / outcomes.length,
      source: "kairo-effort-eval", scale: "unit", verified: false,
      date, modelConfig: `${outcomes.length} outcome tasks`
    });
  }
}
