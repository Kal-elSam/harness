import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { constants } from 'node:os';
import { resolveExecutionAdapter } from '../runtime/execution-adapters/index.js';
import gemini from '../runtime/execution-adapters/gemini.js';
import { resolveHomeDir } from '../paths.js';
import { resolveProjectRoot } from '../architect/architect-store.js';
import { readRoutingInputCache, readRoutingLaunchLedger, readTeamRoute, routingInputCachePath, ROUTING_INPUT_CACHE_SCHEMA, ROUTING_INPUT_CACHE_TTL_MS } from './routing-input-cache.js';
import { appendLaunchRecord, appendOutcomeRecord } from './launch-ledger.js';
import { detectExhaustion } from './exhaustion.js';
import { codexAgentMessageText } from '../runtime/codex-agent-message.js';
import { buildCompleteCandidateCatalog } from '../intelligence/model-candidate-catalog.js';
import { readProjectStrategy } from './project-strategy-store.js';
import { resolveTeamProviders } from '../profile.js';
import { listRunRecords } from '../runtime/run-store.js';
import { resolveActiveHost } from '../hosts/active-host.js';
import { kitAgentForRole } from '../hosts/claude-kit.js';
import { readCodexModels } from '../observability/codex-models.js';
import { readOpenCodeModels } from '../observability/opencode-models.js';
import { readClaudeModels } from '../observability/claude-models.js';
import { isCursorAutoModel, readCursorModels } from '../observability/cursor-models.js';

/** Real provider catalogs, the same sources the routing candidate catalog is built from. */
export async function readExecutableProviderCatalogs({ cwd } = {}) {
  const [codex, opencodeGo, cursor] = await Promise.all([
    readCodexModels({ cwd }).catch(() => null),
    readOpenCodeModels({ provider: 'opencode-go' }).catch(() => null),
    readCursorModels({ cwd }).catch(() => null),
  ]);
  return [
    { adapterId: 'codex', models: codex?.models ?? [] },
    { adapterId: 'claude', models: readClaudeModels().models ?? [] },
    { adapterId: 'opencode-go', models: opencodeGo?.models ?? [] },
    { adapterId: 'cursor', models: (cursor?.models ?? []).filter(model => !isCursorAutoModel(model.id)) },
  ];
}

/**
 * Executability from the same complete candidate catalog routing uses, with no
 * approved team required. Automatic access and allowed/not_applicable entitlement
 * only; superseded generations and unknown ids fail closed. Claude has no
 * entitlement map here, so it stays unverified unless the routing cache proves it.
 */
export async function isCatalogModelExecutable({ provider, model, cwd, readCatalogs = readExecutableProviderCatalogs }) {
  const catalog = buildCompleteCandidateCatalog(await readCatalogs({ cwd }), [], {});
  const entry = catalog.find(row => row.adapterId === provider && row.modelId === model);
  return Boolean(entry && entry.lifecycle !== 'superseded' && entry.accessMode === 'automatic'
    && ['allowed', 'not_applicable'].includes(entry.entitlement));
}

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

/** Final assistant message of a `codex exec --json` stream, or null when it has none. */
export function lastCodexAgentMessage(stdout) {
  let last = null;
  for (const line of String(stdout).split('\n')) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    last = codexAgentMessageText(event) ?? last;
  }
  return last;
}

