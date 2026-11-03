import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const cli = resolve('bin/kairo.js');
const scratch = mkdtempSync(join(tmpdir(), 'kairo-test-economy-'));
console.log(`Test economy scratch: ${scratch}`);
function fixture(name) {
  const root = join(scratch, name); mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'test/a.test.js'), "import test from 'node:test'; test('public behavior', () => {});\n");
  writeFileSync(join(root, 'test/b.test.js'), "import test from 'node:test'; test('other behavior', () => {});\n");
  return root;
}
function run(root, args, env = {}) {
  return spawnSync(process.execPath, [cli, 'test', ...args, '--cwd', root], { encoding: 'utf8', input: 'src/a.js\n', env: { ...process.env, ...env } });
}
function fakeCodegraph(root) {
  const bin = join(root, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, 'codegraph'), '#!/bin/sh\nwhile IFS= read -r line; do printf \'%s\\n\' "$line"; done > codegraph-stdin.txt\nprintf \'{"affectedTests":["test/a.test.js"]}\\n\'\n', { mode: 0o755 });
  return bin;
}
// Protects affected listing, counts and execution through the public CLI with CodeGraph available.
test('affected lists and runs graph-selected tests', () => {
  const root = fixture('graph'); const bin = fakeCodegraph(root);
  const out = run(root, ['affected', '--stdin', '--run'], { PATH: bin });
  assert.equal(out.status, 0, out.stderr); assert.match(out.stdout, /1 of 2/); assert.match(out.stdout, /test\/a.test.js/); assert.match(out.stdout, /public behavior/);
});
// The fake must drain stdin before responding to avoid racing the CLI's input pipe.
test('affected sends changed files to CodeGraph stdin', () => {
  const root = fixture('stdin'); const bin = fakeCodegraph(root);
  const out = run(root, ['affected', '--stdin'], { PATH: bin });
  assert.equal(out.status, 0, out.stderr);
  assert.ok(readFileSync(join(root, 'codegraph-stdin.txt'), 'utf8').split('\n').includes('src/a.js'));
});
// Protects honest fallback: unavailable impact evidence must never imply no tests need running.
test('affected recommends full suite when CodeGraph is missing', () => {
  const root = fixture('missing'); const out = run(root, ['affected', '--stdin', '--run'], { PATH: '' });
  assert.notEqual(out.status, 0); assert.match(out.stdout + out.stderr, /CodeGraph unavailable/); assert.match(out.stdout + out.stderr, /full suite/i); assert.doesNotMatch(out.stdout, /0 of 2/);
});
// Protects measured slow-file ranking and reuse of a real audit cache without rerunning tests.
test('audit prints slowest files and cached timings', () => {
  const root = fixture('audit'); const cache = join(root, 'timings.json');
  const measured = run(root, ['audit', '--run', '--cache', cache]);
  assert.equal(measured.status, 0, measured.stderr); assert.match(measured.stdout, /Slowest files/); assert.match(measured.stdout, /Total file time/); assert.match(measured.stdout, /test\/a.test.js/);
  const cached = run(root, ['audit', '--cache', cache]);
  assert.equal(cached.status, 0, cached.stderr); assert.match(cached.stdout, /Candidate redundancies/);
});
