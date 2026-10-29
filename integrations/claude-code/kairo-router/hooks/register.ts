import type { Register, EngineInterface } from 'claude-code'
import { PANE, registerPane, setPane } from './pane'

type Route = { priceBandExclusions?: Array<{ provider: string, modelId: string }>, role?: string, decision: string, provider: string, targetAgent?: string, targetModel: string, displayName?: string, distribution?: { targets?: Record<string, number>, deficits?: Record<string, number>, excludedForPressure?: string[] }, admission?: { candidates?: Array<{ provider?: string, modelId?: string, admitted?: boolean }> } }

type ProviderPacing = { tier: string | null, expectedDeadTimeMs: number | null, windows: Array<{ name?: string, remainingPercent?: number, resetsAt?: string | null, tier?: string, expectedDeadTimeMs?: number }> }
type Pacing = { stale?: boolean, generatedAt?: string, providers: Record<string, ProviderPacing>, preferredProvider?: string | null, nextWriter: string | null, writerCounts?: { claude: number, codex: number } }
const gentleActors = new Set(['review-risk', 'review-resilience', 'review-readability', 'review-reliability', 'review-refuter', 'jd-judge-a', 'jd-judge-b', 'jd-fix-agent'])
const constrained = (p?: ProviderPacing) => p?.tier === 'CONSERVE' || p?.tier === 'CRITICAL'
/** The model an agent definition runs: the `codex exec -m` worker for Codex-backed agents, else the frontmatter model. */
export function modelFromAgentDefinition(text: string, codexBacked: boolean): string | undefined {
  if (codexBacked) {
    // Shell line continuations belong to one command; a Codex agent never reports its Claude transport model.
    const joined = text.replace(/\\\r?\n[ \t]*/g, ' ')
    return /codex\s+exec\b[^\n]*?(?:^|\s)(?:-m|--model)[ \t=]+["'`]?([^\s"'`]+)/m.exec(joined)?.[1]
  }
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  return head ? /^model:[ \t]*(\S+)[ \t]*$/m.exec(head)?.[1] : undefined
}
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
export function explicitModelVerdict(model: string, route: Route): { keep: true } | { keep: false, why: string, reason?: 'price-band' } | undefined {
  const wanted = model.toLowerCase()
  const matches = (id: string) => id.toLowerCase().includes(wanted) || wanted.includes(id.toLowerCase())
  // Kairo classifies these against the full catalog with roleAllowsPriceBand.
  // A manual launch override cannot undo that role policy, even with quota left.
  if (route.priceBandExclusions?.some(row => row.provider === 'claude' && matches(row.modelId))) {
    return { keep: false, reason: 'price-band', why: `explicit model ${model} excluded: build roles exclude the provider's demanding price band; using routed model ${route.targetModel}` }
  }
  if (route.provider === 'claude' && matches(route.targetModel)) return { keep: true }
  // An explicit model is the orchestrator's decision: only a quota rejection (not admitted) overrides it.
  const rows = (route.admission?.candidates ?? []).filter(row => row.provider === 'claude' && typeof row.modelId === 'string' && matches(row.modelId))
  if (rows.length && rows.every(row => row.admitted === false)) return { keep: false, why: `explicit model ${model} is not admitted now (claude quota)` }
  const claudeIds = Object.keys(route.distribution?.targets ?? {}).filter(key => key.startsWith('claude/')).map(key => key.slice('claude/'.length))
  const matching = claudeIds.filter(matches)
  const pressured = new Set(route.distribution?.excludedForPressure ?? [])
  if (matching.length && matching.every(id => pressured.has(`claude/${id}`))) return { keep: false, why: `explicit model ${model} is not eligible now (claude quota pressure)` }
  return { keep: true }
}

/** Pacing may reduce Claude effort, but only Kairo chooses the provider. */
export function decidePacingRewrite(e: { subagent_type?: string, prompt?: string, model?: string }, pacing?: Pacing): { model?: string } {
  if (!pacing || !e.subagent_type || bypass(e)) return {}
  return vendor(e.subagent_type) === 'claude' && constrained(pacing.providers.claude) && /opus/i.test(e.model ?? '') ? { model: 'sonnet' } : {}
}

const orchestratorWriteDeny = 'The orchestrator does not write files. Delegate the write to the role that owns it (Backend Builder, Tester, Documenter, DevOps) with the Agent tool.'

/** Recognize common shell writes, not arbitrary program side effects or a shell sandbox. */
function bashWritesFiles(command: string): boolean {
  // Keep quoted operators inside words; only unquoted operators are shell syntax.
  // Heredoc bodies are data: drop them (and their terminator) so their text is never scanned as shell syntax.
  const lines = command.replace(/\\\r?\n/g, '').split('\n')
  const kept: string[] = []
  for (let n = 0; n < lines.length; n++) {
    kept.push(lines[n])
    const open = [...lines[n].matchAll(/<<(-?)\s*(?:'([^']+)'|"([^"]+)"|\\?([A-Za-z_][A-Za-z0-9_]*))/g)]
    for (const match of open) {
      const delimiter = match[2] ?? match[3] ?? match[4]
      let end = n + 1
      while (end < lines.length && (match[1] ? lines[end].trim() : lines[end]) !== delimiter) end++
      if (end < lines.length) {
        // Anything after the terminator line (for example `)"`) stays shell text.
        n = end
      } else n = lines.length
    }
  }
  const tokens = kept.join('\n').match(/(?:[^\s"'<>|;&()]+|'[^']*'|"(?:\\.|[^"\\])*"|\\.)+|&?>>?|<>|<<-?|[|;&()\n]/g) ?? []
  const word = (token: string) => token.replace(/'([^']*)'|"((?:\\.|[^"\\])*)"/g, (_, single, double) => single ?? double)
  const scratch = (path: string) => {
    if (!path.startsWith('/') || /[$`\\]/.test(path)) return false
    const parts: string[] = []
    for (const part of path.split('/')) {
      if (part === '..') parts.pop()
      else if (part && part !== '.') parts.push(part)
    }
    const normalized = '/' + parts.join('/')
    return normalized === '/dev/null' || normalized.startsWith('/tmp/') || normalized.startsWith('/private/tmp/')
  }
  for (let i = 0; i < tokens.length; i++) {
    if (/^(?:&?>>?|<>)$/.test(tokens[i])) {
      // File descriptor duplication (2>&1) is not a path write.
      if (tokens[i + 1] === '&' && /^(?:\d+|-)$/.test(tokens[i + 2] ?? '')) continue
      if (!scratch(word(tokens[i + 1] ?? ''))) return true
    }
  }
  const segments: string[][] = [[]]
  for (const token of tokens) {
    if (/^[|;&()\n]$/.test(token)) segments.push([])
    else segments[segments.length - 1].push(token)
  }
  for (const segment of segments) {
    const words = segment.map(word)
    // Also recognizes executable paths and common wrappers such as env or sudo.
    for (let i = 0; i < words.length; i++) {
      const executable = words[i].split('/').pop()
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || ['env', 'sudo', 'command'].includes(executable ?? '')) continue
      const args = words.slice(i + 1)
      if (executable === 'sed' && args.some(arg => /^-(?:[^-]*i|-[Ii]n-place)/.test(arg))) return true
      if (executable === 'perl' && args.some(arg => /^-[^-]*i/.test(arg))) return true
      if (/^(?:python3?|node)$/.test(executable ?? '') && segment.slice(i + 1).some(arg => /^<<-?$/.test(arg))) return true
      const flagC = args.findIndex(arg => /^-[A-Za-z]*c$/.test(arg))
      if (/^(?:sh|bash|zsh)$/.test(executable ?? '') && flagC >= 0 && args[flagC + 1] !== undefined && bashWritesFiles(args[flagC + 1])) return true
      if (/^(?:cp|mv|touch|rm|rmdir|mkdir|install|ln|truncate)$/.test(executable ?? '') && args.some(arg => !arg.startsWith('-') && !/^[<>]/.test(arg) && !scratch(arg))) return true
      if (executable === 'tee' && args.some(arg => !arg.startsWith('-') && !/^[<>]/.test(arg) && !scratch(arg))) return true
      break
    }
  }
  return false
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
    `${name}: ${p.windows.map(w => `${/week/i.test(w.name ?? '') ? 'week' : /session|5h/i.test(w.name ?? '') ? '5h' : w.name} ${w.remainingPercent}% (resets ${localReset(w.resetsAt, pacing.generatedAt)})`).join(', ')} - ${p.expectedDeadTimeMs ? `would sit unused about ${dead(p.expectedDeadTimeMs)}` : 'no expected idle time'}`)
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
  // The host may background a call on its own: then only its own acknowledgement counts,
  // never a finished report that happens to quote the phrase.
  const agentId = /^\s*Async agent launched\b[\s\S]*?\bagentId:\s*([^\s]+)/i.exec(text)?.[1]
  return agentId ? { agentId } : undefined
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

type PlanRow = { role: string, provider: string | null, modelId: string | null, displayName: string | null, decision: string, waitUntil?: string | null, why?: string, independence?: string }
type TeamPlan = { rows: PlanRow[], fingerprint: string }
async function readPlan($: EngineInterface, cwd?: string): Promise<TeamPlan | undefined> {
  try {
    const ran = await bounded(() => $.process.run(['kairo', 'team', 'routes', '--json', ...(cwd ? ['--cwd', cwd] : [])], { timeoutMs: 2000 }))
    if (ran.timedOut || ran.exitCode !== 0) return undefined
    const plan = JSON.parse(ran.stdout)
    if (typeof plan?.fingerprint !== 'string' || !plan.fingerprint || !Array.isArray(plan.rows) || !plan.rows.length || !plan.rows.every((r: any) => r && typeof r.role === 'string' && (r.provider === null || typeof r.provider === 'string') && (r.modelId === null || typeof r.modelId === 'string') && (r.displayName === null || typeof r.displayName === 'string') && typeof r.decision === 'string')) return undefined
    return plan
  } catch { return undefined }
}
function planTable(plan: TeamPlan): string {
  return ['Role | Model (provider) | Now', ...plan.rows.map(row => {
    const when = row.waitUntil && Number.isFinite(Date.parse(row.waitUntil)) ? new Date(row.waitUntil).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'unknown'
    return `${row.role} | ${row.displayName || row.modelId || 'unknown'} (${row.provider || 'unknown'}) | ${row.decision === 'ROUTED' ? (row.independence === 'builder-provider' || row.why?.includes('Not provider-independent:') ? 'routed (not independent)' : 'routed') : `waiting until ${when}`}`
  })].join('\n')
}
async function notice($: EngineInterface, text: string): Promise<boolean> {
  try {
    const result = await bounded(() => $.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } }))
    return !result.deny
  } catch { return false }
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
/**
 * Automatic checkpoint at a stable point. Fire-and-forget: the child runs under a spawn loop that is not
 * awaited (a spawn's loop outlives the hook that started it), so the host action never waits for it, and every
 * failure is swallowed. The checkpoint only writes a file; it never changes the host action.
 */
function checkpoint($: EngineInterface, gate: { busy: boolean }, trigger: 'commit' | 'delegate' | 'compact', cwd?: string, extra: string[] = [], onResult?: (stdout: string) => Promise<void>): void {
  // Single flight: while one checkpoint child runs, further triggers add nothing (the CLI throttles anyway).
  if (gate.busy) return
  gate.busy = true
  // Release only once: a later trigger may own the gate while this one runs its follow-up.
  let released = false
  const release = () => { if (!released) { released = true; gate.busy = false } }
  try {
    void (async () => {
      let stdout = ''
      try {
        for await (const piece of $.process.spawn({ argv: ['kairo', 'checkpoint', '--trigger', trigger, ...extra, ...(cwd ? ['--cwd', cwd] : [])] })) {
          if (onResult && piece.stream === 'stdout') stdout += piece.text
        }
      } catch { /* Checkpoints must never block or fail the host action. */ }
      finally { release() }
      // The follow-up runs after the gate is free, so it cannot drop other triggers or clear their gate.
      try { if (onResult) await onResult(stdout) } catch { /* silent */ }
    })()
  } catch { release() }
}

/**
 * Assisted close (S3): after a commit checkpoint, ask Kairo whether this is a stable point worth a fresh session
 * and show one toast when it is. It only suggests: nothing closes, clears or compacts. Runs inside the unawaited
 * checkpoint loop, so the tool result never waits for it; every step is bounded and every failure is silent.
 * `shown` keeps one toast per HEAD (the CLI also records the HEAD it suggested for).
 */
async function suggestFreshSession($: EngineInterface, shown: Set<string>, inflight: Set<string>, stdout: string, cwd?: string): Promise<void> {
  let head: string | undefined
  try {
    const line = stdout.trim().split('\n').filter(Boolean).at(-1)
    const result = line ? JSON.parse(line) : undefined
    if (!result || result.written !== true || result.clean !== true || result.taskType !== 'feature' || typeof result.head !== 'string' || shown.has(result.head) || inflight.has(result.head)) return
    inflight.add(result.head)
    head = result.head
    const usage = await bounded(() => $.session.usage())
    const percent = usage?.context?.percent
    if (typeof percent !== 'number' || !Number.isFinite(percent)) return
    const ran = await bounded(() => $.process.run(['kairo', 'checkpoint', '--decide', ...(cwd ? ['--cwd', cwd] : [])], { timeoutMs: 2000, stdin: JSON.stringify({ ...result, contextPercent: percent }) }))
    if (ran.timedOut || ran.exitCode !== 0) return
    const decision = JSON.parse(ran.stdout)
    if (decision?.suggest !== true || typeof decision.message !== 'string' || !decision.message) return
    // Marked shown before the toast: if the toast itself throws, that HEAD loses its suggestion (accepted, never repeated).
    shown.add(result.head)
    $.ui.toast(decision.message, { timeoutMs: 15000 })
  } catch { /* A suggestion is optional; it must never disturb the host. */ }
  finally { if (head) inflight.delete(head) }
}

async function codegraphContext($: EngineInterface, prompt: string, cwd?: string): Promise<string | undefined> {
  try {
    const ran = await bounded(() => $.process.run(['kairo', 'team', 'prompt-context', ...(cwd ? ['--cwd', cwd] : [])], { timeoutMs: 2000, stdin: JSON.stringify({ prompt, cwd }) }), 2500)
    const text = ran.stdout.trim()
    return !ran.timedOut && ran.exitCode === 0 && text.startsWith('CodeGraph') ? text : undefined
  } catch { return undefined }
}

/** Display assigned work, not transport identity or proof of provider execution. */
function launchParts(route: Route, launched: { subagent_type?: string, prompt?: string }, ownModels: ReadonlyMap<string, string> = new Map()) {
  const prompt = launched.prompt ?? ''
  const explicitRole = /^Role:[ \t]*([^\r\n(.]+)/im.exec(prompt)?.[1]?.trim()
  const routedRole = route.role?.trim()
  const role = routedRole && routedRole !== launched.subagent_type && !/^(?:kairo-|team-)/.test(routedRole) ? routedRole : explicitRole
  const fixedModel = vendor(launched.subagent_type ?? '') === 'claude' ? undefined : ownModels.get(launched.subagent_type ?? '')
  // Only provider bridges interpret kairo-model; a fixed agent ignores that line.
  const bridgeProvider = /^kairo-(codex|opencode|opencode-go|opencode-zen|cursor|gemini)$/.exec(launched.subagent_type ?? '')?.[1]
  const bridgeModel = bridgeProvider
    ? /^kairo-model:[ \t]+(\S+)[ \t]*\r?$/m.exec(prompt)?.[1] : undefined
  const model = fixedModel ?? (bridgeProvider ? bridgeModel : route.targetModel === 'agent-own' ? undefined : route.targetModel)
  return { role: role || 'Unknown role', model: model && model !== 'agent-own' ? model : 'Model unconfirmed', provider: bridgeProvider ?? route.provider }
}
function launchLabel(route: Route, launched: { subagent_type?: string, prompt?: string }, ownModels?: ReadonlyMap<string, string>): string {
  const p = launchParts(route, launched, ownModels)
  return `${p.role} — ${p.model} · ${p.provider}`
}

/** Engine modes the spinner knows; with nothing real to name it shows no word, only time and tokens. */
const spinnerModes = new Set(['thinking', 'requesting', 'responding', 'tool-input', 'tool-use'])

/** Claude Code is one routing host; provider selection belongs to Kairo. */
export const register: Register = (on, options = {}) => {
  let pacing: Pacing | undefined
  const checkpointGate = { busy: false }
  const suggestedHeads = new Set<string>()
  const decidingHeads = new Set<string>()
  let noRedirect = false
  let shownFingerprint: string | undefined
  let planRows: PlanRow[] = []
  const running = new Map<symbol, string>()
  // Cached in memory next to `running`: the Spinner hook runs every frame and must never do I/O.
  const spinning = new Map<symbol, string>()
  const background = new Map<string, () => Promise<void>>()
  const runningText = () => {
    const items = [...running.values()]
    return items.length ? items.slice(0, 3).join(' | ') + (items.length > 3 ? ` | +${items.length - 3} more` : '') : undefined
  }


  registerPane(on)
  // Tools running right now, newest last: the spinner names the tool instead of "Running a tool".
  const activeTools = new Map<symbol, string>()
  let orchestratorModel: string | undefined
  on('tool.call', async ($, e, next) => {
    const token = Symbol()
    activeTools.set(token, e.tool)
    try { return await next(e) } finally { activeTools.delete(token) }
  })
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    try {
      const first = spinning.values().next().value
      if (!spinnerModes.has(String(e.props.mode))) return next(e)
      const tool = [...activeTools.values()].at(-1)
      const running = e.props.mode === 'tool-use' && tool ? `Running ${tool}` : ''
      // With no delegation the orchestrator (this session) is the one working.
      const orchestrator = orchestratorModel ? `Orchestrator · ${orchestratorModel} (claude)` : ''
      const base = first ? first + (spinning.size > 1 ? ` +${spinning.size - 1}` : '')
        : [orchestrator, running].filter(Boolean).join(' — ')
      const critical = Object.entries(pacing?.providers ?? {}).filter(([, p]) => p.tier === 'CRITICAL').map(([name]) => `${name} CRITICAL`).join(', ')
      const message = [base, critical].filter(Boolean).join(' · ')
      // No random verb ("Sauteing") and no generic stage: an empty word draws only time and tokens.
      return next({ ...e, props: { ...e.props, word: '', message, ...(message ? {} : { suffix: '' }) } })
    } catch { /* Display only: the engine spinner stays as is. */ }
    return next(e)
  })
  let autoOpened = false
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!autoOpened && e.viewport?.isFullscreen === true) {
      autoOpened = true
      try { void $.ui.open({ id: PANE, title: 'Kairo' }).catch(() => {}) } catch { /* Surface cannot place a pane. */ }
    }
    return next(e)
  })
  on('command.run', { command: 'kairo-pane' }, async $ => {
    try {
      const panes = await $.ui.panes()
      if (panes.some(p => p.id === PANE)) { await $.ui.close({ id: PANE }); return { text: 'Kairo pane closed.' } }
      await $.ui.open({ id: PANE, title: 'Kairo' })
      return { text: 'Kairo pane opened.' }
    } catch { return { text: 'Kairo pane unavailable.' } }
  })

  for (const tool of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const) on('tool.call', { tool }, async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    return { deny: orchestratorWriteDeny }
  })
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.agentId === undefined && bashWritesFiles(e.command)) return { deny: orchestratorWriteDeny }
    return next(e)
  })
  let cwd: string | undefined
  let warned = false
  // Agent name -> the model its definition runs, read from the file that launches.
  const ownModels = new Map<string, string>()
  // The version this process loaded; a reload re-runs register and reads it again.
  let loadedVersion: Promise<string | undefined> | undefined

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    autoOpened = false
    try { await $.command.register({ name: 'kairo-pane', description: 'Toggle the Kairo pane' }) } catch { /* Optional UI. */ }
    await setPane($, { quota: [], plan: [], running: [], verdicts: null })
    loadedVersion ??= readOwnVersion($)
    warned = false
    pacing = undefined
    running.clear()
    spinning.clear()
    background.clear()
    noRedirect = false
    shownFingerprint = undefined
    planRows = []
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
    // The spinner hook runs every frame without I/O: read the main loop's model here.
    try { orchestratorModel = await $.session.model() } catch { /* Spinner then names no model. */ }
    let context: string | undefined
    let verdicts: string | null = null
    try {
      const ran = await bounded(() => $.process.run([
        'kairo', 'team', 'verdict', '--pending', '--json', ...(cwd ? ['--cwd', cwd] : []),
      ], { timeoutMs: 2000 }))
      if (!ran.timedOut && ran.exitCode === 0) {
        const rows = JSON.parse(ran.stdout)
        if (Array.isArray(rows)) verdicts = `Verdicts: ${rows.length}${rows.length ? ' — ' + rows.map((row: any) => row.agent ?? 'unknown').join(', ') : ''}`
        if (Array.isArray(rows) && rows.length > 0) {
          context = `Kairo: ${rows.length} delegated ${rows.length === 1 ? 'result waits' : 'results wait'} for a verdict; after verifying, run kairo team verdict --agent NAME --result pass or fail.`
        }
      }
    } catch { /* Missing Kairo or accounting failures must not block prompts. */ }
    const snapshot = pacing = await readPacing($, cwd)
    loadedVersion ??= readOwnVersion($)
    const stale = await readStaleLoad($, loadedVersion)
    const graph = options.showCodeGraph !== false ? await codegraphContext($, e.text, cwd) : undefined
    const plan = await readPlan($, cwd)
    const table = plan ? planTable(plan) : undefined
    await setPane($, {
      quota: snapshot ? Object.entries(snapshot.providers).map(([name, p]) => p.windows.length
        ? `${name}: ${p.windows.map(w => `${w.name} ${w.remainingPercent}% (resets ${w.resetsAt ?? 'unknown'})`).join(', ')}${snapshot.stale ? ' [stale]' : ''}`
        : `${name}: unavailable${snapshot.stale ? ' [stale]' : ''}`) : [],
      plan: table ? table.split('\n') : [], verdicts,
    })
    if (plan && table) {
      planRows = plan.rows
      if (plan.fingerprint !== shownFingerprint && await notice($, table)) shownFingerprint = plan.fingerprint
    }
    const reminder = 'Before the first implementation step, show Step | Role | Model (provider) | Inline or delegated. Resolve delegated models with kairo team route --role ROLE; inline steps read Orchestrator (session model).'
    const planContext = table ? `${table}\nInline steps run as Orchestrator (session model); delegated steps must use these rows.` : reminder
    const additions = [stale, context, planContext, options.showContext !== false && snapshot ? pacingContext(snapshot) : undefined, graph].filter((s): s is string => Boolean(s))
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

  // Before a compaction: the main conversation only, and never for the speculative precompute pass.
  on('session.compact', async ($, e, next) => {
    if (e.agentId === undefined && e.trigger !== 'precompute') checkpoint($, checkpointGate, 'compact', cwd)
    return next(e)
  })

  // Closed task: a Bash command that mentions a commit asks for a checkpoint; the CLI decides by HEAD whether one happened.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    const command = (e as { command?: unknown }).command
    if (typeof command === 'string' && /\bcommit\b/.test(command) && ran.deny === undefined) {
      checkpoint($, checkpointGate, 'commit', cwd, ['--command', command, '--json'], stdout => suggestFreshSession($, suggestedHeads, decidingHeads, stdout, cwd))
    }
    return ran
  })

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (gentleActors.has(e.subagent_type ?? '')) return next(e)
    if (options.enforceAgents !== false) {
      const denial = await agentDenial($, e.subagent_type, cwd)
      if (denial) return { deny: denial }
    }
    // Only a launch that passed the deny checks is a delegation worth a checkpoint.
    checkpoint($, checkpointGate, 'delegate', cwd)
    const marker = /\[[^\]]*\bno-redirect\b[^\]]*\]/i
    // [no-redirect] skips every rewrite, but the launch is still ledgered with the agent's real model.
    const bypassed = noRedirect || Object.values(e).some(value => typeof value === 'string' && marker.test(value))
    if (bypassed && !e.subagent_type) return next(e)
    const location = cwd ? ['--cwd', cwd] : []
    if (e.subagent_type) {
      ownModels.delete(e.subagent_type)
      try {
        const home = await $.env.get('HOME')
        // Host lookup precedence: the project's agents before the user's.
        for (const dir of [cwd ? `${cwd}/.claude/agents` : undefined, home ? `${home}/.claude/agents` : undefined]) {
          if (!dir) continue
          const text = await $.fs.read(`${dir}/${e.subagent_type}.md`).catch(() => undefined)
          if (typeof text !== 'string') continue
          const own = modelFromAgentDefinition(text, vendor(e.subagent_type) !== 'claude')
          if (own) ownModels.set(e.subagent_type, own)
          break
        }
      } catch { /* An unreadable definition leaves the model unconfirmed. */ }
    }
    const toast = (text: string) => {
      try { $.ui.toast(`kairo-router: ${text}`) } catch { /* Notifications must not block work. */ }
    }
    const readRoute = async (provider?: string): Promise<Route> => {
      if (!e.subagent_type) throw new Error('Agent has no subagent_type')
      const ran = await bounded(() => $.process.run([
        'kairo', 'team', 'route', '--agent', e.subagent_type, ...location, '--json', '--host', 'claude-code', ...(provider ? ['--provider', provider] : []),
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
      && ownModels.get(launched) === route.targetModel
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
      route = { role: name, decision: 'ROUTED', provider: vendor(name), targetModel: (vendor(name) === 'claude' ? e.model ?? ownModels.get(name) : ownModels.get(name)) ?? 'agent-own' }
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
          selected = first
          if (verdict && !verdict.keep && verdict.reason === 'price-band') toast(verdict.why)
        }
      }
      if (!selected) selected = await readRoute()
      if (!canLaunch(selected)) throw new Error('route has no launchable provider model')
      if (gentleActors.has(selected.targetAgent ?? '')) throw new Error('gentle-ai actor is not a work route')
      const kept = keepsAgent(selected, e.subagent_type)
      input = routedInput(selected)
      const downgrade = !e.model && selected.provider === 'claude' && constrained(pacing?.providers.claude) && /opus/i.test(input.model ?? '') ? 'sonnet' : undefined
      if (downgrade) input = { ...input, model: downgrade }
      // A kept hand-built provider agent fixes its own model; record that, not the route's choice.
      route = { ...selected, ...(downgrade ? { targetModel: downgrade } : kept ? { targetModel: ownModels.get(e.subagent_type!) ?? 'agent-own' } : {}) }
      recordLaunch(route, input.subagent_type)
    } catch (error) {
      if (!warned) {
        warned = true
        toast(`${error instanceof Error ? error.message : String(error)}; launching unchanged`)
      }
    }
    const launchVisible = async (selected: Route | undefined, launched: typeof e) => {
      const label = selected && !bypassed
        ? `${selected.role ?? e.subagent_type ?? 'Agent'} | ${selected.displayName ?? planRows.find(row => row.role === selected.role && row.provider === selected.provider && row.modelId === selected.targetModel)?.displayName ?? selected.targetModel} (${selected.provider})`
        : e.subagent_type ?? 'Agent'
      await notice($, `▶ ${label} started`)
      if (!selected) {
        try { return await next(launched) } finally { await notice($, `■ ${label} finished`) }
      }
      { const p = launchParts(selected, launched, ownModels)
        // The task card shows who really runs the work; only a known role is worth the prefix,
        // and [no-redirect] launches stay exactly as written.
        if (!bypassed && p.role !== 'Unknown role' && typeof e.description === 'string') launched = { ...launched, description: `${p.role} · ${p.model} (${p.provider}) — ${e.description}` } }
      const token = Symbol()
      running.set(token, launchLabel(selected, launched, ownModels))
      { const p = launchParts(selected, launched, ownModels); spinning.set(token, `${p.role} · ${p.model} (${p.provider})`) }
      await setPane($, () => ({ running: [...running.values()] }))
      const clear = async () => { running.delete(token); spinning.delete(token); await setPane($, () => ({ running: [...running.values()] })) }
      let deferred = false
      try {
        const result = await next(launched)
        const pending = backgroundLaunch(result, launched.run_in_background)
        if (pending?.agentId) {
          background.set(pending.agentId, async () => {
            await clear()
            await notice($, `■ ${label} finished`)
            await recordOutcome(selected, launched.subagent_type, 'completed')
          })
          deferred = true
        }
        return result
      } finally { if (!deferred) { await clear(); await notice($, `■ ${label} finished`) } }
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
