import test from 'node:test';
import assert from 'node:assert/strict';

test('C1 resolves only existing Architect tasks and never throws', async () => {
  const { resolveTaskIdentity, extractTaskMarker } = await import('../src/global/team/task-identity.js');
  for (const [raw, readTaskRecord, status] of [
    [undefined, () => { throw Error(); }, 'absent'],
    ['../fake', () => ({}), 'invalid'],
    ['task-1', () => null, 'not_found'],
    ['task-1', () => { throw Error('unreadable'); }, 'unreadable'],
    ['task-1', () => ({}), 'linked'],
  ]) assert.deepEqual(await resolveTaskIdentity('/repo', raw, { readTaskRecord }), { taskId: status === 'linked' ? raw : null, taskIdStatus: status });
  assert.equal(extractTaskMarker('prefix Kairo-Task-Id: task-1\nKairo-Task-Id: task-1 extra'), null);
  assert.equal(extractTaskMarker('Kairo-Task-Id: task-1\r\nKairo-Task-Id: task-1'), 'task-1');
  assert.equal(extractTaskMarker('nothing'), null);
  const multiple = extractTaskMarker('Kairo-Task-Id: task-1\nKairo-Task-Id: task-2');
  assert.equal((await resolveTaskIdentity('/repo', multiple)).taskIdStatus, 'invalid');
});

// Real Architect artifacts, reused by public-interface correlation tests.
export async function identityTask(root, id = 'task-1') {
  const { mkdir, writeFile, realpath } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const dir = join(root, '.ai', 'tasks', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'task.md'), '# Task\n\nTask\n');
  await writeFile(join(dir, 'status.json'), JSON.stringify({ schema: 'kairo.architect-task/v1', taskId: id,
    projectRoot: await realpath(root), baseHead: 'a'.repeat(40), state: 'draft',
    artifacts: { task: `.ai/tasks/${id}/task.md`, plan: `.ai/tasks/${id}/plan.md` } }));
}
