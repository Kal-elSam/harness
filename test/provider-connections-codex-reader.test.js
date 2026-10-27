import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createDefaultReaders } from '../src/global/provider-connections/readers.js';
import { readClaudeModels } from '../src/global/observability/claude-models.js';
import { resolveClaudeEntitlements } from '../src/global/observability/claude-entitlement-store.js';

const noFiles = { readFile: async () => { throw new Error('ENOENT'); } };

test('Codex default reader lists catalog with injected spawn, never runs a model', async () => {
  const methods = [];
  let killed = false;
  const { accessReaders } = createDefaultReaders({ homeDir: '/unused', deps: {
    ...noFiles, cwd: '/project', spawn(command, argv, options) {
      assert.equal(command, 'codex');
      assert.deepEqual(argv, ['app-server', '--listen', 'stdio://']);
      assert.equal(options.cwd, '/project');
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.kill = () => { killed = true; };
      child.stdin = { write(raw) {
        const req = JSON.parse(raw);
        methods.push(req.method);
        queueMicrotask(() => child.stdout.emit('data', JSON.stringify({ id: req.id, result:
          req.method === 'initialize' ? {} : { data: [{ id: 'gpt-real', displayName: 'Real catalog model' }] }
        }) + '\n'));
      } };
      return child;
    }
  } });
  assert.deepEqual(await accessReaders.codex({ now: 1 }), [
    { modelId: 'gpt-real', label: 'Real catalog model', catalogued: true }
  ]);
  assert.deepEqual(methods, ['initialize', 'model/list']);
  assert.equal(killed, true);
});

test('Codex catalog spawn failure stays unknown', async () => {
  const { accessReaders } = createDefaultReaders({ deps: { spawn() { throw new Error('missing'); } } });
  assert.deepEqual(await accessReaders.codex({ now: 1 }), []);
});

test('existing Claude default reader output is unchanged', async () => {
  const now = 1;
  const models = readClaudeModels().models;
  const resolved = resolveClaudeEntitlements({ cache: null, subscriptionType: null,
    catalogIds: models.map(m => m.id), now, accountIdentifier: null });
  const expected = models.map(model => ({ ...resolved[model.id], modelId: model.id,
    label: model.displayName, catalogued: !resolved[model.id].probedAt }));
  const { accessReaders } = createDefaultReaders({ homeDir: '/unused', deps: {
    ...noFiles, spawn() { assert.fail('Claude must not spawn'); }
  } });
  assert.deepEqual(await accessReaders.claude({ now }), expected);
});
