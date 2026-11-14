import { spawn } from 'node:child_process';
import { basename, delimiter, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { access, constants as fsConstants, open as fsOpen, readdir, realpath } from 'node:fs/promises';
import { resolveCodexHome } from './codex-sandbox.js';

/**
 * Observability only: this module records evidence about one Codex execution and
 * grants no authority. Nothing here may feed routing, admission, quota or verdicts.
 * The coverage of the checks is tied to the pinned Codex version below.
 */
export const CODEX_PIN = Object.freeze({
  version: 'codex-cli 0.166.0',
  teamIdentifier: '2DC432GLL2',
  chatgptBaseUrl: 'https://chatgpt.com/backend-api/',
});

// 'controlled' is deliberately absent: provider credit is disabled (R2b closed with provenance only).
export const CODEX_EVIDENCE_STATES = Object.freeze(['none-detected', 'untrusted']);
export const CODEX_UNTRUSTED_REASONS = Object.freeze([
  'config-disallowed', 'argv-disallowed', 'layer-unknown', 'requirements-present', 'proxy-enabled',
  'signature-invalid', 'team-mismatch', 'thread-id-invalid', 'thread-id-conflict',
  'rollout-multiple', 'rollout-mismatch', 'rollout-not-regular',
]);
export const CODEX_NONE_DETECTED_REASONS = Object.freeze([
  'check-unavailable', 'check-timeout', 'unsupported-platform', 'version-unpinned', 'no-thread-id',
  'no-rollout', 'exit-nonzero', 'no-turn-completed', 'rollout-incomplete', 'rollout-unparseable', 'rollout-too-large',
  'evidence-timeout', 'other-codex-process', 'provider-credit-disabled',
]);
export const CODEX_EVIDENCE_REASONS = Object.freeze([...CODEX_UNTRUSTED_REASONS, ...CODEX_NONE_DETECTED_REASONS]);

const ENV_ALLOWLIST = Object.freeze(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TERM']);
const ALLOWED_LAYERS = Object.freeze(['sessionFlags', 'user', 'system']);
const THREAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHECK_TIMEOUT_MS = 5_000;
const APP_SERVER_TIMEOUT_MS = 10_000;
const EVIDENCE_TIMEOUT_MS = 5_000;
const MAX_ROLLOUT_BYTES = 64 * 1024 * 1024;
const SIGNATURE_REQUIREMENT = `anchor apple generic and certificate leaf[subject.OU] = "${CODEX_PIN.teamIdentifier}"`;
const PIN_NUMBER = CODEX_PIN.version.split(' ').pop();

export const isCodexThreadId = value => typeof value === 'string' && THREAD_ID.test(value);

/** Exact allowlist plus the resolved CODEX_HOME. Unlike SAFE_ENV_KEYS it carries no proxy, CA or override variable. */
export function buildVerifiedCodexEnv(sourceEnv = process.env, resolvedCodexHome = resolveCodexHome({ sourceEnv })) {
  const env = Object.create(null);
  for (const key of ENV_ALLOWLIST) {
    if (sourceEnv[key] != null && sourceEnv[key] !== '') env[key] = sourceEnv[key];
  }
  env.CODEX_HOME = resolvedCodexHome;
  return env;
}

/** Absolute real path of the first executable `codex` on the allowlisted PATH, or null. */
export async function resolveCodexExecutable(env, deps = {}) {
  for (const dir of String(env.PATH ?? '').split(delimiter)) {
    if (!dir || !dir.startsWith('/')) continue;
    try {
      const candidate = join(dir, 'codex');
      await (deps.access ?? access)(candidate, fsConstants.X_OK);
      return await (deps.realpath ?? realpath)(candidate);
    } catch { /* Try the next PATH entry. */ }
  }
  return null;
}

/** Run one short-lived helper command with a hard timeout; always resolves, never leaves a process behind. */
export function runBoundedCommand(command, args, { env, cwd, timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let child, done = false;
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { try { child?.kill('SIGKILL'); } catch { /* Already gone. */ } finish(reject, Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); }, timeoutMs);
    try { child = spawn(command, args, { env, cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (error) { finish(reject, error); return; }
    const out = [], err = [];
    child.stdout.on('data', chunk => out.push(Buffer.from(chunk)));
    child.stderr.on('data', chunk => err.push(Buffer.from(chunk)));
    child.once('error', error => finish(reject, error));
    child.once('close', code => finish(resolve, { code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
  });
}

/**
 * One app-server over stdio: initialize, initialized, config/read, configRequirements/read.
 * Bounded and always killed. Returns { config, layers, requirements }.
 */
export function readCodexEffectiveConfig({ executable, args = [], env, cwd, timeoutMs = APP_SERVER_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let child, done = false, buffer = '';
    const results = new Map();
    const finish = (fn, value) => {
      if (done) return; done = true; clearTimeout(timer);
      try { child?.kill('SIGKILL'); } catch { /* Already gone. */ }
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), timeoutMs);
    try {
      child = spawn(executable, ['app-server', ...args], { env, cwd, shell: false, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (error) { finish(reject, error); return; }
    const send = message => { try { child.stdin.write(JSON.stringify(message) + '\n'); } catch (error) { finish(reject, error); } };
    child.stdin.on('error', () => {});
    child.once('error', error => finish(reject, error));
    child.once('close', () => finish(reject, new Error('app-server closed')));
    child.stdout.on('data', chunk => {
      buffer += chunk.toString('utf8');
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message?.error && message.id != null) { finish(reject, new Error('app-server error')); return; }
        if (message?.id === 1 && 'result' in message) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'config/read', params: { includeLayers: true, cwd } });
          send({ id: 3, method: 'configRequirements/read' });
        } else if ((message?.id === 2 || message?.id === 3) && 'result' in message) {
          results.set(message.id, message.result);
          if (results.size === 2) {
            const read = results.get(2), requirements = results.get(3);
            finish(resolve, { config: read?.config, layers: read?.layers, requirements: requirements?.requirements });
            return;
          }
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'kairo-provider-evidence', version: '1' } } });
  });
}

/** Only the argv a verified team exec emits, plus the effort override. `--` precedes the task so stdin text can never parse as an option. */
export function checkCodexArgv(args, model) {
  if (!Array.isArray(args) || args.length < 5 || args[args.length - 2] !== '--' || args[0] !== 'exec') return false; // exec first: a verified launch never reads as an ambiguous option-first process
  const flags = args.slice(0, -2);
  const seen = new Set();
  for (let i = 0; i < flags.length; i++) {
    const arg = flags[i];
    if (arg === '-c') {
      const value = flags[++i];
      if (typeof value !== 'string' || !/^model_reasoning_effort=.+/s.test(value) || seen.has('effort')) return false;
      seen.add('effort');
    } else if (arg === '--model') {
      if (flags[++i] !== model || seen.has('model')) return false;
      seen.add('model');
    } else if (['exec', '--json', '--approve-for-me'].includes(arg)) {
      if (seen.has(arg)) return false;
      seen.add(arg);
    } else return false;
  }
  return seen.has('exec') && seen.has('--json') && seen.has('--approve-for-me') && seen.has('model');
}

const nullish = value => value === null || value === undefined;

/** Config policy: returns the untrusted reasons found in an effective config plus its layers and requirements. */
export function checkCodexConfig({ config, layers, requirements }) {
  const reasons = new Set(), unavailable = new Set();
  if (!config || typeof config !== 'object') unavailable.add('check-unavailable');
  else {
    const provider = config.model_provider;
    if (!(nullish(provider) || provider === 'openai') || !nullish(config.openai_base_url) || !nullish(config.oss_provider)
        || !nullish(config.profile)
        || !(nullish(config.model_providers) || (typeof config.model_providers === 'object' && Object.keys(config.model_providers).length === 0))
        || !(nullish(config.chatgpt_base_url) || config.chatgpt_base_url === CODEX_PIN.chatgptBaseUrl)) reasons.add('config-disallowed');
  }
  if (!Array.isArray(layers)) unavailable.add('check-unavailable');
  else if (layers.some(layer => !ALLOWED_LAYERS.includes(layer?.name?.type))) reasons.add('layer-unknown');
  if (requirements === undefined) unavailable.add('check-unavailable');
  else if (requirements !== null) reasons.add('requirements-present');
  return { untrusted: [...reasons], unavailable: [...unavailable] };
}

function failureReason(error) { return error?.code === 'ETIMEDOUT' ? 'check-timeout' : 'check-unavailable'; }

/**
 * Process identification from one `ps -axww -o pid= -o comm=` read; no argument text is read or interpreted.
 * Returns 'failed' (non-zero exit or no parsable row: ps always lists at least itself, so zero rows is a failed read, not an absence),
 * 'foreign' (some row other than `ownPid` has a comm basename of exactly `codex` or `(codex)`) or 'clear'.
 */
export function detectForeignCodexProcess(psResult, ownPid = process.pid) {
  if (psResult.code !== 0) return 'failed';
  const rows = String(psResult.stdout).split('\n').flatMap(line => { const m = /^\s*(\d+)\s+(.*\S)\s*$/.exec(line); return m ? [[m[1], m[2]]] : []; });
  if (!rows.length) return 'failed';
  return rows.some(([pid, comm]) => pid !== String(ownPid) && ['codex', '(codex)'].includes(basename(comm))) ? 'foreign' : 'clear';
}

/**
 * Deterministic preflight, run once per execution call by the caller. Never throws and never blocks:
 * returns { untrusted: [...], unavailable: [...] } with fixed-vocabulary reasons only.
 */
export async function runCodexPreflight({ executable, args, env, cwd, model }, deps = {}) {
  const untrusted = new Set(), unavailable = new Set();
  const exec = deps.exec ?? runBoundedCommand;
  const platform = deps.platform ?? process.platform;
  const guard = async (fn) => { try { return await fn(); } catch (error) { unavailable.add(failureReason(error)); return null; } };
  if (!executable) unavailable.add('check-unavailable');
  else {
    const version = await guard(() => exec(executable, ['--version'], { env, cwd, timeoutMs: CHECK_TIMEOUT_MS }));
    if (version && (version.code !== 0 || version.stdout.trim() !== CODEX_PIN.version)) unavailable.add('version-unpinned');
    if (platform !== 'darwin') unavailable.add('unsupported-platform');
    else {
      // Trusted Apple chain, expected Team ID and signature validity in one check, on the exact path that is launched.
      const strict = await guard(() => exec('/usr/bin/codesign', ['--verify', '--strict', `-R=${SIGNATURE_REQUIREMENT}`, executable], { env, cwd, timeoutMs: CHECK_TIMEOUT_MS }));
      if (strict && strict.code !== 0) untrusted.add('signature-invalid');
      const proxy = await guard(() => exec('/usr/sbin/scutil', ['--proxy'], { env, cwd, timeoutMs: CHECK_TIMEOUT_MS }));
      if (proxy) {
        if (proxy.code !== 0) unavailable.add('check-unavailable');
        else if (/^\s*\w*Enable\s*:\s*1\s*$/m.test(proxy.stdout)) untrusted.add('proxy-enabled');
      }
    }
    // Checked before spawning our own app-server, so ours can never be mistaken for a pre-existing one.
    const procs = await guard(async () => detectForeignCodexProcess(await exec('/bin/ps', ['-axww', '-o', 'pid=', '-o', 'comm='], { env, cwd, timeoutMs: CHECK_TIMEOUT_MS }), deps.pid ?? process.pid));
    if (procs === 'failed') unavailable.add('check-unavailable');
    else if (procs === 'foreign') unavailable.add('other-codex-process');
    const argvOk = checkCodexArgv(args, model);
    if (!argvOk) untrusted.add('argv-disallowed');
    if (argvOk) {
      const flags = [];
      for (let i = 0; i < args.length - 2; i++) if (args[i] === '-c') flags.push('-c', args[++i]);
      const read = await guard(() => (deps.readConfig ?? readCodexEffectiveConfig)({ executable, args: flags, env, cwd, timeoutMs: APP_SERVER_TIMEOUT_MS }));
      if (read) {
        const checked = checkCodexConfig(read);
        checked.untrusted.forEach(reason => untrusted.add(reason));
        checked.unavailable.forEach(reason => unavailable.add(reason));
      }
    }
  }
  return { untrusted: [...untrusted], unavailable: [...unavailable] };
}

function parseChildEvents(stdout) {
  const ids = [];
  let completed = false;
  for (const line of String(stdout).split('\n')) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'thread.started') ids.push(event.thread_id);
    if (event.type === 'turn.completed') completed = true;
  }
  return { count: ids.length, threadId: ids.length === 1 && isCodexThreadId(ids[0]) ? ids[0] : null, invalid: ids.some(id => !isCodexThreadId(id)), completed };
}

