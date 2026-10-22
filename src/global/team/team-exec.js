import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { constants } from 'node:os';
import { resolveExecutionAdapter } from '../runtime/execution-adapters/index.js';
import gemini from '../runtime/execution-adapters/gemini.js';
import { resolveHomeDir } from '../paths.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { routingInputCachePath, ROUTING_INPUT_CACHE_SCHEMA, ROUTING_INPUT_CACHE_TTL_MS } from './routing-input-cache.js';
import { appendLaunchRecord, appendOutcomeRecord } from './launch-ledger.js';
import { detectExhaustion } from './exhaustion.js';

/** Cached executability only: never probes a provider or substitutes a model. */
export async function isTeamModelExecutable({ homeDir, projectRoot, provider, model, now = Date.now }) {
  let cache;
  try { cache = JSON.parse(await readFile(routingInputCachePath(homeDir, projectRoot), 'utf8')); }
  catch { return false; }
  const at = now();
  if (cache?.schema !== ROUTING_INPUT_CACHE_SCHEMA || !Number.isFinite(cache.generatedAt)
      || cache.generatedAt > at || at - cache.generatedAt > ROUTING_INPUT_CACHE_TTL_MS
      || cache.eligibility?.[provider]?.ok !== true) return false;
  const entry = cache.models?.find(row => row.adapterId === provider && row.modelId === model);
  if (!entry || entry.accessMode !== 'automatic') return false;
  const entitlement = cache.modelEntitlement?.[provider]?.[model];
  return !entitlement || ['allowed', 'not_applicable'].includes(entitlement.status);
}

/** Execute one routed task, preserving argv, output bytes, and the child's exit code. */
export async function runTeamExecCli(options, deps = {}) {
  const stderr = deps.stderr ?? process.stderr;
  let record, projectRoot, homeDir, childResult;
  try {
    for (const key of ['provider', 'model']) {
      if (typeof options[key] !== 'string' || !options[key].trim() || options[key].startsWith('-')) {
        throw new Error(`Missing --${key}. Use kairo team exec --provider P --model M.`);
      }
    }
    const adapter = options.provider === 'gemini' ? gemini : resolveExecutionAdapter(options.provider);
    projectRoot = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
    homeDir = deps.homeDir ?? resolveHomeDir();
    if (!await (deps.isModelExecutable ?? isTeamModelExecutable)({ homeDir, projectRoot, provider: options.provider, model: options.model })) {
      throw new Error(`Model "${options.model}" is not executable for ${options.provider}; refresh with kairo team route --refresh.`);
    }
    const chunks = [];
    for await (const chunk of deps.stdin ?? process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const task = Buffer.concat(chunks).toString('utf8');
    const launch = adapter.buildLaunch({ task, cwd: projectRoot, model: options.model, env: deps.env ?? process.env });
    record = { role: options.role ?? 'task', agent: `kairo-${options.provider}`, adapterId: options.provider, modelId: options.model };
    await (deps.appendLaunchRecord ?? appendLaunchRecord)(homeDir, projectRoot, record);
    childResult = await new Promise((resolve, reject) => {
      const child = (deps.spawn ?? spawn)(launch.command, launch.args, {
        cwd: launch.cwd, env: launch.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const out = [], err = [];
      child.stdout.on('data', chunk => { out.push(Buffer.from(chunk)); (deps.stdout ?? process.stdout).write(chunk); });
      child.stderr.on('data', chunk => { err.push(Buffer.from(chunk)); stderr.write(chunk); });
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({
        code: code ?? (signal && constants.signals[signal] ? 128 + constants.signals[signal] : 1),
        stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'),
      }));
    });
    const exhaustion = detectExhaustion(`${childResult.stdout}\n${childResult.stderr}`, { provider: options.provider, exitCode: childResult.code });
    await (deps.appendOutcomeRecord ?? appendOutcomeRecord)(homeDir, projectRoot, {
      ...record, status: exhaustion ? 'exhausted' : childResult.code === 0 ? 'completed' : 'failed',
      ...(exhaustion ? { reason: exhaustion.reason } : {}),
    });
    return childResult.code;
  } catch (error) {
    // A spawn failure still terminates its recorded launch; validation failures do not count.
    if (record && !childResult) {
      await (deps.appendOutcomeRecord ?? appendOutcomeRecord)(homeDir, projectRoot, { ...record, status: 'failed' }).catch(() => {});
    }
    stderr.write(String(error.message).replace(/[\r\n]+/g, ' ') + '\n');
    return childResult?.code || 1;
  }
}