/** Match provider diagnostics, never assistant/task prose that quotes an error. */
function capacityFailure(result, provider) {
  if (result.code === 0 || !['codex', 'claude'].includes(provider)) return null;
  const diagnostics = [];
  for (const line of `${result.stderr}\n${result.stdout}`.split('\n')) {
    try {
      const event = JSON.parse(line);
      if (event.type === 'error' || event.type === 'turn.failed' || event.is_error === true) {
        const error = event.error ?? event.message ?? event.result;
        diagnostics.push({ reason: line, text: typeof error === 'string' ? error
          : error && typeof error === 'object' ? `${error.type ? `${error.type}: ` : ''}${error.message ?? ''}` : '' });
      }
    } catch {
      diagnostics.push({ reason: line.trim(), text: line.trim() });
    }
  }
  // Anchoring prevents ordinary assertion failures that quote a provider error
  // from being replayed as a second task execution.
  // Provider vocabulary: https://status.openai.com/incidents/0pqnp2gq and
  // https://platform.claude.com/docs/en/api/errors (429 rate limit; 529 overloaded).
  const pattern = provider === 'codex'
    ? /^(?:(?:error|codex|openai)[: ]+)*(?:Selected model is at capacity\. Please try a different model\.|rate[ _-]limit[ _-](?:exceeded|reached|error)\b|(?:429[: ]+)?too many requests\b|you've hit your limit\b)/i
    : /^(?:(?:error|claude|anthropic)[: ]+)*(?:rate_limit_error\b|overloaded_error\b|API Error: (?:429|529)\b|you've hit your limit\b)/i;
  return diagnostics.find(({ text }) => pattern.test(text))?.reason ?? null;
}

/** Reuse team route with a request-local rejection; never mutate approval or cached entitlement. */
async function nextExecRoute({ homeDir, projectRoot, role, provider, model, env }) {
  if (!role) return null;
  const [cache, strategy, teamProviders, records, launches] = await Promise.all([
    readRoutingInputCache(homeDir, projectRoot), readProjectStrategy(homeDir, projectRoot),
    resolveTeamProviders({ homeDir, workspaceRoot: projectRoot }), listRunRecords(homeDir),
    readRoutingLaunchLedger(homeDir, projectRoot),
  ]);
  if (!cache) return null;
  const snapshot = { projectRoot, strategy, teamProviders, records, launches, cache: { ...cache,
    modelEntitlement: { ...cache.modelEntitlement, [provider]: { ...cache.modelEntitlement?.[provider],
      [model]: { status: 'denied', reason: 'Rejected for this retry after a provider capacity or rate-limit failure.' } } } } };
  const host = resolveActiveHost({ env });
  for (const constraint of [provider, undefined]) {
    try {
      const route = await readTeamRoute({ role, provider: constraint, cwd: projectRoot, homeDir, activeHost: host.id ? host : undefined }, { snapshot });
      if (route.decision === 'ROUTED' && route.model?.modelId
          && ['codex', 'claude'].includes(route.provider)
          && (route.provider !== provider || route.model.modelId !== model)) return route;
    } catch { /* No admissible route under this constraint; try the other provider. */ }
  }
  return null;
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
    if (options.effort !== undefined && (typeof options.effort !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(options.effort))) {
      throw new Error('Invalid --effort. Use a provider-supported effort name.');
    }
    const openCode = ['opencode', 'opencode-go', 'opencode-zen'].includes(options.provider);
    if (options.effort !== undefined && !['codex', 'claude'].includes(options.provider) && !openCode) {
      throw new Error(`Explicit --effort is not supported for ${options.provider}.`);
    }
    if (options.effort !== undefined && openCode && options.model.includes('#')) {
      throw new Error('Use an unqualified model with --effort; an existing OpenCode variant cannot be overwritten.');
    }
    let adapter = options.provider === 'gemini' ? gemini : resolveExecutionAdapter(options.provider);
    projectRoot = await (deps.resolveRoot ?? resolveProjectRoot)(options.cwd);
    homeDir = deps.homeDir ?? resolveHomeDir();
    const executable = await (deps.isModelExecutable ?? isTeamModelExecutable)({ homeDir, projectRoot, provider: options.provider, model: options.model })
      || await (deps.isCatalogModelExecutable ?? isCatalogModelExecutable)({ provider: options.provider, model: options.model, cwd: projectRoot, readCatalogs: deps.readCatalogs });
    if (!executable) {
      throw new Error(`Model "${options.model}" is not executable for ${options.provider}; refresh with kairo team route --refresh.`);
    }
    const chunks = [];
    for await (const chunk of deps.stdin ?? process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const task = Buffer.concat(chunks).toString('utf8');
    let switchedFrom = null, switchReason = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const launch = adapter.buildLaunch({ task, cwd: projectRoot, model: options.model, env: deps.env ?? process.env });
      // Keep effort translation at this CLI boundary; ordinary adapter callers and
      // launches without an explicit effort retain their existing argv unchanged.
      if (options.effort !== undefined) {
        if (options.provider === 'codex') launch.args.unshift('-c', `model_reasoning_effort=${JSON.stringify(options.effort)}`);
        else if (options.provider === 'claude') launch.args.unshift('--effort', options.effort);
        else launch.args[launch.args.indexOf('--model') + 1] = `${options.model}#${options.effort}`;
      }
      // --no-record: the caller (kairo-router) already owns this launch's ledger rows.
      record = options.noRecord ? null : { role: options.role ?? 'task', agent: `kairo-${options.provider}`, adapterId: options.provider, modelId: options.model, ...(switchedFrom ? { switchedFrom, reason: switchReason } : {}) };
      if (record) await (deps.appendLaunchRecord ?? appendLaunchRecord)(homeDir, projectRoot, record);
      childResult = undefined;
      childResult = await new Promise((resolve, reject) => {
        const child = (deps.spawn ?? spawn)(launch.command, launch.args, {
          cwd: launch.cwd, env: launch.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
        });
        const out = [], err = [];
        // Codex emits raw JSONL; buffer it and return the final assistant message instead.
        child.stdout.on('data', chunk => { out.push(Buffer.from(chunk)); if (options.provider !== 'codex') (deps.stdout ?? process.stdout).write(chunk); });
        child.stderr.on('data', chunk => { err.push(Buffer.from(chunk)); stderr.write(chunk); });
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({
          code: code ?? (signal && constants.signals[signal] ? 128 + constants.signals[signal] : 1),
          stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'),
        }));
      });
      const capacityReason = capacityFailure(childResult, options.provider);
      if (!capacityReason || attempt === 1) break;
      let next = null;
      try {
        next = await (deps.nextExecRoute ?? nextExecRoute)({ homeDir, projectRoot, role: options.role,
          provider: options.provider, model: options.model, env: deps.env ?? process.env });
      } catch { /* Routing is unavailable: preserve the original failure. */ }
      if (!next) {
        stderr.write('No in-band alternative is available; failing with the original provider error.\n');
        break;
      }
      if (record) await (deps.appendOutcomeRecord ?? appendOutcomeRecord)(homeDir, projectRoot, {
        ...record, status: 'failed', reason: capacityReason,
      });
      switchedFrom = { adapterId: options.provider, modelId: options.model };
      switchReason = capacityReason;
      stderr.write(`Switched ${options.provider}/${options.model} -> ${next.provider}/${next.model.modelId}: ${capacityReason.replace(/[\r\n]+/g, ' ')}\n`);
      options = { ...options, provider: next.provider, model: next.model.modelId, effort: next.effort };
      adapter = resolveExecutionAdapter(options.provider);
    }
    const exhaustion = detectExhaustion(`${childResult.stdout}\n${childResult.stderr}`, { provider: options.provider, exitCode: childResult.code });
    const stdout = deps.stdout ?? process.stdout;
    if (exhaustion) {
      // Same contract as the hand-built agents; the fallback is the Claude-native Kairo agent of the role.
      const fallback = kitAgentForRole(options.role);
      stdout.write(`status: blocked\nreason: ${exhaustion.reason}\n${fallback ? `fallback: ${fallback}\n` : ''}`);
    } else if (options.provider === 'codex') {
      const message = lastCodexAgentMessage(childResult.stdout);
      stdout.write(message === null ? childResult.stdout : `${message}\n`);
    }
    if (record) await (deps.appendOutcomeRecord ?? appendOutcomeRecord)(homeDir, projectRoot, {
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
