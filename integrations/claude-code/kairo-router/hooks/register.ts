import type { Register, EngineInterface } from 'claude-code'

type Route = { role?: string, decision: string, provider: string, targetAgent?: string, targetModel: string, distribution?: { targets?: Record<string, number>, deficits?: Record<string, number>, excludedForPressure?: string[] } }

type ProviderPacing = { tier: string | null, expectedDeadTimeMs: number | null, windows: Array<{ name?: string, remainingPercent?: number, resetsAt?: string | null, tier?: string, expectedDeadTimeMs?: number }> }
type Pacing = { generatedAt?: string, providers: Record<string, ProviderPacing>, preferredProvider?: string | null, nextWriter: string | null, writerCounts?: { claude: number, codex: number } }
const gentleActors = new Set(['review-risk', 'review-resilience', 'review-readability', 'review-reliability', 'review-refuter', 'jd-judge-a', 'jd-judge-b', 'jd-fix-agent'])
const constrained = (p?: ProviderPacing) => p?.tier === 'CONSERVE' || p?.tier === 'CRITICAL'
// Hand-built agents fix their own model; the per-launch route may only keep them on that exact model.
const agentOwnModel: Record<string, string> = { 'team-builder-codex': 'gpt-6.1-sol', 'team-researcher-codex': 'gpt-6.1-sol' }
const vendor = (name: string) => name.endsWith('-codex') ? 'codex' : 'claude'
const bypass = (e: { subagent_type?: string, prompt?: string }) => gentleActors.has(e.subagent_type ?? '') || /\[[^\]]*\bno-redirect\b[^\]]*\]/i.test(e.prompt ?? '')

// A provider failure that says nothing about the task itself: server, connection or gateway errors.
const providerErrorPattern = /UnknownError|Unexpected server error|Internal server error|overloaded_error|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|connection (?:error|refused|reset|closed)|service unavailable|bad gateway|gateway timeout/i
function providerErrorReason(result: unknown, failed: boolean): string | undefined {
  const text = resultText(result)
  // A plain mention inside a successful report is task content, not a provider failure.
  if (!providerErrorPattern.test(text) || !(failed || /"type"\s*:\s*"error"/.test(text))) return undefined
  return `provider error: ${text.replace(/\s+/g, ' ').trim().slice(0, 200)}`
}

/** Whether the orchestrator's explicit Claude model is qualified for the role per the route's own candidate pool. undefined means the route gives no proof either way. */
export function explicitModelVerdict(model: string, route: Route): { keep: true } | { keep: false, why: string } | undefined {
  const wanted = model.toLowerCase()
  const claudeIds = Object.keys(route.distribution?.targets ?? {}).filter(key => key.startsWith('claude/')).map(key => key.slice('claude/'.length))
  const matches = (id: string) => id.toLowerCase().includes(wanted) || wanted.includes(id.toLowerCase())
  const matching = claudeIds.filter(matches)
  if (route.provider === 'claude' && matches(route.targetModel)) return { keep: true }
  if (!route.distribution?.targets) return undefined
  if (!matching.length) return { keep: false, why: `explicit model ${model} is not qualified for ${route.role ?? 'this role'} (no matching qualified claude model)` }
  const pressured = new Set(route.distribution.excludedForPressure ?? [])
  if (matching.every(id => pressured.has(`claude/${id}`))) return { keep: false, why: `explicit model ${model} is not eligible now (claude quota pressure)` }
  return { keep: true }
}

/** Pacing may reduce Claude effort, but only Kairo chooses the provider. */
export function decidePacingRewrite(e: { subagent_type?: string, prompt?: string, model?: string }, pacing?: Pacing): { model?: string } {
  if (!pacing || !e.subagent_type || bypass(e)) return {}
  return vendor(e.subagent_type) === 'claude' && constrained(pacing.providers.claude) && /opus/i.test(e.model ?? '') ? { model: 'sonnet' } : {}
}

export function inlineWriteHint(_pacing: Pacing | undefined, tool: string, input: { content?: string, old_string?: string, new_string?: string, edits?: readonly { old_string?: string, new_string: string }[] }): string | null {
  const lines = (text?: string) => text ? text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0) : 0
  const editLines = (edit: { old_string?: string, new_string?: string }) => Math.max(lines(edit.old_string), lines(edit.new_string))
  const changed = tool === 'MultiEdit' ? (input.edits ?? []).reduce((n, edit) => n + editLines(edit), 0) : tool === 'Edit' ? editLines(input) : lines(input.content)
  return changed > 20 ? `Kairo: this inline edit changes ${changed} lines (limit 20).` : null
}

