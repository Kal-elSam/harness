import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConversationService } from '../src/global/team/service.js';
import { launchLedgerPath } from '../src/global/team/launch-ledger.js';
import { routingTracePath, appendRoutingTrace } from '../src/global/team/routing-trace.js';
import { identityTask } from './task-identity.test.js';

test('C7 plan execution emits exactly one best-effort trace, no launch ledger, and none on reuse', async () => {
  const home = await mkdtemp(join(tmpdir(), 'service-task-'));
  await identityTask(home);
  const candidate = { candidateKey: 'codex::test', adapterId: 'codex', modelId: 'test' };
  const target = { role: 'Builder', selection: 'assigned', candidateKey: candidate.candidateKey, strategyFingerprint: 'fp' };
  const record = { status: { taskId: 'task-1', state: 'approved' }, planMarkdown: '# Plan' };
  let link = null, launches = 0, traceAttempts = 0;
  const service = createConversationService({
    homeDir: home, resolveRoot: async () => home,
    readPlan: async () => record, verifyExecution: async () => record,
    readExecution: async () => link, writeExecution: async (_root, _id, next) => { link = next; },
    updateExecution: async (_root, _id, next) => { link = next; },
    createRunId: () => 'run_task_12345678',
    readRun: async () => ({ state: 'running' }),
    startRun: async () => { launches++; return { metadata: { state: 'running', startedAt: 'now', updatedAt: 'now' } }; },
    transitionStore: { readTransitions: async () => [], appendTransition: async () => {} },
    appendRoutingTrace: async (...args) => { traceAttempts++; return appendRoutingTrace(...args); },
  });
  service.routeProjectExecution = async () => ({ decision: 'ROUTED', strategyFingerprint: 'fp', model: candidate });
  const args = { cwd: home, taskId: 'task-1', confirmationTarget: target };
  const result = await service.executePlan(args);
  assert.equal(result.reused, false); assert.equal(result.execution.runId, 'run_task_12345678');
  const rows = (await readFile(routingTracePath(home, home), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].source, rows[0].taskId, rows[0].taskIdStatus, rows[0].executionId], ['architect', 'task-1', 'linked', 'run_task_12345678']);
  assert.equal((await service.executePlan(args)).reused, true);
  assert.equal(traceAttempts, 1); assert.equal(launches, 1);
  await assert.rejects(access(launchLedgerPath(home, home)), { code: 'ENOENT' });
  // Inject a failing trace writer into an otherwise identical new service.
  const failed = createConversationService({ homeDir: home, resolveRoot: async () => home,
    verifyExecution: async () => record, readExecution: async () => null,
    writeExecution: async () => {}, updateExecution: async () => {},
    createRunId: () => 'run_task_12345678',
    startRun: async () => ({ metadata: { state: 'running', startedAt: 'now', updatedAt: 'now' } }),
    transitionStore: { readTransitions: async () => [], appendTransition: async () => {} },
    appendRoutingTrace: async () => { throw Error('trace failure'); },
  });
  failed.routeProjectExecution = service.routeProjectExecution;
  assert.deepEqual(await failed.executePlan(args), result);
});
