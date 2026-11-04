import { mkdir, readFile, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { harnessHomePaths } from '../paths.js';
import { projectKeyForPath } from '../next/project-key.js';
import { writeAtomicJson } from '../runtime/write-atomic-json.js';
import { validateEscalation } from './delegation-contract.js';

export const ESCALATION_BUDGET_SCHEMA = 'kairo.escalation-budget/v1';
// One shared project cap: at most 10 frontier decisions in any rolling 7 days.
export const ESCALATION_BUDGET_CAP = 10;
export const ESCALATION_WINDOW_DAYS = 7;
const WINDOW_MS = ESCALATION_WINDOW_DAYS * 86400000;

export function escalationBudgetPath(homeDir, projectRoot) {
  return join(harnessHomePaths(homeDir).sessionsDir, projectKeyForPath(projectRoot), 'escalation-budget.json');
}

/** Read-only, including expiry: only a successful record prunes the ledger. */
export async function readEscalationBudget(homeDir, projectRoot, deps = {}) {
  const now = new Date((deps.now ?? Date.now)()).getTime();
  if (!Number.isFinite(now)) throw new TypeError('Invalid escalation budget time');
  let entries = [];
  try {
    const doc = JSON.parse(await (deps.readFile ?? readFile)(escalationBudgetPath(homeDir, projectRoot), 'utf8'));
    if (doc?.schema !== ESCALATION_BUDGET_SCHEMA || !Array.isArray(doc.entries)) {
      throw new TypeError('Invalid escalation budget ledger');
    }
    // Corrupt or unreadable ledgers must not silently grant a fresh budget.
    for (const entry of doc.entries) {
      validateEscalation(entry, 'invalid_escalation_ledger');
      if (!Number.isFinite(Date.parse(entry.at))) throw new TypeError('Invalid escalation budget timestamp');
    }
    entries = doc.entries.filter(entry => Date.parse(entry.at) > now - WINDOW_MS);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const used = entries.length;
  return { used, cap: ESCALATION_BUDGET_CAP, remaining: Math.max(0, ESCALATION_BUDGET_CAP - used), windowDays: ESCALATION_WINDOW_DAYS, entries };
}

/**
 * Record a decision, not an implementation launch. Returns ok:false with a
 * typed code on exhaustion or contention. Callers may retry a busy result.
 * Exclusive mkdir serializes read/check/write across hosts; atomic JSON publish
 * prevents partial ledgers. A crashed holder leaves a fail-closed .lock directory
 * requiring manual removal after confirming no record operation is running.
 */
export async function recordEscalation(homeDir, projectRoot, escalation, deps = {}) {
  validateEscalation(escalation, 'invalid_escalation');
  const now = new Date((deps.now ?? Date.now)()).getTime();
  const snapshotDeps = { ...deps, now: () => now };
  const initial = await readEscalationBudget(homeDir, projectRoot, snapshotDeps);
  const exhausted = budget => ({ ok: false, code: 'escalation_budget_exhausted', ...budget });
  // No mkdir, lock, temp file or ledger write on an exhausted budget.
  if (initial.remaining === 0) return exhausted(initial);
  const path = escalationBudgetPath(homeDir, projectRoot);
  const lock = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  try { await mkdir(lock); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return { ok: false, code: 'escalation_budget_busy', ...initial };
  }
  try {
    const budget = await readEscalationBudget(homeDir, projectRoot, snapshotDeps);
    if (budget.remaining === 0) return exhausted(budget);
    const entry = { to: escalation.to, reason: escalation.reason, evidence: escalation.evidence, at: new Date(now).toISOString() };
    const entries = [...budget.entries, entry];
    await (deps.writeAtomicJson ?? writeAtomicJson)(path, { schema: ESCALATION_BUDGET_SCHEMA, entries });
    return { ok: true, used: entries.length, cap: budget.cap, remaining: budget.cap - entries.length, windowDays: budget.windowDays, entries };
  } finally {
    await rmdir(lock);
  }
}
