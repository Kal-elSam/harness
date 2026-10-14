import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCorpus } from '../scripts/effort-eval/outcome-tasks/validate.mjs';

async function sample(t) {
  const root = await mkdtemp(join(tmpdir(), 'outcome-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'fixtures/base'), { recursive: true });
  await mkdir(join(root, 'checks'));
  await writeFile(join(root, 'fixtures/base/task.cjs'), 'module.exports = 0;\n');
  await writeFile(join(root, 'checks/fail.cjs'), 'process.exit(1);\n');
  const tasks = Array.from({ length: 24 }, (_, i) => ({
    id: `task-${i}`, language: i % 2 ? 'es' : 'en',
    category: ['mechanical', 'ordinary', 'reasoning'][i % 3],
    riskSensitive: i < 6, prompt: 'Synthetic task.', scope: ['task.cjs'],
    fixture: 'fixtures/base', check: 'checks/fail.cjs'
  }));
  async function save() { await writeFile(join(root, 'manifest.json'), JSON.stringify({ tasks })); }
  await save();
  return { root, tasks, save };
}

test('rejects a check passing on untouched fixture', async t => {
  const s = await sample(t);
  await writeFile(join(s.root, 'checks/fail.cjs'), 'process.exit(0);\n');
  await assert.rejects(validateCorpus(s.root), /passes on untouched/);
});
test('rejects a check inside the fixture', async t => {
  const s = await sample(t); s.tasks[0].check = 'fixtures/base/task.cjs'; await s.save();
  await assert.rejects(validateCorpus(s.root), /outside fixture/);
});
test('rejects duplicate task ids', async t => {
  const s = await sample(t); s.tasks[1].id = s.tasks[0].id; await s.save();
  await assert.rejects(validateCorpus(s.root), /duplicate/);
});
test('requires EN and ES balance', async t => {
  const s = await sample(t); s.tasks.forEach(task => { task.language = 'en'; }); await s.save();
  await assert.rejects(validateCorpus(s.root), /language balance/);
});
test('requires at least six risk-sensitive tasks', async t => {
  const s = await sample(t); s.tasks.forEach(task => { task.riskSensitive = false; }); await s.save();
  await assert.rejects(validateCorpus(s.root), /risk balance/);
});
test('hash is stable across runs and changes with fixture bytes', async t => {
  const s = await sample(t);
  const first = await validateCorpus(s.root);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
  assert.equal((await validateCorpus(s.root)).hash, first.hash);
  await writeFile(join(s.root, 'fixtures/base/task.cjs'), 'module.exports = 1;\n');
  assert.notEqual((await validateCorpus(s.root)).hash, first.hash);
});
test('validates real corpus without labels or predictions', async () => {
  const root = new URL('../scripts/effort-eval/outcome-tasks/', import.meta.url);
  const result = await validateCorpus(root);
  assert.equal(result.taskCount, 24);
  assert.deepEqual(result.languages, { en: 12, es: 12 });
  assert.equal(result.riskSensitive, 8);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  for (const task of manifest.tasks) {
    assert.deepEqual(Object.keys(task).sort(), ['category', 'check', 'fixture', 'id', 'language', 'prompt', 'riskSensitive', 'scope']);
  }
});

test('external check accepts a correct edit and rejects out-of-scope effects', async t => {
  const corpus = fileURLToPath(new URL('../scripts/effort-eval/outcome-tasks/', import.meta.url));
  const root = await mkdtemp(join(tmpdir(), 'outcome-scope-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(join(corpus, 'fixtures/trim-lines'), root, { recursive: true });
  const solution = "exports.clean = text => text.split(/\\r?\\n/).map(line => line.trim()).filter(Boolean);\n";
  await writeFile(join(root, 'task.cjs'), solution);
  const check = () => spawnSync(process.execPath, [join(corpus, 'checks/trim-lines.cjs'), root], { encoding: 'utf8' });
  assert.equal(check().status, 0);
  await writeFile(join(root, 'task.cjs'), "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'outside.txt'), 'x');\n" + solution);
  const result = check();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside scope/);
});
