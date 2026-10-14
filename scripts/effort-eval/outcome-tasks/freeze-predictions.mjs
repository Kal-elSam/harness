import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyEffort } from '../../../src/global/intelligence/execution-router.js';
import { ROOT, ROUTER, PHASE_A, TIERS, sha256, corpus, isMain, argumentsFor } from './common.mjs';

export async function freezePredictions({ root = ROOT, output = join(root, 'predictions.json'), force = false } = {}) {
  const data = await corpus(root);
  const routerHash = sha256(await readFile(ROUTER));
  const frozen = { schema: 1, classifier: 'classifyEffort', routerHash,
    corpusHash: data.hash, phaseA: PHASE_A, timestamp: new Date().toISOString(),
    predictions: data.tasks.map(task => ({ taskId: task.id, tier: classifyEffort(task.prompt), routerHash, corpusHash: data.hash })) };
  await writeFile(output, JSON.stringify(frozen, null, 2) + '\n', { flag: force ? 'w' : 'wx' });
  return frozen;
}
if (isMain(import.meta.url)) {
  try {
    const args = argumentsFor({ output: { type: 'string' }, force: { type: 'boolean' } });
    if (args.help) console.log('Usage: node freeze-predictions.mjs [--output FILE] [--force]\nOffline only. Refuses overwrite unless --force. Commit predictions before provider runs.');
    else {
      const frozen = await freezePredictions({ output: args.output, force: args.force });
      console.log(JSON.stringify({ corpusHash: frozen.corpusHash, routerHash: frozen.routerHash,
        counts: Object.fromEntries(TIERS.map(tier => [tier, frozen.predictions.filter(p => p.tier === tier).length])), phaseA: frozen.phaseA }, null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
