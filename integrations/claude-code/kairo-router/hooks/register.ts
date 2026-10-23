import type { Register, EngineInterface } from 'claude-code'

type Route = { decision: string, provider: string, targetAgent?: string, targetModel: string }

type ProviderPacing = { tier: string | null, expectedDeadTimeMs: number | null, windows: Array<{ name?: string, remainingPercent?: number, resetsAt?: string | null, tier?: string, expectedDeadTimeMs?: number }> }
type Pacing = { providers: Record<string, ProviderPacing>, preferredProvider?: string | null, nextWriter: string | null, writerCounts?: { claude: number, codex: number } }
const gentleActors = new Set(['review-risk', 'review-resilience', 'review-readability', 'review-reliability', 'review-refuter', 'jd-judge-a', 'jd-judge-b', 'jd-fix-agent'])
const pairs: Record<string, string> = { 'team-builder': 'team-builder-codex', 'team-builder-codex': 'team-builder', 'team-researcher': 'team-researcher-codex', 'team-researcher-codex': 'team-researcher' }
const constrained = (p?: ProviderPacing) => p?.tier === 'CONSERVE' || p?.tier === 'CRITICAL'
const vendor = (name: string) => name.endsWith('-codex') ? 'codex' : 'claude'
const bypass = (e: { subagent_type?: string, prompt?: string }) => gentleActors.has(e.subagent_type ?? '') || /\[[^\]]*\bno-redirect\b[^\]]*\]/i.test(e.prompt ?? '')

/** Pacing only rewrites work roles; gentle-ai retains its own launch contracts. */
export function decidePacingRewrite(e: { subagent_type?: string, prompt?: string, model?: string }, pacing?: Pacing): { subagent_type?: string, model?: string } {
  if (!pacing || !e.subagent_type || bypass(e)) return {}
  const own = vendor(e.subagent_type), other = own === 'claude' ? 'codex' : 'claude'
  const pair = pairs[e.subagent_type]
  let target: string | undefined
  const preference = pacing.preferredProvider === undefined
    ? pacing.nextWriter === 'team-builder-codex' ? 'codex' : pacing.nextWriter === 'team-builder' ? 'claude' : null
    : pacing.preferredProvider
  if (pair && preference === other) target = pair
  else if (pair && preference === null && e.subagent_type.startsWith('team-builder')) {
    const counts = pacing.writerCounts ?? { claude: 0, codex: 0 }, total = counts.claude + counts.codex
    if (total > 0 && counts[own] / total > .6 && ['HEALTHY', 'WATCH'].includes(pacing.providers[other]?.tier ?? '')) target = pair
  }
  const final = target ? vendor(target) : own
  return { ...(target ? { subagent_type: target } : {}),
    ...(final === 'claude' && constrained(pacing.providers.claude) && /opus/i.test(e.model ?? '') ? { model: 'sonnet' } : {}) }
}

export function inlineWriteHint(pacing: Pacing | undefined, tool: string, input: { content?: string, new_string?: string, edits?: readonly { new_string: string }[] }): string | null {
  if (!pacing || !constrained(pacing.providers.claude) || !['HEALTHY', 'WATCH'].includes(pacing.providers.codex?.tier ?? '')) return null
  const lines = (text?: string) => text ? text.split(/\r?\n/).length : 0
  const changed = tool === 'MultiEdit' ? (input.edits ?? []).reduce((n, edit) => n + lines(edit.new_string), 0) : lines(tool === 'Edit' ? input.new_string : input.content)
  return changed > 20 ? 'Delegate non-trivial writes (small tasks included) to team-builder-codex; main session orchestrates and reviews.' : null
}

const dead = (ms: number | null) => ms === null ? 'unknown' : `${Math.ceil(ms / 60000)}m`
export function pacingContext(pacing: Pacing): string {
  const sides = Object.entries(pacing.providers).map(([name, p]) => `${name} ${p.windows.map(w => `${w.name} ${w.remainingPercent}%`).join(' ') || 'quota unknown'} ${p.tier ?? 'UNKNOWN'}; dead ${dead(p.expectedDeadTimeMs)}; reset ${p.windows.map(w => w.resetsAt ?? 'unknown').join(', ') || 'unknown'}`)
  return `Pacing: ${sides.join(' | ')}; next writer ${pacing.nextWriter ?? 'unknown'}.`
}
export function pacingBand(pacing: Pacing): string | undefined {
  if (!pacing.nextWriter) return undefined
  const next = vendor(pacing.nextWriter), other = next === 'codex' ? 'claude' : 'codex', p = pacing.providers[other]
  const severity: Record<string, number> = { HEALTHY: 0, WATCH: 1, CONSERVE: 2, CRITICAL: 3 }
  const limiting = p?.windows.slice().sort((a, b) => (b.expectedDeadTimeMs ?? 0) - (a.expectedDeadTimeMs ?? 0)
    || (severity[b.tier ?? 'HEALTHY'] ?? 0) - (severity[a.tier ?? 'HEALTHY'] ?? 0)
    || (a.resetsAt ?? '').localeCompare(b.resetsAt ?? ''))[0]
  const reset = limiting?.resetsAt
  return `Use ${next} now${constrained(p) ? `; ${other} returns ${reset ?? 'at an unknown reset'} (dead ${dead(p.expectedDeadTimeMs)})` : ''}`
}

