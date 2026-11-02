import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { bashWritesFiles, checkToolCall } from '../src/global/team/write-guard.js';
import { ROLE_REGISTRY } from '../src/global/intelligence/role-registry.js';

for (const [command, denied] of [

  ["sed -i 's/a/b/' file", true],
  ["sed -i '' 's/a/b/' file", true],
  ["perl -pi -e 's/a/b/' file", true],
  ["python3 - <<'PY'\nopen('file', 'w').write('x')\nPY", true],
  ["python <<'PY'\nprint('x')\nPY", true],
  ["node <<'JS'\nrequire('fs').writeFileSync('file', 'x')\nJS", true],
  ['echo x | tee file', true],
  ['echo x | tee 123', true],
  ['cat tee file', false],
  ['echo sed -i file', false],
  ['echo x | tee -a /tmp/log file', true],
  ['echo x > file', true],
  ['echo x >> "file name"', true],
  ['echo x 2>errors', true],
  ['echo x > /tmp/out', false],
  ['echo x > /private/tmp/scratchpad/out', false],
  ['echo x > /dev/null 2>&1', false],
  ['echo x > /tmp/../repo/file', true],
  ['echo x > /tmp-not-safe/file', true],
  ['git status', false],
  ['npm test', false],
  ['node --test', false],
  ['gh pr view', false],
  ['kairo doctor', false],
  ['claude plugin test integrations/claude-code/kairo-router', false],
  ['ls', false],
  ['grep foo file', false],
  ['cat file', false],
  ['echo "text > file"', false],
  ["gh pr create --body-file - <<'EOF2'\nBefore > after\nEOF2", false],
  ["gh pr create --title x --body \"$(cat <<'EOF2'\nRED 1 -> GREEN\nEOF2\n)\"", false],
  ["sh -c 'sed -i s/a/b/ file'", true],
  ['bash -c "echo x > file"', true],
  ["zsh -c 'git status'", false],
  ['cp src dst', true],
  ['mv a b', true],
  ['touch file', true],
  ['rm -rf build', true],
  ['mkdir out', true],
  ['ln -s a b', true],
  ['truncate -s 0 file', true],
  ['install -m 755 a b', true],
  ['rmdir d', true],
  ['cp src /tmp/dst', true],
  ['cp /tmp/a /tmp/b', false],
  ['rm -rf /private/tmp/claude-501/x', false],
  ['touch /dev/null', false],
  ['git rm file', false],
  ['git mv a b', false],
  ['git commit -m "a -> b"', false],
  ["node -e 'console.log(1>0)'", false],
  ['npm test 2>&1 | tail -3', false],
  ['sed -i s/a/b/ file', true],
  ['echo hi > /private/tmp/x', false],
]) test(`ported shell detection: ${command}`, () => assert.equal(bashWritesFiles(command), denied));
const call = (command, role = 'Master Orchestrator') => checkToolCall({ host: 'codex', role, tool: 'Bash', command });
for (const prefix of ['', 'rtk ', 'rtk proxy ', 'env ', 'command ', 'sh -c ']) {
  const command = prefix === 'sh -c ' ? "sh -c 'git push'" : `${prefix}git push`;
  test(`delivery denied: ${command}`, () => assert.equal(call(command).allow, false));
}
for (const command of ['git commit -m "feat: x"', 'rtk git status', 'rtk proxy git commit -m x', "cat <<'EOF'\ngit push > file\nEOF", 'npm test', 'node --test', 'gh pr view', 'kairo doctor']) {
  test(`orchestrator allowed: ${command}`, () => assert.equal(call(command).allow, true));
}
for (const [role, entry] of Object.entries(ROLE_REGISTRY)) test(`registry permission: ${role}`, () => {
  const decision = checkToolCall({ host: 'claude', role, tool: 'Write', paths: ['src/a.js'] });
  assert.equal(decision.allow, entry.permission === 'scoped-write');
  assert.equal(call('git push', role).allow, entry.permission === 'authorized-delivery');
});
for (const role of ['Master Orchestrator', 'Execution Coordinator']) {
  for (const command of ['git rm file', 'git mv a b', 'rtk sed -i s/a/b/ file', 'git push && git status', 'echo x; git push', 'git reset --hard', `node -e "require('fs').writeFileSync('x','x')"`])
    test(`${role} cannot mutate: ${command}`, () => assert.equal(call(command, role).allow, false));
}
test('path permissions and unknown inputs fail closed', () => {
  const write = (role, paths) => checkToolCall({ host: 'codex', role, tool: 'apply_patch', paths }).allow;
  assert.equal(write('Documenter', ['docs/guide.md', 'README.md']), true);
  assert.equal(write('Documenter', ['docs/../src/a.js']), false);
  assert.equal(write('Documenter', []), false);
  assert.equal(write('Test Repro Runner', ['/tmp/probe.js']), true);
  assert.equal(write('Test Repro Runner', ['/tmp/../repo/a']), false);
  assert.equal(write('Deliverer', ['src/a.js']), false);
  assert.equal(write('Missing', ['src/a.js']), false);
  assert.equal(checkToolCall(null).allow, false);
  assert.equal(call('gh pr comment 1').allow, false);
  assert.equal(call('gh release create v1', 'Deliverer').allow, true);
  assert.equal(call('echo x > docs/a.md', 'Documenter').allow, true);
  assert.equal(call('echo x > src/a.js', 'Documenter').allow, false);
  assert.equal(call('unknown-writer').allow, false);
});

test('scratch-only roles allow OS temp paths without accepting prefix siblings', () => {
  const write = target => checkToolCall({ host: 'codex', role: 'Test Repro Runner', tool: 'Write', paths: [target] }).allow;
  const tempDirectory = os.tmpdir();
  assert.equal(write(path.join(tempDirectory, 'k', 'out.txt')), true);
  assert.equal(write(`${tempDirectory}-evil/out.txt`), false);
  assert.equal(write('src/a.js'), false);
});

test('read-only roles reject git configuration injection and writable git output', () => {
  for (const command of ['git -c alias.status=!touch status', 'git --git-dir=/tmp/x status', 'git status --porcelain > file']) {
    assert.equal(call(command).allow, false, command);
  }
});