/** Rollouts under CODEX_HOME/sessions whose file name ends with the thread id; never found by time. Non-regular entries are flagged, never opened. */
async function findRollouts(codexHome, threadId, signal, deps) {
  const list = deps.readdir ?? (dir => readdir(dir, { withFileTypes: true }));
  const found = [];
  const walk = async (dir, depth) => {
    if (signal.aborted) return;
    let entries; try { entries = await list(dir); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (signal.aborted) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { if (depth < 4) await walk(path, depth + 1); }
      else if (entry.name.startsWith('rollout-') && entry.name.endsWith(`${threadId}.jsonl`)) found.push({ path, regular: entry.isFile() });
    }
  };
  await walk(join(codexHome, 'sessions'), 0);
  return found;
}

/** Stream the whole rollout once; returns reasons only. Never follows symlinks or blocks on a FIFO. */
async function inspectRollout(path, { threadId, cwd, model }, signal, deps) {
  const reasons = new Set();
  let handle, closed = false;
  // Closing on abort releases a pending read where the platform allows; it runs at most once.
  const closeOnce = () => { if (closed || !handle) return Promise.resolve(); closed = true; return handle.close().catch(() => {}); };
  const onAbort = () => { closeOnce(); };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    handle = await (deps.open ?? fsOpen)(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
    if (signal.aborted) return ['evidence-timeout'];
    const info = await handle.stat();
    if (!info.isFile()) return ['rollout-not-regular'];
    if (info.size > (deps.maxRolloutBytes ?? MAX_ROLLOUT_BYTES)) return ['rollout-too-large'];
    const metas = [], contexts = [], completions = [];
    let malformed = false, total = 0, pending = '';
    const decoder = new StringDecoder('utf8'), chunk = Buffer.alloc(64 * 1024);
    const take = line => {
      if (!line.trim()) return;
      let row; try { row = JSON.parse(line); } catch { malformed = true; return; }
      if (!row || typeof row !== 'object') { malformed = true; return; }
      if (row.type === 'session_meta') metas.push(row.payload);
      else if (row.type === 'turn_context') contexts.push(row.payload);
      else if (row.type === 'event_msg' && row.payload?.type === 'task_complete') completions.push(row.payload);
    };
    for (;;) {
      if (signal.aborted) return ['evidence-timeout'];
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > (deps.maxRolloutBytes ?? MAX_ROLLOUT_BYTES)) return ['rollout-too-large'];
      pending += decoder.write(chunk.subarray(0, bytesRead));
      let index;
      while ((index = pending.indexOf('\n')) >= 0) { take(pending.slice(0, index)); pending = pending.slice(index + 1); }
    }
    take(pending + decoder.end());
    if (malformed) reasons.add('rollout-unparseable');
    const meta = metas[0];
    if (metas.length !== 1) reasons.add('rollout-mismatch');
    else if (!meta || meta.id !== threadId || meta.originator !== 'codex_exec' || meta.source !== 'exec' || meta.model_provider !== 'openai' || meta.cli_version !== PIN_NUMBER) reasons.add('rollout-mismatch');
    else {
      try {
        const real = deps.realpath ?? realpath;
        if (typeof meta.cwd !== 'string' || await real(meta.cwd) !== await real(cwd)) reasons.add('rollout-mismatch');
      } catch { reasons.add('rollout-mismatch'); }
    }
    if (contexts.length > 1 || contexts.some(context => context?.model !== model)) reasons.add('rollout-mismatch');
    if (completions.length > 1) reasons.add('rollout-mismatch');
    else if (!contexts.length || !completions.length) reasons.add('rollout-incomplete');
    else if (!contexts[0]?.turn_id || completions[0].turn_id !== contexts[0].turn_id) reasons.add('rollout-mismatch');
  } catch (error) {
    reasons.add(error?.code === 'ELOOP' || error?.code === 'EMLINK' ? 'rollout-not-regular' : 'check-unavailable');
  } finally { signal.removeEventListener('abort', onAbort); await closeOnce(); }
  return [...reasons];
}