/** Read text-bearing result fields, never arbitrary object string coercions. */
function resultText(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object' || depth > 8) return ''
  if (Array.isArray(value)) return value.map(item => resultText(item, depth + 1)).join('\n')
  const row = value as Record<string, unknown>
  return ['result', 'content', 'text', 'stdout', 'stderr', 'output', 'message', 'error']
    .map(key => resultText(row[key], depth + 1)).filter(Boolean).join('\n')
}

function exitInfo(value: unknown): { exitCode?: number, failed: boolean } {
  if (!value || typeof value !== 'object') return { failed: false }
  const row = value as Record<string, unknown>
  const nested = row.result && typeof row.result === 'object' ? row.result as Record<string, unknown> : {}
  const code = row.exitCode ?? nested.exitCode
  return {
    ...(typeof code === 'number' ? { exitCode: code } : {}),
    failed: (typeof code === 'number' && code !== 0) || row.isError === true || row.is_error === true || nested.isError === true || nested.is_error === true,
  }
}

/** Bound even a process transport that fails to settle its own timeout. */
async function bounded<T>(run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('accounting or route timed out')), 2000) }),
    ])
  } finally { clearTimeout(timer) }
}

async function readPacing($: EngineInterface, cwd?: string): Promise<Pacing | undefined> {
  try {
    const ran = await bounded(() => $.process.run(['kairo', 'team', 'pacing', '--json', ...(cwd ? ['--cwd', cwd] : [])], { timeoutMs: 2000 }))
    if (ran.timedOut || ran.exitCode !== 0) return undefined
    const value = JSON.parse(ran.stdout)
    const valid = value?.ok === true && value.providers?.claude && value.providers?.codex
      && [null, 'claude', 'codex'].includes(value.preferredProvider)
      && [null, 'team-builder', 'team-builder-codex'].includes(value.nextWriter)
      && Object.values(value.providers).every((p: any) => p && [null, 'HEALTHY', 'WATCH', 'CONSERVE', 'CRITICAL'].includes(p.tier)
        && (p.expectedDeadTimeMs === null || typeof p.expectedDeadTimeMs === 'number' && Number.isFinite(p.expectedDeadTimeMs) && p.expectedDeadTimeMs >= 0)
        && Array.isArray(p.windows) && p.windows.every((w: any) => w && typeof w.name === 'string'
          && typeof w.remainingPercent === 'number' && Number.isFinite(w.remainingPercent) && w.remainingPercent >= 0 && w.remainingPercent <= 100
          && (w.resetsAt === null || typeof w.resetsAt === 'string' && Number.isFinite(Date.parse(w.resetsAt)))))
    return valid ? value : undefined
  } catch { return undefined }
}

