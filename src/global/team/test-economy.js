import { spawn, spawnSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { performance } from 'node:perf_hooks';

async function testFiles(root) {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.(?:[cm]?js)$/.test(entry.name)) files.push(relative(root, path).split('\\').join('/'));
    }
  }
  await walk(join(root, 'test'));
  return files.sort();
}

function testEnvironment() {
  const env = { ...process.env };
  // Nested node:test contexts suppress the standalone child's reporter.
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function execute(file, root) {
  return new Promise(resolveRun => {
    const started = performance.now();
    const child = spawn(process.execPath, ['--test', file], { cwd: root, stdio: 'ignore', timeout: 120_000, env: testEnvironment() });
    let error;
    child.on('error', value => { error = value.message; });
    child.on('close', (code, signal) => resolveRun({ file, durationMs: performance.now() - started, exitCode: code, ...(signal ? { signal } : {}), ...(error ? { error } : {}) }));
  });
}

async function measure(root, files) {
  const started = performance.now(); const timings = []; let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
    while (next < files.length) timings.push(await execute(files[next++], root));
  }));
  return { version: 1, root, measuredAt: new Date().toISOString(), elapsedMs: performance.now() - started, timings };
}

async function redundancyCandidates(root, files) {
  const groups = new Map(); const coupled = [];
  for (const file of files) {
    const source = await readFile(join(root, file), 'utf8');
    const commands = [...new Set([...source.matchAll(/['"`]kairo ([a-z][a-z-]*(?: [a-z][a-z-]*)?)/g)].map(match => match[1]))].sort();
    const assertions = [...new Set(source.split('\n').filter(line => /^\s*assert\./.test(line)).map(line => line.trim().replace(/\s+/g, ' ')))].sort();
    if (commands.length && assertions.length >= 2) {
      const signature = JSON.stringify([commands, assertions]);
      groups.set(signature, [...(groups.get(signature) ?? []), file]);
    }
    if (/readFile(?:Sync)?\([^\n]*(?:src\/|\.\.\/src)/.test(source)) coupled.push(file);
  }
  return { duplicateAssertions: [...groups.values()].filter(group => group.length > 1), sourceInspection: coupled };
}

/** Public CLI handler; impact failures never masquerade as an empty affected set. */
export async function runTestEconomyCli(argv) {
  if (argv[0] === '--help' || argv[0] === '-h') argv = ['affected', '--help'];
  const [action, ...args] = argv;
  const options = { cwd: process.cwd(), base: 'HEAD' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--run', '--stdin', '--help', '-h'].includes(arg)) options[arg === '-h' ? 'help' : arg.slice(2)] = true;
    else if (['--cwd', '--base', '--cache'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = value;
    } else throw new Error(`Unknown test option: ${arg}`);
  }
  if (options.help || !action) {
    console.log('kairo test affected [--base REF | --stdin] [--run] [--cwd ROOT]\nkairo test audit (--run [--cache FILE] | --cache FILE) [--cwd ROOT]');
    return;
  }
  if (!['affected', 'audit'].includes(action)) throw new Error('Use kairo test affected or kairo test audit.');
  if (options.stdin && args.includes('--base')) throw new Error('Use --base REF or --stdin, not both.');
  const root = resolve(options.cwd); const files = await testFiles(root);
  if (action === 'affected') {
    let changed;
    if (options.stdin) {
      let input = ''; for await (const chunk of process.stdin) input += chunk;
      changed = input.split(/\r?\n/).filter(Boolean);
    } else {
      const diff = spawnSync('git', ['diff', '--name-only', '-z', options.base, '--'], { cwd: root, encoding: 'utf8' });
      if (diff.error || diff.status !== 0) throw new Error(`Cannot determine changed files: ${diff.stderr || diff.error?.message}`);
      const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
      if (untracked.error || untracked.status !== 0) throw new Error('Cannot determine untracked changed files.');
      changed = [...new Set((diff.stdout + untracked.stdout).split('\0').filter(Boolean))];
    }
    try {
      const graph = spawnSync('codegraph', ['affected', '--stdin', '-p', root, '--json'], { cwd: root, input: changed.join('\n') + '\n', encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
      if (graph.error || graph.status !== 0) throw new Error(graph.error?.message || graph.stderr || `exit ${graph.status}`);
      const data = JSON.parse(graph.stdout);
      if (!Array.isArray(data.affectedTests) || !data.affectedTests.every(file => typeof file === 'string')) throw new Error('Invalid affectedTests response');
      const selected = [...new Set([...data.affectedTests.map(file => relative(root, resolve(root, file)).split('\\').join('/')), ...changed.filter(file => files.includes(file))])].sort();
      if (selected.some(file => !files.includes(file))) throw new Error('CodeGraph returned test paths outside the discovered test set');
      console.log(`Affected test files: ${selected.length} of ${files.length}\n${selected.join('\n')}`.trimEnd());
      if (options.run && selected.length) {
        // Batch explicit paths to avoid platform argv limits without running unselected tests.
        for (let i = 0; i < selected.length; i += 100) {
          const result = spawnSync(process.execPath, ['--test', ...selected.slice(i, i + 100)], { cwd: root, stdio: 'inherit', env: testEnvironment() });
          if (result.error || result.status !== 0) process.exitCode = 1;
        }
      }
    } catch (error) {
      console.error(`CodeGraph unavailable: ${error.message}. Affected count unknown of ${files.length}; run the full suite once per slice. No tests were run.`);
      process.exitCode = 1;
    }
    return;
  }
  if (options.stdin || options.base !== 'HEAD') throw new Error('--stdin and --base apply only to affected.');
  let audit;
  if (options.run) {
    audit = await measure(root, files);
    if (options.cache) await writeFile(resolve(root, options.cache), JSON.stringify(audit, null, 2) + '\n');
  } else {
    if (!options.cache) throw new Error('Audit requires --run or --cache FILE; --run executes every test file once.');
    audit = JSON.parse(await readFile(resolve(root, options.cache), 'utf8'));
    if (audit.version !== 1 || audit.root !== root || !Array.isArray(audit.timings) || !Number.isFinite(audit.elapsedMs) || !audit.timings.every(row => files.includes(row.file) && Number.isFinite(row.durationMs) && row.durationMs >= 0 && (row.exitCode === null || Number.isInteger(row.exitCode)))) throw new Error('Invalid audit cache or different project root.');
  }
  const sorted = [...audit.timings].sort((a, b) => b.durationMs - a.durationMs);
  console.log(`Measured: ${audit.measuredAt}; ${sorted.length} of ${files.length} files (cached timings may be stale)\nSlowest files (wall time per file, up to 4 concurrent processes):`);
  for (const row of sorted.slice(0, 10)) console.log(`${row.durationMs.toFixed(1)} ms  ${row.file}  exit=${row.exitCode}${row.signal ? ` signal=${row.signal}` : ''}`);
  console.log(`Total file time: ${sorted.reduce((sum, row) => sum + row.durationMs, 0).toFixed(1)} ms; elapsed: ${audit.elapsedMs.toFixed(1)} ms`);
  const failed = sorted.filter(row => row.exitCode !== 0);
  console.log(`Failed files: ${failed.length}${failed.length ? '\n' + failed.map(row => `${row.file}: exit=${row.exitCode}${row.signal ? ` signal=${row.signal}` : ''}${row.error ? ` error=${row.error}` : ''}`).join('\n') : ''}`);
  const candidates = await redundancyCandidates(root, files);
  console.log('Candidate redundancies (report only; never deleted): same literal kairo command(s) and identical sets of at least two assertion lines. Source inspection is an implementation-coupling signal, not proof of redundancy.');
  console.log(candidates.duplicateAssertions.length ? candidates.duplicateAssertions.map(group => group.join(', ')).join('\n') : 'No duplicate assertion candidates.');
  console.log(`Source-inspection candidates: ${candidates.sourceInspection.length}${candidates.sourceInspection.length ? '\n' + candidates.sourceInspection.join('\n') : ''}`);
  if (failed.length) process.exitCode = 1;
}
