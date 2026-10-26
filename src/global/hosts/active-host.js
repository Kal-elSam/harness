import { getHost } from './registry.js';

const supported = new Set(['claude-code', 'codex', 'opencode']);

/** Session evidence only: installed directories and configured default models are not identity. */
export function resolveActiveHost({ host, env = {} } = {}) {
  const explicit = typeof host === 'object' && host !== null ? host.id : host;
  const bound = explicit ?? env.KAIRO_HOST;
  if (bound != null) {
    const id = bound === 'claude' ? 'claude-code' : bound;
    if (!supported.has(id)) {
      throw Object.assign(new Error(`Unsupported active host "${bound}". Use claude-code, codex, or opencode.`), { code: 'unsupported_host' });
    }
    return { id, source: typeof host === 'object' ? host.source ?? 'explicit' : explicit ? 'explicit' : 'binding', model: null };
  }
  const detected = [env.CLAUDECODE === '1' ? 'claude-code' : null,
    env.CODEX_THREAD_ID || env.CODEX_SESSION_ID ? 'codex' : null].filter(Boolean);
  if (detected.length > 1) throw Object.assign(new Error('Multiple active CLI markers. Bind the current host with --host claude-code|codex|opencode or KAIRO_HOST before routing.'), { code: 'ambiguous_host' });
  return { id: detected.length === 1 ? detected[0] : null,
    source: detected.length === 1 ? 'runtime' : 'unknown', model: null };
}

export function hostAllowsProvider(host, provider) {
  if (!host?.id) return true;
  // Only the OpenCode-backed catalogs establish OpenCode access today.
  // Its generic provider/model syntax does not transfer another CLI's login.
  if (host.id === 'opencode') return provider === 'opencode-go' || provider === 'opencode-zen';
  const adapter = getHost(host.id);
  const native = adapter.capabilities().nativeProviders;
  if (native.includes('*') || native.includes(provider)) return true;
  // Claude's existing bridges are explicit execution capabilities, not native models.
  try { return !!adapter.renderWrapperAgent?.(provider); } catch { return false; }
}

/** Restrict a single request without changing the persisted team or weakening other gates. */
export function hostRouteInputs(args, host) {
  if (!host.id) return args;
  const providers = new Set([...Object.keys(args.eligibility ?? {}),
    ...(args.models ?? []).map(row => row.adapterId), ...(args.pool ?? []).map(row => row.adapterId),
    ...(args.strategy?.projectTeam ?? []).flatMap(row => [row.model?.adapterId, row.fallback?.adapterId])].filter(Boolean));
  const eligibility = Object.fromEntries([...providers].map(provider => {
    if (!hostAllowsProvider(host, provider)) return [provider, { ok: false, reason: `${provider} is not executable from active host ${host.id}` }];
    const capacity = args.providerCapacity?.[provider];
    if (capacity?.quotaRemainingPercent === 0 || capacity?.exhaustion) {
      return [provider, { ...args.eligibility?.[provider], ok: false, reason: `${provider} has no quota available for active host ${host.id}` }];
    }
    return [provider, args.eligibility?.[provider]];
  }));
  return { ...args, eligibility,
    models: (args.models ?? []).filter(row => hostAllowsProvider(host, row.adapterId)),
    ...(Array.isArray(args.pool) ? { pool: args.pool.filter(row => hostAllowsProvider(host, row.adapterId)) } : {})
  };
}
