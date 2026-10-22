import type { Register } from 'claude-code'

type Route = { decision: string, provider: string, targetAgent?: string, targetModel: string }

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

/** Claude Code is one routing host; provider selection belongs to Kairo. */
export const register: Register = on => {
  let cwd: string | undefined
  let warned = false

  on('session.start', async (_, e, next) => {
    cwd = e.cwd
    warned = false
    return next(e)
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
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
    const canLaunch = (route: Route) => typeof route.provider === 'string' && typeof route.targetModel === 'string' && route.targetModel.length > 0
      && ((typeof route.targetAgent === 'string' && route.targetAgent.length > 0) || route.provider === 'claude')
    const routedInput = (route: Route) => ({
      ...e,
      ...(typeof route.targetAgent === 'string' && route.targetAgent.length > 0 ? { subagent_type: route.targetAgent } : {}),
      ...(route.provider === 'claude' && typeof route.targetModel === 'string' && route.targetModel.length > 0 ? { model: route.targetModel } : {}),
    })
    const recordLaunch = (route: Route, name: string) => {
      // Launch accounting must never delay or deny an Agent launch.
      try {
        void $.process.run([
          'kairo', 'team', 'record-launch', '--agent', name,
          '--adapter', route.provider, '--model', route.targetModel, ...location,
        ], { timeoutMs: 2000 }).catch(() => {})
      } catch { /* Synchronous process failures must also stay silent. */ }
    }
    const recordOutcome = async (route: Route, name: string, status: string, reason?: string) => {
      const ran = await bounded(() => $.process.run([
        'kairo', 'team', 'record-outcome', '--agent', name,
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
    let route: Route | undefined
    let input = e
    try {
      const selected = await readRoute()
      input = routedInput(selected)
      if (canLaunch(selected)) {
        route = selected
        recordLaunch(selected, input.subagent_type)
      }
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
    const retry = {
      ...routedInput(replacement),
      prompt: `Previous ${exhausted.provider} provider stopped on quota. Continue from the current working tree state; do not redo finished work.\n\n${e.prompt ?? ''}`,
    }
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
