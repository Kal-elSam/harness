import type { Register } from 'claude-code'

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
    // Keep next outside the routing try/catch: never replay a failed launch.
    let input = e
    const marker = /\[[^\]]*\bno-redirect\b[^\]]*\]/i
    if (Object.values(e).some(value => typeof value === 'string' && marker.test(value))) return next(e)
    try {
      if (!e.subagent_type) throw new Error('Agent has no subagent_type')
      const ran = await $.process.run([
        'kairo', 'team', 'route', '--agent', e.subagent_type,
        ...(cwd ? ['--cwd', cwd] : []), '--json',
      ], { timeoutMs: 2000 })
      if (ran.timedOut) throw new Error('route timed out')
      if (ran.exitCode !== 0) throw new Error(`route exited ${ran.exitCode}: ${ran.stdout || ran.stderr}`)
      const route = JSON.parse(ran.stdout)
      if (route?.decision !== 'ROUTED') throw new Error(route?.why ?? route?.message ?? 'route unavailable')
      if (typeof route.targetAgent === 'string' && route.targetAgent.length > 0) {
        if (route.targetAgent !== e.subagent_type) input = { ...input, subagent_type: route.targetAgent }
      }
      if (route.provider === 'claude' && typeof route.targetModel === 'string' && route.targetModel.length > 0) {
        input = { ...input, model: route.targetModel }
      }
    } catch (error) {
      if (!warned) {
        warned = true
        try { $.ui.toast(`kairo-router: ${error instanceof Error ? error.message : String(error)}; launching unchanged`) } catch { /* Notifications must not block launches. */ }
      }
    }
    return next(input)
  })
}
