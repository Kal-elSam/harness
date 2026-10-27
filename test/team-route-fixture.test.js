import { mkdtemp, mkdir, writeFile, readdir, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { projectKeyForPath } from '../src/global/next/project-key.js';
import { writeProjectStrategy } from '../src/global/team/project-strategy-store.js';

export async function fixture(t) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'team-route-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const cwd = join(home, 'project');
  await mkdir(cwd);
  execFileSync('git', ['init', '-q', cwd]);
  const model = { adapterId: 'codex', modelId: 'gpt-a', accessMode: 'automatic', utility: 2 };
  const other = { adapterId: 'claude', modelId: 'son-a', accessMode: 'automatic', utility: 1 };
  const strategy = { status: 'active', approvedAt: '2026-10-22T10:00:00Z', profileFingerprint: 'fp', projectTeam: [{ role: 'Builder', model, assignmentSource: 'recommended' }] };
  await writeProjectStrategy(home, cwd, strategy);
  const path = join(home, '.harness', 'sessions', projectKeyForPath(cwd), 'routing-input-cache.json');
  const inputs = { schema: 'kairo.routing-input-cache/v2', generatedAt: Date.now(), approvedAt: strategy.approvedAt,
    roles: { Builder: { pool: [model, other] } }, eligibility: { codex: { ok: true }, claude: { ok: true } }, modelEntitlement: {},
    providerCapacity: { codex: { quotaRemainingPercent: 50 }, claude: { quotaRemainingPercent: 50 } }, models: [model, other], registry: null };
  const cache = async (changes = {}) => writeFile(path, JSON.stringify({ ...inputs, ...changes }));
  // These legacy worlds are host-neutral; host-adaptation tests supply runtime evidence explicitly.
  const env = { ...process.env, HARNESS_HOME: home };
  for (const key of ['KAIRO_HOST', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDECODE', 'OPENCODE_CLIENT']) delete env[key];
  const cli = (...args) => spawnSync(process.execPath, [resolve('bin/kairo.js'), 'team', 'route', '--cwd', cwd, '--json', ...args], { env, encoding: 'utf8' });
  return { home, cwd, strategy, path, inputs, cache, cli, model };
}
export async function tree(path) {
  const rows = [];
  for (const e of (await readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const p = join(path, e.name);
    rows.push([e.name, e.isDirectory() ? await tree(p) : createHash('sha256').update(await readFile(p)).digest('hex')]);
  }
  return rows;
}
