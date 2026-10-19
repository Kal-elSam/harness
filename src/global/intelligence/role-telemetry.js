import { isTerminalRunState } from "../runtime/run-types.js";

/**
 * S47 (C7c): measured per-role cost and work volume from run telemetry.
 * Pure functions, no IO. Numbers only: token counts and prices, never content.
 */

/** Minimum terminal attributed runs per role and model before data is trusted (assumption). */
export const MIN_ROLE_RUNS = 5;

const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const count = value => (finite(value) ? value : 0);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor(sorted.length / 2)] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2;
}

/**
 * Billable input and output tokens of one run. Claude reports cache reads and
 * writes next to input; Codex reports them as subsets of input (and reasoning
 * as a subset of output). Cache is charged at the input price: AA has no cache price.
 */
function billableTokens(record) {
  const tokens = record?.tokens;
  if (!tokens || typeof tokens !== "object") return null;
  const input = count(tokens.input);
  const output = count(tokens.output);
  return record.provider === "claude"
    ? { input: input + count(tokens.cacheRead) + count(tokens.cacheWrite), output }
    : { input, output };
}

/** USD cost of one run at the matched model's AA price per MTok; null when a price is missing. */
export function runCostUsd(record, model) {
  const priceInput = model?.priceInputPerMTok;
  const priceOutput = model?.priceOutputPerMTok;
  if (!finite(priceInput) || !finite(priceOutput)) return null;
  const billable = billableTokens(record);
  if (!billable) return null;
  return (billable.input * priceInput + billable.output * priceOutput) / 1e6;
}

function totalTokens(record) {
  const tokens = record?.tokens;
  if (!tokens) return null;
  if (finite(tokens.total)) return tokens.total;
  const sum = count(tokens.input) + count(tokens.output) + count(tokens.cacheRead) + count(tokens.cacheWrite);
  return sum > 0 ? sum : null;
}

/** Adapt a Kairo run record (S45) to the session-record shape; null unless terminal, attributed and metered. */
export function kairoRunToTelemetryRecord(run) {
  if (!run || typeof run.role !== "string" || !run.role || typeof run.model !== "string" || !run.model) return null;
  if (!isTerminalRunState(run.state)) return null;
  const usage = run.tokenUsage;
  if (!usage || (!finite(usage.input) && !finite(usage.output) && !finite(usage.total))) return null;
  return {
    source: "kairo-run", provider: run.agentId ?? null, model: run.model, role: run.role,
    state: run.state, completedAt: run.completedAt ?? new Date(0).toISOString(),
    tokens: { input: usage.input, output: usage.output, total: usage.total }
  };
}

/**
 * Per role, a Map "adapterId::modelId" -> { runs, medianCostUsd, medianTokens } for pairs with
 * at least MIN_ROLE_RUNS terminal attributed runs, plus relative work volumes (Builder = 1)
 * when at least two roles have that many runs and Builder is one of them.
 * @returns {{ roles: Record<string, Map<string, object>>, volumes: Record<string, number>|null }}
 */
export function buildRoleTelemetry(records, models) {
  const byKey = new Map();
  for (const model of models ?? []) byKey.set(`${model.adapterId}::${model.modelId}`, model);
  const pairs = new Map();
  const roleTokens = new Map();
  for (const record of records ?? []) {
    if (!record || typeof record.role !== "string" || !record.role || record.completedAt == null) continue;
    if (record.source === "kairo-run" ? !isTerminalRunState(record.state) : record.outcome !== "completed") continue;
    const key = `${record.provider}::${record.model}`;
    const model = byKey.get(key);
    if (!model) continue;
    const tokens = totalTokens(record);
    if (tokens == null) continue;
    const role = record.role;
    if (!roleTokens.has(role)) roleTokens.set(role, []);
    roleTokens.get(role).push(tokens);
    const cost = runCostUsd(record, model);
    if (cost == null) continue;
    if (!pairs.has(role)) pairs.set(role, new Map());
    const perRole = pairs.get(role);
    if (!perRole.has(key)) perRole.set(key, { costs: [], tokens: [] });
    perRole.get(key).costs.push(cost);
    perRole.get(key).tokens.push(tokens);
  }
  const roles = {};
  for (const [role, perRole] of pairs) {
    const qualified = new Map();
    for (const [key, data] of perRole) {
      if (data.costs.length >= MIN_ROLE_RUNS) {
        qualified.set(key, { runs: data.costs.length, medianCostUsd: median(data.costs), medianTokens: median(data.tokens) });
      }
    }
    if (qualified.size) roles[role] = qualified;
  }
  const medians = {};
  for (const [role, tokens] of roleTokens) if (tokens.length >= MIN_ROLE_RUNS) medians[role] = median(tokens);
  const builder = medians.Builder;
  let volumes = null;
  if (Object.keys(medians).length >= 2 && builder > 0) {
    volumes = Object.fromEntries(Object.entries(medians).map(([role, value]) => [role, value / builder]));
  }
  return { roles, volumes };
}

/** Map "adapterId::modelId" -> median USD per run for one role, as withQuotaCosts expects; null when absent. */
export function measuredRoleCosts(roleTelemetry, role) {
  const perRole = roleTelemetry?.roles?.[role];
  if (!(perRole instanceof Map) || !perRole.size) return null;
  return new Map([...perRole].map(([key, data]) => [key, data.medianCostUsd]));
}
