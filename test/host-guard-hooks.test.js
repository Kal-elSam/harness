import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildAdapterContext } from '../src/global/adapter-context.js';
import codex from '../src/global/adapters/codex.js';
import { applyRoleFiles, retireRoleFiles } from '../src/global/hosts/index.js';

const root = await mkdtemp(join(tmpdir(), 'kairo-u6-guards-'));
console.log(`U6 scratch: ${root}`);
const hook = resolve('src/global/hosts/codex-guard-hook.js');

test('Codex sync registers a removable, idempotent guard without changing user hooks or pacing', async () => {
  const homeDir = join(root, 'home');
  await mkdir(join(homeDir, '.codex'), { recursive: true });
  const path = join(homeDir, '.codex/hooks.json');
  const user = { hooks: [{ type: 'command', command: 'echo user' }] };
  await writeFile(path, JSON.stringify({ hooks: { PreToolUse: [user], Stop: [user] } }));
  const context = buildAdapterContext({ homeDir, packageRoot: resolve('.'), components: [], timestamp: 'u6' });
  const plan = codex.plan(context);
  assert.equal(JSON.parse(await readFile(path)).hooks.PreToolUse.length, 1, 'planning is read-only');
  await codex.apply(context, plan);
  const installed = JSON.parse(await readFile(path));
  assert.deepEqual(installed.hooks.PreToolUse[0], user);
  assert.deepEqual(installed.hooks.Stop, [user]);
  assert.equal(installed.hooks.PreToolUse.length, 2);
  assert.match(installed.hooks.PreToolUse[1].hooks[0].command, /codex-guard-hook\.js/);
  assert.match(installed.hooks.UserPromptSubmit[0].hooks[0].command, /codex-pacing-hook\.js/);
  assert.equal(codex.needsSync(context), false);
  await codex.apply(context, codex.plan(context));
  assert.deepEqual(JSON.parse(await readFile(path)), installed);
  await codex.uninstall(context, {});
  const remaining = JSON.parse(await readFile(path));
  assert.deepEqual(remaining.hooks.PreToolUse, [user]);
  assert.deepEqual(remaining.hooks.Stop, [user]);
});

test('Codex hook translates core denials and preserves read-only calls through its executable interface', () => {
  for (const agent_type of [undefined, 'default', 'execution-coordinator']) {
    for (const [tool_name, tool_input] of [['apply_patch', '*** Begin Patch\n*** Add File: src/x.js\n+x\n*** End Patch'], ['exec_command', { cmd: 'touch src/x.js' }]]) {
      const result = spawnSync(process.execPath, [hook], { input: JSON.stringify({ hook_event_name: 'PreToolUse', agent_type, tool_name, tool_input }), encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout).hookSpecificOutput;
      assert.equal(output.hookEventName, 'PreToolUse');
      assert.equal(output.permissionDecision, 'deny');
      assert.ok(output.permissionDecisionReason);
    }
  }
  const run = input => spawnSync(process.execPath, [hook], { input, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(run(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'exec_command', tool_input: { cmd: 'git status --short' } })).stdout), {});
  assert.equal(JSON.parse(run('{bad').stdout).hookSpecificOutput.permissionDecision, 'deny');
  const builder = run(JSON.stringify({ hook_event_name: 'PreToolUse', agent_type: 'builder', tool_name: 'apply_patch', tool_input: '*** Begin Patch\n*** Add File: src/x.js\n+x\n*** End Patch' }));
  assert.deepEqual(JSON.parse(builder.stdout), {});
});

test('OpenCode host sync extends the existing plugin, preserving shell identity, foreign files and retirement', async () => {
  const projectRoot = join(root, 'project');
  const options = { projectRoot, host: 'opencode', catalog: { registry: {} }, env: {}, yes: true };
  await applyRoleFiles(options);
  const path = join(projectRoot, '.opencode/plugins/kairo-host.js');
  const content = await readFile(path, 'utf8');
  assert.match(content, /create\.before/);
  assert.match(content, /KAIRO_HOST = "opencode"/);
  assert.match(content, /createKairoGuardSetup/);
  assert.equal((await applyRoleFiles(options)).applied, false);
  await retireRoleFiles(options);
  await mkdir(join(projectRoot, '.opencode/plugins'), { recursive: true });
  await writeFile(path, '// user plugin\n');
  await applyRoleFiles(options);
  await retireRoleFiles(options);
  assert.equal(await readFile(path, 'utf8'), '// user plugin\n');
});

test('OpenCode tool.execute.before denies primary writes and coordinator writes through core, leaving child builders working', async () => {
  const { createKairoGuardSetup } = await import('../src/global/hosts/opencode-guard-plugin.js');
  let callback;
  const setup = createKairoGuardSetup({ nodePath: process.execPath });
  await setup({ location: { directory: root }, session: { get: async ({ sessionID }) => ({ id: sessionID, parentID: sessionID === 'primary' ? null : 'primary' }) },
    tool: { hook: async (name, fn) => { assert.equal(name, 'execute.before'); callback = fn; } } });
  await assert.rejects(callback({ sessionID: 'primary', agent: 'builder', tool: 'write', input: { filePath: 'src/x.js' } }), /denied|permission/i);
  await assert.rejects(callback({ sessionID: 'child', agent: 'execution-coordinator', tool: 'bash', input: { command: 'touch src/x.js' } }), /permission/i);
  await callback({ sessionID: 'primary', tool: 'read', input: { filePath: 'src/x.js' } });
  await callback({ sessionID: 'child', agent: 'builder', tool: 'write', input: { filePath: 'src/x.js' } });
});

test('guard transports fail closed on malformed/unavailable core responses without trusting role claims', async () => {
  const { guardToolCall, runCodexGuardHook } = await import('../src/global/hosts/codex-guard-hook.js');
  for (const run of [() => { throw new Error('unavailable'); }, () => ({ status: 0, stdout: '{bad' }), () => ({ status: 1, stdout: '{"allow":true,"reason":"bad status"}' })]) {
    assert.equal(guardToolCall({ host: 'codex', tool: 'read', input: {} }, { run }).allow, false);
  }
  assert.equal(runCodexGuardHook({ hook_event_name: 'PreToolUse', tool_name: 123 }).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(runCodexGuardHook({ hook_event_name: 'PreToolUse', tool_name: 'write', tool_input: { role: 'Builder', filePath: 'src/x.js' } }).hookSpecificOutput.permissionDecision, 'deny');
});

test('host guard preserves existing workflow and wrapper role aliases without widening unknown agents', async () => {
  const { guardRole, guardToolCall } = await import('../src/global/hosts/codex-guard-hook.js');
  assert.equal(guardRole('odd-worker'), 'Builder');
  assert.equal(guardRole('team-builder-codex'), 'Builder');
  assert.equal(guardRole('odd-verify'), 'Quality Lead');
  assert.equal(guardRole('unknown-agent'), 'unknown-agent');
  assert.equal(guardToolCall({ host: 'codex', role: guardRole('odd-worker'), tool: 'write', input: { file_path: 'src/a.js' } }).allow, true);
});