const dead = (ms: number | null) => {
  if (ms === null) return 'unknown'
  const minutes = Math.ceil(ms / 60000), hours = Math.floor(minutes / 60)
  return hours ? `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}` : `${minutes}m`
}
const localReset = (iso?: string | null, now?: string) => {
  if (!iso) return 'unknown'
  const date = new Date(iso)
  return date.toDateString() === new Date(now ?? Date.now()).toDateString()
    ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
export function pacingContext(pacing: Pacing): string {
  const sides = Object.entries(pacing.providers).filter(([, p]) => p.windows.length).map(([name, p]) =>
    `${name}: ${p.windows.map(w => `${/week/i.test(w.name ?? '') ? 'week' : w.name} ${w.remainingPercent}% (resets ${localReset(w.resetsAt, pacing.generatedAt)})`).join(', ')} - ${p.expectedDeadTimeMs ? `would sit unused about ${dead(p.expectedDeadTimeMs)}` : 'no expected idle time'}`)
  const unknown = Object.entries(pacing.providers).filter(([, p]) => !p.windows.length).map(([name]) => name)
  if (unknown.length) sides.push(`No quota data: ${unknown.join(', ')}`)
  return `Pacing: ${sides.join(' | ')}; next writer ${pacing.nextWriter ?? 'unknown'}.`
}
export function pacingBand(pacing: Pacing): string | undefined {
  const cap = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)
  const label = (w: { name?: string }) => /week/i.test(w.name ?? '') ? 'week' : (w.name ?? 'quota')
  const providers = Object.entries(pacing.providers).filter(([, p]) => p?.windows?.length)
  const destination = (name: string) => providers.find(([other, p]) => other !== name && !p.windows.some(w => w && (w.remainingPercent ?? 1) <= 0))?.[0]
  const sentences: string[] = []
  for (const [name, p] of providers) {
    const windows = p.windows.filter(Boolean)
    const to = destination(name)
    const handoff = (reset: string | null | undefined) => to ? `; delegated work ${reset ? 'moves' : 'goes'} to ${cap(to)}${reset ? ' until then' : ''}` : ''
    const empty = windows.find(w => typeof w.remainingPercent === 'number' && w.remainingPercent <= 0)
    if (empty) {
      sentences.push(`${cap(name)} ${label(empty)} is at 0% until ${localReset(empty.resetsAt, pacing.generatedAt)}${to ? `; delegated work goes to ${cap(to)}` : ''}`)
      continue
    }
    if (!constrained(p)) continue
    const flagged = windows.filter(w => w.tier === 'CONSERVE' || w.tier === 'CRITICAL')
    const pool = flagged.length ? flagged : windows
    const limiting = pool.slice().sort((a, b) => (b.expectedDeadTimeMs ?? 0) - (a.expectedDeadTimeMs ?? 0))[0]
    sentences.push(`${cap(name)} ${label(limiting)} runs out before ${localReset(limiting.resetsAt, pacing.generatedAt)} at this pace${handoff(limiting.resetsAt)}`)
  }
  return sentences.length ? sentences.join('. ') : undefined
}

/** Claude Code keeps running the hook it loaded at start; an update only takes effect after a restart. */
export function staleLoadWarning(loaded: string | undefined, installedText: string | undefined): string | undefined {
  if (!loaded || !installedText) return undefined
  try {
    const plugins = JSON.parse(installedText)?.plugins ?? {}
    const entry = Object.entries(plugins).find(([key]) => key.startsWith('kairo-router@'))?.[1]
    const installed = Array.isArray(entry) ? entry.find(row => typeof row?.version === 'string')?.version : undefined
    return installed && installed !== loaded ? `kairo-router ${loaded} loaded, ${installed} installed: restart Claude Code` : undefined
  } catch { return undefined }
}