/** Claude Code is one routing host; provider selection belongs to Kairo. */
export const register: Register = (on, options = {}) => {
  let pacing: Pacing | undefined
  let noRedirect = false

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const original = await next(e)
    const text = options.showBand !== false && !e.props.hasSurvey && pacing ? pacingBand(pacing) : undefined
    return text ? { type: 'Box', props: { flexDirection: 'column' }, children: [original, { type: 'Text', props: {}, children: [text] }] } : original
  })

  for (const tool of ['Edit', 'Write', 'MultiEdit'] as const) on('tool.call', { tool }, async ($, e, next) => {
    if (e.agentId !== undefined || noRedirect || /\[no-redirect\]/i.test(String((e as any).prompt ?? ''))) return next(e)
    const hint = inlineWriteHint(pacing, tool, e)
    const result = await next(e)
    if (hint) { try { $.ui.toast(`kairo-router: ${hint}`) } catch { /* Never replay a completed write. */ } }
    return result
  })
  let cwd: string | undefined
  let warned = false

  on('session.start', async (_, e, next) => {
    cwd = e.cwd
    warned = false
    pacing = undefined
    noRedirect = false
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    noRedirect = /\[[^\]]*\bno-redirect\b[^\]]*\]/i.test(e.text)
    let context: string | undefined
    try {
      const ran = await bounded(() => $.process.run([
        'kairo', 'team', 'verdict', '--pending', '--json', ...(cwd ? ['--cwd', cwd] : []),
      ], { timeoutMs: 2000 }))
      if (!ran.timedOut && ran.exitCode === 0) {
        const rows = JSON.parse(ran.stdout)
        if (Array.isArray(rows) && rows.length > 0) {
          context = `Kairo: ${rows.length} delegated ${rows.length === 1 ? 'result waits' : 'results wait'} for a verdict; after verifying, run kairo team verdict --agent NAME --result pass or fail.`
        }
      }
    } catch { /* Missing Kairo or accounting failures must not block prompts. */ }
    const snapshot = pacing = await readPacing($, cwd)
    if (snapshot) {
      try {
        if (options.showStatus !== false) $.ui.status('Kairo: quota-aware routing active')
      } catch { /* Display failures must not block prompts. */ }
    } else if (options.showStatus !== false) { try { $.ui.status(undefined) } catch { /* Fail open. */ } }
    try { $.ui.invalidate('ui.render') } catch { /* A stale display never blocks a prompt. */ }
    const additions = [context, options.showContext !== false && snapshot ? pacingContext(snapshot) : undefined].filter((s): s is string => Boolean(s))
    return next(additions.length ? { ...e, context: [...(e.context ?? []), ...additions] } : e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (noRedirect || gentleActors.has(e.subagent_type ?? '')) return next(e)
    const marker = /\[[^\]]*\bno-redirect\b[^\]]*\]/i
    if (Object.values(e).some(value => typeof value === 'string' && marker.test(value))) return next(e)
    const location = cwd ? ['--cwd', cwd] : []
    const toast = (text: string) => {
      try { $.ui.toast(`kairo-router: ${text}`) } catch { /* Notifications must not block work. */ }
    }
    const readRoute = async (): Promise<Route> => {
      if (!e.subagent_type) throw new Error('Agent has no subagent_type')
      const ran = await bounded(() => $.process.run([
        'kairo', 'team', 'route', '--agent', e.subagent_type, ...location, '--json',
      ], { timeoutMs: 2000 }))
      if (ran.timedOut) throw new Error('route timed out')
      if (ran.exitCode !== 0) throw new Error(`route exited ${ran.exitCode}: ${ran.stdout || ran.stderr}`)
      const route = JSON.parse(ran.stdout)
      if (route?.decision !== 'ROUTED') throw new Error(route?.why ?? route?.message ?? 'route unavailable')
      return route
    }
    const canLaunch = (route: Route) => typeof route.provider === 'string' && route.provider.length > 0
      && typeof route.targetModel === 'string' && route.targetModel.length > 0
    const routedInput = (route: Route, prompt = e.prompt) => {
      const mappedAgent = typeof route.targetAgent === 'string' && route.targetAgent.length > 0
      const wrapper = route.provider !== 'claude' && !mappedAgent
      return {
        ...e,
        ...(mappedAgent ? { subagent_type: route.targetAgent } : wrapper ? { subagent_type: `kairo-${route.provider}` } : {}),
        prompt: wrapper ? `kairo-model: ${route.targetModel}\n${prompt ?? ''}` : prompt,
        ...(route.provider === 'claude' ? { model: route.targetModel } : {}),
      }
    }
    // Transport wrappers are not catalog agents. Attribute their work to the
    // original role identity so ledger validation and exhaustion handover work.
    const accountingAgent = (route: Route, launchedName: string) =>
      route.provider !== 'claude' && !route.targetAgent ? e.subagent_type : launchedName
    const recordLaunch = (route: Route, name: string) => {
      // Launch accounting must never delay or deny an Agent launch.
      try {
        void $.process.run([
          'kairo', 'team', 'record-launch', '--agent', accountingAgent(route, name),
          '--adapter', route.provider, '--model', route.targetModel, ...location,
        ], { timeoutMs: 2000 }).catch(() => {})
      } catch { /* Synchronous process failures must also stay silent. */ }
    }
    const recordOutcome = async (route: Route, name: string, status: string, reason?: string) => {
      const ran = await bounded(() => $.process.run([
        'kairo', 'team', 'record-outcome', '--agent', accountingAgent(route, name),
        '--adapter', route.provider, '--model', route.targetModel, '--status', status,
        ...(reason ? ['--reason', reason] : []), ...location,
      ], { timeoutMs: 2000 }))
      if (ran.timedOut || ran.exitCode !== 0) throw new Error('could not record outcome')
    }
    const detectExhaustion = async (result: unknown, route: Route) => {
      const info = exitInfo(result)
      const ran = await bounded(() => $.process.run([
        'kairo', 'team', 'detect-exhaustion', '--text', resultText(result), '--adapter', route.provider,
        ...(typeof info.exitCode === 'number' ? ['--exit-code', String(info.exitCode)] : []),
      ], { timeoutMs: 2000 }))
      if (ran.timedOut || ran.exitCode !== 0) throw new Error('exhaustion detection unavailable')
      const detected = JSON.parse(ran.stdout)
      if (detected !== null && (typeof detected?.provider !== 'string' || typeof detected?.reason !== 'string')) {
        throw new Error('invalid exhaustion detection result')
      }
      return detected as { provider: string, reason: string } | null
    }
    // Refresh only after a prompt established pacing; an unavailable command
    // leaves the existing project route and launch path intact.
    if (pacing) pacing = await readPacing($, cwd)
    const rewrite = decidePacingRewrite(e, pacing)
    const pacedInput = { ...e, ...rewrite }
    let route: Route | undefined
    let input = pacedInput
    try {
      const selected = await readRoute()
      if (!canLaunch(selected)) throw new Error('route has no launchable provider model')
      if (gentleActors.has(selected.targetAgent ?? '')) throw new Error('gentle-ai actor is not a work route')
      // Pacing may select a paired agent only when Kairo returned a qualified
      // concrete model on that provider. Otherwise preserve the approved route
      // and its accounting/watch path instead of launching an untracked agent.
      const compatible = rewrite.subagent_type && vendor(rewrite.subagent_type) === selected.provider
      input = { ...routedInput(selected), ...(compatible ? { subagent_type: rewrite.subagent_type! } : {}) }
      const downgrade = selected.provider === 'claude' && constrained(pacing?.providers.claude) && /opus/i.test(input.model ?? '') ? 'sonnet' : undefined
      if (downgrade) input = { ...input, model: downgrade }
      route = { ...selected, ...(downgrade ? { targetModel: downgrade } : {}) }
      recordLaunch(route, input.subagent_type)
    } catch (error) {
      if (!warned) {
        warned = true
        toast(`${error instanceof Error ? error.message : String(error)}; launching unchanged`)
      }
    }
    // Never catch and replay a failed Agent invocation.
    const original = await next(input)
    if (!route) return original
    const info = exitInfo(original)
    let exhausted: { provider: string, reason: string } | null
    try { exhausted = await detectExhaustion(original, route) } catch {
      if (!warned) { warned = true; toast('exhaustion detection unavailable; keeping original result') }
      return original
    }
    if (!exhausted) {
      void recordOutcome(route, input.subagent_type, info.failed ? 'failed' : 'completed').catch(() => {})
      return original
    }

    let replacement: Route
    try {
      // This marker must be durable before routing, unlike ordinary accounting.
      await recordOutcome(route, input.subagent_type, 'exhausted', exhausted.reason)
      replacement = await readRoute()
      if (!canLaunch(replacement) || replacement.provider === exhausted.provider || replacement.provider === route.provider) {
        throw new Error('no different launchable provider available')
      }
    } catch (error) {
      toast(`${exhausted.provider} stopped on quota; handover unavailable (${error instanceof Error ? error.message : String(error)}); keeping original result`)
      return original
    }
    toast(`${exhausted.provider} stopped on quota; handing over to ${replacement.provider}`)
    const retry = routedInput(replacement,
      `Previous ${exhausted.provider} provider stopped on quota. Continue from the current working tree state; do not redo finished work.\n\n${e.prompt ?? ''}`)
    recordLaunch(replacement, retry.subagent_type)
    const resumed = await next(retry)
    const resumedInfo = exitInfo(resumed)
    let resumedExhaustion: { provider: string, reason: string } | null
    try { resumedExhaustion = await detectExhaustion(resumed, replacement) } catch { return resumed }
    // Exactly one handover: the second result is recorded, never rerouted again.
    void recordOutcome(replacement, retry.subagent_type, resumedExhaustion ? 'exhausted' : resumedInfo.failed ? 'failed' : 'completed', resumedExhaustion?.reason).catch(() => {})
    return resumed
  })
}