async function linkRollout({ codexHome, threadId, cwd, model }, signal, deps) {
  const rollouts = await findRollouts(codexHome, threadId, signal, deps);
  if (signal.aborted) return ['evidence-timeout'];
  if (rollouts.length > 1) return ['rollout-multiple'];
  if (!rollouts.length) return ['no-rollout'];
  if (!rollouts[0].regular) return ['rollout-not-regular'];
  return inspectRollout(rollouts[0].path, { threadId, cwd, model }, signal, deps);
}

// Only objects produced by classifyCodexExecution in this process are registered; shape alone never earns credit.
const classified = new WeakSet();
export const isClassifiedCodexEvidence = value => value !== null && typeof value === 'object' && classified.has(value);

const frozenEvidence = ({ state, reasons, requestedModelId, threadId, executionId, rolloutLinked }) => {
  const evidence = Object.freeze({
    provider: 'codex', status: state, providerVerified: false, rolloutLinked: rolloutLinked === true,
    requestedModelId: requestedModelId ?? null, servedModelId: null, modelVerified: false,
    threadId: threadId ?? null, executionId: executionId ?? null, source: 'runtime-rollout',
    reasons: Object.freeze(CODEX_EVIDENCE_REASONS.filter(reason => reasons.has(reason))),
  });
  classified.add(evidence);
  return evidence;
};