async function readOwnVersion($: EngineInterface): Promise<string | undefined> {
  try { return JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`) as string)?.version }
  catch { return undefined }
}

async function readStaleLoad($: EngineInterface, loaded: Promise<string | undefined>): Promise<string | undefined> {
  try {
    const home = await $.env.get('HOME')
    if (!home) return undefined
    return staleLoadWarning(await loaded, await $.fs.read(`${home}/.claude/plugins/installed_plugins.json`) as string)
  } catch { return undefined }
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

/** An async acknowledgement is not a finished Agent result. */
function backgroundLaunch(value: unknown, requested?: boolean): { agentId?: string } | undefined {
  const result = (value as { result?: { status?: string, agentId?: string } } | undefined)?.result
  if (result?.status === 'async_launched') return { agentId: result.agentId }
  const text = resultText(value)
  if (requested && /working in the background|async agent launched/i.test(text)) {
    return { agentId: /agentId:\s*([^\s]+)/i.exec(text)?.[1] }
  }
  return undefined
}

/** Bound even a process transport that fails to settle its own timeout. */
async function bounded<T>(run: () => Promise<T>, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('accounting or route timed out')), ms) }),
    ])
  } finally { clearTimeout(timer) }
}

async function readPacing($: EngineInterface, cwd?: string): Promise<Pacing | undefined> {
  try {
    const ran = await bounded(() => $.process.run(['kairo', 'team', 'pacing', '--json', '--no-wait', ...(cwd ? ['--cwd', cwd] : [])], { timeoutMs: 2000 }))
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

/** Kairo's verdict on an agent launch; undefined (allow) on any failure, so a missing Kairo never blocks work. */
async function agentDenial($: EngineInterface, agent: string | undefined, cwd?: string): Promise<string | undefined> {
  try {
    const ran = await bounded(() => $.process.run(['kairo', 'team', 'check-agent', '--agent', agent ?? '', ...(cwd ? ['--cwd', cwd] : []), '--json'], { timeoutMs: 2000 }))
    if (ran.timedOut || ran.exitCode !== 0) return undefined
    const verdict = JSON.parse(ran.stdout)
    return verdict?.allowed === false && typeof verdict.reason === 'string' && verdict.reason ? verdict.reason : undefined
  } catch { return undefined }
}

/** Dispatch instructions for an approved plan; the plan itself goes to Kairo on stdin. */
async function dispatchContext($: EngineInterface, plan: string, cwd?: string): Promise<string | undefined> {
  try {
    const ran = await bounded(() => $.process.run(['kairo', 'team', 'dispatch', ...(cwd ? ['--cwd', cwd] : []), '--json'], { timeoutMs: 3000, stdin: plan }), 3500)
    if (ran.timedOut || ran.exitCode !== 0) return undefined
    const value = JSON.parse(ran.stdout)
    return typeof value?.context === 'string' && value.context ? value.context : undefined
  } catch { return undefined }
}

/** Short, relevant CodeGraph context for a prompt; Kairo filters stale and vendored symbols. */
async function codegraphContext($: EngineInterface, prompt: string, cwd?: string): Promise<string | undefined> {
  try {
    const ran = await bounded(() => $.process.run(['kairo', 'team', 'prompt-context', ...(cwd ? ['--cwd', cwd] : [])], { timeoutMs: 2000, stdin: JSON.stringify({ prompt, cwd }) }), 2500)
    const text = ran.stdout.trim()
    return !ran.timedOut && ran.exitCode === 0 && text.startsWith('CodeGraph') ? text : undefined
  } catch { return undefined }
}

function updateRunning($: EngineInterface, text: string | undefined, showStatus: boolean) {
  try { if (showStatus) $.ui.status(text) } catch { /* Display must never block work. */ }
  try { $.ui.invalidate('ui.render') } catch { /* Render may be unavailable. */ }
}

/** Claude Code is one routing host; provider selection belongs to Kairo. */
export const register: Register = (on, options = {}) => {
  let pacing: Pacing | undefined
  let noRedirect = false
  const running = new Map<symbol, string>()
  const background = new Map<string, () => Promise<void>>()
  const runningText = () => {
    const items = [...running.values()]
    return items.length ? items.slice(0, 3).join(' | ') + (items.length > 3 ? ` | +${items.length - 3} more` : '') : undefined
  }


  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const original = await next(e)
    const text = options.showBand !== false && !e.props.hasSurvey ? [pacing ? pacingBand(pacing) : undefined, options.showStatus === false ? runningText() : undefined].filter(Boolean).join('\n') : undefined
    return text ? { type: 'Box', props: { flexDirection: 'column' }, children: [original, { type: 'Text', props: {}, children: [text] }] } : original
  })

  for (const tool of ['Edit', 'Write', 'MultiEdit'] as const) on('tool.call', { tool }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    // The orchestrator's own ODD logbook (odd/tasks/**) is planning, not implementation.
    if (/(^|\/)odd\/tasks\//.test(String((e as { file_path?: unknown }).file_path ?? ''))) return next(e)
    const hint = inlineWriteHint(pacing, tool, e)
    if (!hint) return next(e)
    let delegate = 'Delegate it to the Builder role (route unavailable).'
    try {
      const ran = await bounded(() => $.process.run([
        'kairo', 'team', 'route', '--role', 'Builder', ...(cwd ? ['--cwd', cwd] : []), '--json',
      ], { timeoutMs: 2000 }))
      if (!ran.timedOut && ran.exitCode === 0) {
        const route = JSON.parse(ran.stdout)
        if (route?.decision === 'ROUTED' && typeof route.provider === 'string' && route.provider && typeof route.targetModel === 'string' && route.targetModel) {
          delegate = `Delegate it to Builder, ${route.targetModel} (${route.provider}).`
        }
      }
    } catch { /* Routing failures must not permit a large inline write. */ }
    return { deny: `${hint} ${delegate}` }
  })
  let cwd: string | undefined
  let warned = false
  // The version this process loaded; a reload re-runs register and reads it again.
  let loadedVersion: Promise<string | undefined> | undefined

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    loadedVersion ??= readOwnVersion($)
    warned = false
    pacing = undefined
    running.clear()
    background.clear()
    noRedirect = false
    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    const finish = background.get(e.agent_id)
    background.delete(e.agent_id)
    if (finish) { try { await finish() } catch { /* Accounting must never block the host stop event. */ } }
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
    loadedVersion ??= readOwnVersion($)
    const stale = await readStaleLoad($, loadedVersion)
    if (stale) {
      // A restart notice outranks everything else: until then, newer routing and accounting are not running.
      try { $.ui.status(stale) } catch { /* Fail open. */ }
    } else if (snapshot) {
      try {
        if (options.showStatus !== false) $.ui.status(runningText() ?? 'Kairo: quota-aware routing active')
      } catch { /* Display failures must not block prompts. */ }
    } else if (options.showStatus !== false) { try { $.ui.status(runningText()) } catch { /* Fail open. */ } }
    try { $.ui.invalidate('ui.render') } catch { /* A stale display never blocks a prompt. */ }
    const graph = options.showCodeGraph !== false ? await codegraphContext($, e.text, cwd) : undefined
    const additions = [stale, context, 'Before the first implementation step, show Step | Role | Model (provider) | Inline or delegated. Resolve delegated models with kairo team route --role ROLE; inline steps read Orchestrator (session model).', options.showContext !== false && snapshot ? pacingContext(snapshot) : undefined, graph].filter((s): s is string => Boolean(s))
    return next(additions.length ? { ...e, context: [...(e.context ?? []), ...additions] } : e)
  })

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    // next includes the approval flow: never dispatch on a refusal or a teammate's pending request.
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError || (ran.result as { awaitingLeaderApproval?: boolean } | undefined)?.awaitingLeaderApproval) return ran
    const input = e as { planFilePath?: unknown, plan?: unknown }, result = (ran.result ?? {}) as { filePath?: unknown, plan?: unknown }
    const path = typeof input.planFilePath === 'string' && input.planFilePath ? input.planFilePath : typeof result.filePath === 'string' ? result.filePath : ''
    let plan: string | undefined
    if (path) plan = await $.fs.read(path).catch(() => undefined)
    if (plan === undefined) plan = typeof input.plan === 'string' ? input.plan : typeof result.plan === 'string' ? result.plan : ''
    const context = await dispatchContext($, plan, cwd)
    return context ? { ...ran, context: [...(ran.context ?? []), context] } : ran
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (gentleActors.has(e.subagent_type ?? '')) return next(e)
    if (options.enforceAgents !== false) {
      const denial = await agentDenial($, e.subagent_type, cwd)
      if (denial) return { deny: denial }
    }
    const marker = /\[[^\]]*\bno-redirect\b[^\]]*\]/i
    // [no-redirect] skips every rewrite, but the launch is still ledgered with the agent's real model.
    const bypassed = noRedirect || Object.values(e).some(value => typeof value === 'string' && marker.test(value))
    if (bypassed && !e.subagent_type) return next(e)
    const location = cwd ? ['--cwd', cwd] : []
    const toast = (text: string) => {
      try { $.ui.toast(`kairo-router: ${text}`) } catch { /* Notifications must not block work. */ }
    }
    const readRoute = async (provider?: string): Promise<Route> => {
      if (!e.subagent_type) throw new Error('Agent has no subagent_type')
      const ran = await bounded(() => $.process.run([
        'kairo', 'team', 'route', '--agent', e.subagent_type, ...location, '--json', ...(provider ? ['--provider', provider] : []),
      ], { timeoutMs: 2000 }))
      if (ran.timedOut) throw new Error('route timed out')
      if (ran.exitCode !== 0) throw new Error(`route exited ${ran.exitCode}: ${ran.stdout || ran.stderr}`)
      const route = JSON.parse(ran.stdout)
      if (route?.decision !== 'ROUTED') throw new Error(route?.why ?? route?.message ?? 'route unavailable')
      if (provider && route.provider !== provider) throw new Error('forced provider unavailable')
      return route
    }
    const canLaunch = (route: Route) => typeof route.provider === 'string' && route.provider.length > 0
      && typeof route.targetModel === 'string' && route.targetModel.length > 0
    // A catalog agent that already runs on the route's provider stays in place;
    // only a provider change needs a transport wrapper.
    // Only while the route's model is the model that agent actually runs: a fixed-model agent
    // must never stand in for a different model the route chose.
    const keepsAgent = (route: Route, launched = e.subagent_type) => route.provider !== 'claude'
      && !(typeof route.targetAgent === 'string' && route.targetAgent.length > 0)
      && typeof launched === 'string' && vendor(launched) === route.provider
      && (agentOwnModel[launched] === undefined || agentOwnModel[launched] === route.targetModel)
    const routedInput = (route: Route, prompt = e.prompt, launched = e.subagent_type) => {
      const mappedAgent = typeof route.targetAgent === 'string' && route.targetAgent.length > 0
      const wrapper = route.provider !== 'claude' && !mappedAgent && !keepsAgent(route, launched)
      return {
        ...e,
        ...(mappedAgent ? { subagent_type: route.targetAgent } : wrapper ? { subagent_type: `kairo-${route.provider}` } : {}),
        prompt: wrapper ? `kairo-model: ${route.targetModel}\n${prompt ?? ''}` : prompt,
        ...(route.provider === 'claude' ? { model: route.targetModel } : {}),
      }
    }
    // Transport wrappers are not catalog agents. Attribute their work to the
    // original role identity so ledger validation and exhaustion handover work.
    const accountingAgent = (_route: Route, launchedName: string) =>
      launchedName.startsWith('kairo-') ? e.subagent_type : launchedName
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
    if (pacing && !bypassed) pacing = await readPacing($, cwd)
    let route: Route | undefined
    let input = e
    if (bypassed) {
      const name = e.subagent_type!
      route = { role: name, decision: 'ROUTED', provider: vendor(name), targetModel: agentOwnModel[name] ?? (vendor(name) === 'claude' ? e.model : undefined) ?? 'agent-own' }
      recordLaunch(route, name)
    } else try {
      let selected: Route | undefined
      // The orchestrator's explicit Claude model wins while the route's pool shows it is qualified and eligible.
      if (typeof e.model === 'string' && e.model && vendor(e.subagent_type!) === 'claude') {
        const first = await readRoute()
        const verdict = explicitModelVerdict(e.model, first)
        if (verdict?.keep) {
          selected = { ...first, provider: 'claude', targetAgent: undefined, targetModel: e.model }
        } else {
          if (verdict) toast(`${verdict.why}; routed to ${first.provider}/${first.targetModel}`)
          selected = first
        }
      }
      if (!selected) selected = await readRoute()
      if (!canLaunch(selected)) throw new Error('route has no launchable provider model')
      if (gentleActors.has(selected.targetAgent ?? '')) throw new Error('gentle-ai actor is not a work route')
      const kept = keepsAgent(selected, e.subagent_type)
      input = routedInput(selected)
      const downgrade = selected.provider === 'claude' && constrained(pacing?.providers.claude) && /opus/i.test(input.model ?? '') ? 'sonnet' : undefined
      if (downgrade) input = { ...input, model: downgrade }
      // A kept hand-built provider agent fixes its own model; record that, not the route's choice.
      route = { ...selected, ...(downgrade ? { targetModel: downgrade } : kept ? { targetModel: 'agent-own' } : {}) }
      recordLaunch(route, input.subagent_type)
    } catch (error) {
      if (!warned) {
        warned = true
        toast(`${error instanceof Error ? error.message : String(error)}; launching unchanged`)
      }
    }
    const launchVisible = async (selected: Route | undefined, launched: typeof e) => {
      if (!selected) return next(launched)
      const token = Symbol()
      running.set(token, `${selected.role ?? e.subagent_type ?? 'Agent'} - ${selected.targetModel} - ${selected.provider} (${launched.subagent_type})`)
      updateRunning($, runningText(), options.showStatus !== false)
      const clear = () => { running.delete(token); updateRunning($, runningText(), options.showStatus !== false) }
      let deferred = false
      try {
        const result = await next(launched)
        const pending = backgroundLaunch(result, launched.run_in_background)
        if (pending?.agentId) {
          background.set(pending.agentId, async () => {
            clear()
            await recordOutcome(selected, launched.subagent_type, 'completed')
          })
          deferred = true
        }
        return result
      } finally { if (!deferred) clear() }
    }
    // Never catch and replay a failed Agent invocation.
    const original = await launchVisible(route, input)
    if (!route) return original
    // An asynchronous launch result only confirms the start; the subagent is still working.
    if (backgroundLaunch(original, input.run_in_background)) return original
    const info = exitInfo(original)
    let exhausted: { provider: string, reason: string } | null
    try { exhausted = await detectExhaustion(original, route) } catch {
      if (!warned) { warned = true; toast('exhaustion detection unavailable; keeping original result') }
      return original
    }
    const providerFailure = !exhausted && !bypassed ? providerErrorReason(original, info.failed) : undefined
    if (!exhausted && !providerFailure) {
      void recordOutcome(route, input.subagent_type, info.failed ? 'failed' : 'completed').catch(() => {})
      return original
    }
    if (bypassed) {
      void recordOutcome(route, input.subagent_type, 'exhausted', exhausted!.reason).catch(() => {})
      return original
    }
    // Quota exhaustion and provider errors share one bounded handover; a task failure never reaches it.
    const stopped = exhausted ?? { provider: route.provider, reason: providerFailure! }
    const verb = exhausted ? 'stopped on quota' : 'failed with a provider error'
    // Different provider first, then a different model on the same provider.
    const nextCandidate = async (): Promise<Route> => {
      const deficits = route!.distribution?.deficits ?? {}
      const providers = [...new Set(Object.keys(route!.distribution?.targets ?? {}).sort((a, b) => (deficits[b] ?? 0) - (deficits[a] ?? 0)).map(key => key.split('/')[0]))]
        .filter(provider => provider !== route!.provider)
      for (const provider of providers) {
        try { const found = await readRoute(provider); if (canLaunch(found)) return found } catch { /* try the next provider */ }
      }
      const same = await readRoute()
      if (canLaunch(same) && same.provider === route!.provider && same.targetModel !== route!.targetModel) return same
      if (canLaunch(same) && same.provider !== route!.provider) return same
      throw new Error('no other qualified candidate')
    }

    let replacement: Route
    try {
      // This marker must be durable before routing, unlike ordinary accounting.
      await recordOutcome(route, input.subagent_type, exhausted ? 'exhausted' : 'failed', stopped.reason)
      if (exhausted) {
        replacement = await readRoute()
        if (!canLaunch(replacement) || replacement.provider === exhausted.provider || replacement.provider === route.provider) {
          throw new Error('no different launchable provider available')
        }
      } else replacement = await nextCandidate()
    } catch (error) {
      toast(`${stopped.provider} ${verb}; handover unavailable (${error instanceof Error ? error.message : String(error)}); keeping original result`)
      return original
    }
    toast(`${stopped.provider} ${verb}; handing over to ${replacement.provider}`)
    const retry = routedInput(replacement,
      `Previous ${stopped.provider} provider ${verb}. Continue from the current working tree state; do not redo finished work.\n\n${e.prompt ?? ''}`)
    recordLaunch(replacement, retry.subagent_type)
    const resumed = await launchVisible(replacement, retry)
    if (backgroundLaunch(resumed, retry.run_in_background)) return resumed
    const resumedInfo = exitInfo(resumed)
    let resumedExhaustion: { provider: string, reason: string } | null
    try { resumedExhaustion = await detectExhaustion(resumed, replacement) } catch { return resumed }
    // Exactly one handover: the second result is recorded, never rerouted again.
    void recordOutcome(replacement, retry.subagent_type, resumedExhaustion ? 'exhausted' : resumedInfo.failed ? 'failed' : 'completed', resumedExhaustion?.reason ?? (resumedInfo.failed ? providerErrorReason(resumed, true) : undefined)).catch(() => {})
    return resumed
  })
}
