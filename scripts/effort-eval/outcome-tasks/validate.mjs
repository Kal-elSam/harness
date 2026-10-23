import { cp, lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRoot = dirname(fileURLToPath(import.meta.url));
const fields = ['category', 'check', 'fixture', 'id', 'language', 'prompt', 'riskSensitive', 'scope'];
function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
function localPath(root, path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || path.split(/[\\/]/).includes('..')) {
    throw new Error('invalid relative path');
  }
  return resolve(root, path);
}
async function files(root) {
  const result = [];
  async function walk(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error('symlinks are not allowed');
      if (stat.isDirectory()) await walk(path);
      else if (stat.isFile()) result.push(path);
      else throw new Error('only regular files are allowed');
    }
  }
  await walk(root);
  return result;
}

// Runs trusted synthetic acceptance checks only; never invokes an agent or provider.
export async function validateCorpus(root = defaultRoot, { writeProvenance = false } = {}) {
  root = await realpath(root instanceof URL ? fileURLToPath(root) : root);
  const manifestBytes = await readFile(join(root, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (Object.keys(manifest).join() !== 'tasks' || !Array.isArray(manifest.tasks)) throw new Error('invalid manifest');
  const tasks = manifest.tasks;
  if (tasks.length < 24 || tasks.length > 40) throw new Error('task count must be 24-40');
  const ids = new Set();
  const languages = { en: 0, es: 0 };
  const categories = { mechanical: 0, ordinary: 0, reasoning: 0 };
  let riskSensitive = 0;
  const inputs = new Set([join(root, 'manifest.json')]);
  // Validate every entry before executing any check.
  for (const task of tasks) {
    if (Object.keys(task).sort().join() !== fields.join()) throw new Error('invalid task fields (no labels or predictions)');
    if (typeof task.id !== 'string' || !/^[a-z0-9-]+$/.test(task.id)) throw new Error('invalid id');
    if (ids.has(task.id)) throw new Error(`duplicate id: ${task.id}`);
    ids.add(task.id);
    if (!Object.hasOwn(languages, task.language) || !Object.hasOwn(categories, task.category) ||
        typeof task.riskSensitive !== 'boolean' || typeof task.prompt !== 'string' || !task.prompt.trim()) throw new Error('invalid task metadata');
    languages[task.language]++;
    categories[task.category]++;
    riskSensitive += Number(task.riskSensitive);
    const fixture = localPath(root, task.fixture);
    const check = localPath(root, task.check);
    if (!inside(root, await realpath(fixture)) || !inside(root, await realpath(check))) throw new Error('path escapes corpus');
    if (!(await lstat(fixture)).isDirectory() || !(await lstat(check)).isFile()) throw new Error('invalid fixture or check type');
    if (inside(fixture, check)) throw new Error('check must be outside fixture');
    if (!Array.isArray(task.scope) || !task.scope.length || new Set(task.scope).size !== task.scope.length) throw new Error('invalid scope');
    for (const path of task.scope) localPath(fixture, path);
    for (const path of await files(fixture)) inputs.add(path);
    inputs.add(check);
  }
  if (languages.en < tasks.length / 3 || languages.es < tasks.length / 3) throw new Error('language balance requires EN and ES');
  if (riskSensitive < 6) throw new Error('risk balance requires at least six tasks');
  if (Object.values(categories).some(n => n < 1)) throw new Error('category balance requires all three categories');
  // Include shared check helpers as well as individual acceptance commands.
  if (tasks.some(task => task.check.startsWith('checks/'))) {
    for (const path of await files(join(root, 'checks'))) inputs.add(path);
  }
  const hash = createHash('sha256');
  for (const path of [...inputs].sort((a, b) => relative(root, a).localeCompare(relative(root, b), 'en'))) {
    const name = relative(root, path).split(sep).join('/');
    const bytes = path === join(root, 'manifest.json') ? manifestBytes : await readFile(path);
    hash.update(JSON.stringify([name, bytes.length]) + '\n').update(bytes);
  }
  for (const task of tasks) {
    const scratch = await mkdtemp(join(tmpdir(), 'effort-corpus-'));
    try {
      await cp(localPath(root, task.fixture), scratch, { recursive: true });
      const result = spawnSync(process.execPath, [localPath(root, task.check), scratch], {
        cwd: scratch, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024
      });
      if (result.error || result.signal || result.status === null || result.status > 1) throw new Error(`check could not run: ${task.id}`);
      if (result.status === 0) throw new Error(`check passes on untouched fixture: ${task.id}`);
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
  const result = { taskCount: tasks.length, languages, categories, riskSensitive, hash: hash.digest('hex') };
  if (writeProvenance) await writeFile(join(root, 'provenance.json'), JSON.stringify({ algorithm: 'sha256', ...result }, null, 2) + '\n');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  validateCorpus(process.argv[2] || defaultRoot, { writeProvenance: true })
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