/**
 * Classify one finished execution. untrusted wins over none-detected. Provider credit is disabled:
 * the result is never controlled and providerVerified is always false; a fully clean run is
 * none-detected with provider-credit-disabled. rolloutLinked records the thread_id to rollout link
 * alone. Never throws.
 */
export async function classifyCodexExecution({ preflight, requestedModel, executionId, cwd, codexHome, result }, deps = {}) {
  const reasons = new Set([...(preflight?.untrusted ?? []), ...(preflight?.unavailable ?? [])]);
  let threadId = null, rolloutLinked = false;
  try {
    const events = parseChildEvents(result?.stdout);
    if (events.invalid) reasons.add('thread-id-invalid');
    if (events.count > 1) reasons.add('thread-id-conflict');
    if (events.count === 0) reasons.add('no-thread-id');
    threadId = events.threadId;
    if (result?.code !== 0) reasons.add('exit-nonzero');
    if (!events.completed) reasons.add('no-turn-completed');
    if (threadId) {
      // One overall deadline for the whole evidence read; the reader is abortable and never leaves the call hanging.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), deps.evidenceTimeoutMs ?? EVIDENCE_TIMEOUT_MS);
      const expired = new Promise(resolve => controller.signal.addEventListener('abort', () => resolve(['evidence-timeout']), { once: true }));
      try {
        const link = linkRollout({ codexHome, threadId, cwd, model: requestedModel }, controller.signal, deps).catch(() => ['check-unavailable']);
        const linkReasons = await Promise.race([link, expired]);
        rolloutLinked = linkReasons.length === 0;
        linkReasons.forEach(reason => reasons.add(reason));
      } finally { clearTimeout(timer); controller.abort(); }
    }
  } catch { reasons.add('check-unavailable'); }
  const untrusted = CODEX_UNTRUSTED_REASONS.some(reason => reasons.has(reason));
  // Hard gate: credit never returns here until a later validation; a clean run only says why.
  if (!untrusted && !reasons.size) reasons.add('provider-credit-disabled');
  return frozenEvidence({ state: untrusted ? 'untrusted' : 'none-detected', reasons, requestedModelId: requestedModel, threadId, executionId, rolloutLinked });
}

/** Everything a verified launch needs, computed once per execution call. Never throws; `failure` is 'env' or 'executable' when no trusted launch can be built. */
export async function prepareVerifiedCodexLaunch({ args, cwd, model, sourceEnv = process.env }, deps = {}) {
  let codexHome = null, env = Object.create(null), executable = null, preflight, failure;
  try {
    codexHome = (deps.resolveCodexHome ?? resolveCodexHome)({ sourceEnv });
    env = buildVerifiedCodexEnv(sourceEnv, codexHome);
  } catch { failure = 'env'; env = Object.create(null); codexHome = null; }
  if (!failure) {
    try {
      executable = await resolveCodexExecutable(env, deps);
      if (!executable) failure = 'executable';
      else preflight = await runCodexPreflight({ executable, args, env, cwd, model }, deps);
    } catch { preflight = { untrusted: [], unavailable: ['check-unavailable'] }; }
  }
  // `failure` means the trusted environment or the executable is missing: the caller must not launch.
  return { env, executable, codexHome, preflight: preflight ?? { untrusted: [], unavailable: ['check-unavailable'] }, ...(failure ? { failure } : {}) };
}
