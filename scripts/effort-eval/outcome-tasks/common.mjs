import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { validateCorpus } from './validate.mjs';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const TIERS = ['light', 'standard', 'heavy'];
export const PHASE_A = ['trim-lines', 'sum-values', 'paginate', 'redact-logs', 'session-expiry', 'invoice-rounding'];
export const ROUTER = resolve(ROOT, '../../../src/global/intelligence/execution-router.js');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const isMain = url => process.argv[1] && url === pathToFileURL(resolve(process.argv[1])).href;
export function argumentsFor(options) {
  return parseArgs({ options: { help: { type: 'boolean' }, ...options }, allowPositionals: false }).values;
}
export async function corpus(root = ROOT) {
  const validated = await validateCorpus(root);
  return { ...validated, tasks: JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8')).tasks };
}
export async function loadFrozen(root, file) {
  let bytes;
  try { bytes = await readFile(file); }
  catch { throw new Error('frozen predictions required before running'); }
  const frozen = JSON.parse(bytes);
  const current = await corpus(root);
  if (frozen.corpusHash !== current.hash) throw new Error('frozen corpus hash mismatch');
  if (frozen.routerHash !== sha256(await readFile(ROUTER))) throw new Error('frozen router hash mismatch');
  if (frozen.classifier !== 'classifyEffort' || frozen.schema !== 1 ||
      JSON.stringify(frozen.phaseA) !== JSON.stringify(PHASE_A) ||
      !Array.isArray(frozen.predictions) || frozen.predictions.length !== current.tasks.length ||
      new Set(frozen.predictions.map(p => p.taskId)).size !== current.tasks.length ||
      current.tasks.some(t => !frozen.predictions.some(p => p.taskId === t.id && TIERS.includes(p.tier) &&
        p.routerHash === frozen.routerHash && p.corpusHash === frozen.corpusHash))) {
    throw new Error('invalid frozen predictions');
  }
  return { frozen, predictionsHash: sha256(bytes), tasks: current.tasks };
}
export async function jsonLines(file) {
  let text;
  try { text = await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return text.split('\n').filter(x => x.trim()).map((line, i) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`invalid results JSONL at line ${i + 1}; preserve and repair before resume`); }
  });
}
