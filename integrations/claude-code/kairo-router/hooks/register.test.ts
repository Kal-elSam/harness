import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { pacingContext, pacingBand } from './register'

const renderPane = async ($: any) => JSON.stringify(await $.ui.render({ component: 'Pane', requestId: 'kairo', surface: 'desktop', props: { title: 'Kairo', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } }))

const planTableContext = expect.stringContaining('Step | Role | Model (provider) | Inline or delegated')

// Agent enforcement has its own tests below; the older worlds count only the processes they assert on.
const allowAgentCheck = (e: { argv: unknown }) => (e.argv as string[])[2] === 'check-agent'
  ? { value: { exitCode: 0, stdout: '{"allowed":true}', stderr: '', timedOut: false } } : undefined

function world(on: On, response: unknown = { decision: 'ROUTED', provider: 'codex', targetAgent: 'team-builder-codex', targetModel: 'gpt-a' }, failure?: string, duringLaunch?: () => void | Promise<void>) {
  const calls: Array<Record<string, unknown>> = []
  const processes: Array<Record<string, unknown>> = []
  const toasts: string[] = []
  mock.clock(on, { now: 1_700_000_000_000 })
  on('process.run', (_, e) => {
    { const checked = allowAgentCheck(e); if (checked) return checked }
    processes.push({ ...e })
    if ((e.argv as string[])[2] === 'detect-exhaustion') return { value: { exitCode: 0, stdout: 'null', stderr: '', timedOut: false } }
    if (['record-launch', 'record-outcome'].includes((e.argv as string[])[2])) {
      if (failure === 'record-throw') throw new Error('ledger unavailable')
      if (failure === 'record-pending') return new Promise(() => {})
      return { value: { exitCode: failure === 'record-exit' ? 1 : 0, stdout: '', stderr: '', timedOut: false } }
    }
    if (failure === 'throw') throw new Error('process unavailable')
    return { value: { exitCode: failure === 'exit' ? 1 : 0, stdout: JSON.stringify(response), stderr: '', timedOut: failure === 'timeout' } }
  })
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', async (_, e) => { const { tool_use_id, ...input } = e; calls.push(input); await duringLaunch?.(); return { result: {} } })
  return { calls, processes, toasts }
}
const agent = (prompt = 'build it') => ({ tool: 'Agent', subagent_type: 'team-builder', description: 'build', prompt }) as const

// Serves a hand-built agent definition from the user's agents directory.
function defineAgent(on: On, name: string, model: string) {
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.read', (_, e) => {
    if (e.path === `/home/u/.claude/agents/${name}.md`) return { value: `---\nname: ${name}\nmodel: haiku\n---\nRun \`codex exec -m ${model}\`.\n` }
    throw new Error('not found')
  })
}
test('routes to the Codex agent without setting a non-Claude model', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(w.calls).toEqual([{ ...agent(), subagent_type: 'team-builder-codex' }])
  expect(w.processes).toHaveLength(4)
  expect(w.processes[0]).toMatchObject({ argv: ['kairo', 'team', 'route', '--agent', 'team-builder', '--cwd', '/tmp/project', '--json', '--host', 'claude-code'], init: { timeoutMs: 2000 } })
})

test('sets routed Claude model even when the agent name stays the same', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'claude', targetAgent: 'team-builder', targetModel: 'sonnet' })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(w.calls).toEqual([{ ...agent(), model: 'sonnet' }])
})

for (const [reason, response, failure] of [
  ['stale', { decision: 'STALE', why: 'refresh required' }, undefined],
  ['unknown agent', { decision: 'ERROR', code: 'unknown_agent', message: 'Unknown agent' }, 'exit'],
  ['timeout', {}, 'timeout'],
  ['error', {}, 'throw'],
  ['nonzero', {}, 'exit'],
  ['malformed', null, undefined],
] as const) test(`fails open on ${reason} and warns once per session`, async ($, on) => {
  const w = world(on, response, failure)
  for (let i = 0; i < 2; i++) expect((await $.tool.call(agent())).deny).toBeUndefined()
  expect(w.calls).toEqual([agent(), agent()])
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('kairo-router:')
})

for (const prompt of ['retry [no-redirect]', 'retry [please no-redirect here]']) test(`bracket marker bypasses rewrites but is still ledgered: ${prompt}`, async ($, on) => {
  const w = world(on)
  const input = { ...agent(prompt), model: 'opus' }
  expect((await $.tool.call(input)).deny).toBeUndefined()
  expect(w.calls).toEqual([input])
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'route')).toHaveLength(0)
  expect(w.processes.find(p => (p.argv as string[])[2] === 'record-launch')).toMatchObject({ argv: ['kairo', 'team', 'record-launch', '--agent', 'team-builder', '--adapter', 'claude', '--model', 'opus'] })
  expect(w.processes.find(p => (p.argv as string[])[2] === 'record-outcome')).toMatchObject({ argv: expect.arrayContaining(['--status', 'completed']) })
  expect(w.toasts).toHaveLength(0)
})

test('no-redirect on a hand-built Codex agent is ledgered with the model that agent runs', async ($, on) => {
  const w = world(on)
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.read', (_, e) => {
    if (e.path === '/home/u/.claude/agents/team-builder-codex.md') return { value: '---\nname: team-builder-codex\nmodel: haiku\n---\nRun `codex exec -m gpt-6.1-sol`.\n' }
    throw new Error('not found')
  })
  await $.tool.call({ ...agent('go [no-redirect]'), subagent_type: 'team-builder-codex' })
  expect(w.processes.find(p => (p.argv as string[])[2] === 'record-launch')).toMatchObject({ argv: ['kairo', 'team', 'record-launch', '--agent', 'team-builder-codex', '--adapter', 'codex', '--model', 'gpt-6.1-sol'] })
})

for (const provider of ['codex', 'opencode', 'opencode-go', 'gemini']) test(`routes unmapped ${provider} work through its Kairo wrapper with the concrete model`, async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider, targetAgent: null, targetModel: 'model-a' })
  expect((await $.tool.call(agent())).deny).toBeUndefined()
  expect(w.calls).toEqual([{ ...agent(), subagent_type: `kairo-${provider}`, prompt: 'kairo-model: model-a\nbuild it' }])
  expect(w.toasts).toHaveLength(0)
})


test('Claude route sets its model when no adapter agent is registered', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'claude', targetAgent: null, targetModel: 'sonnet' })
  expect((await $.tool.call(agent())).deny).toBeUndefined()
  expect(w.calls).toEqual([{ ...agent(), model: 'sonnet' }])
})

test('other tools bypass the router', async ($, on) => {
  const w = world(on)
  expect((await $.tool.call({ tool: 'Read', file_path: '/tmp/example' })).deny).toBeUndefined()
  expect(w.processes).toHaveLength(0)
})

for (const failure of [undefined, 'record-exit', 'record-throw', 'record-pending']) test(`records routed launch without waiting or denying on ${failure}`, async ($, on) => {
  const w = world(on, undefined, failure)
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  expect((await $.tool.call(agent())).deny).toBeUndefined()
  expect(w.calls).toEqual([{ ...agent(), subagent_type: 'team-builder-codex' }])
  expect(w.processes[1]).toMatchObject({ argv: ['kairo', 'team', 'record-launch', '--agent', 'team-builder-codex', '--adapter', 'codex', '--model', 'gpt-a', '--cwd', '/tmp/project'] })
  expect(w.toasts).toHaveLength(0)
})

test('records confirmed original agent and final Claude model', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'claude', targetAgent: 'team-builder', targetModel: 'sonnet' })
  expect((await $.tool.call(agent())).deny).toBeUndefined()
  expect(w.processes[1]).toMatchObject({ argv: ['kairo', 'team', 'record-launch', '--agent', 'team-builder', '--adapter', 'claude', '--model', 'sonnet'] })
})

test('records the original catalog agent for a built-in wrapper and routed provider model', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'codex', targetAgent: null, targetModel: 'gpt-a' })
  await $.tool.call(agent())
  expect(w.processes).toHaveLength(4)
  expect(w.processes[1]).toMatchObject({ argv: ['kairo', 'team', 'record-launch', '--agent', 'team-builder', '--adapter', 'codex', '--model', 'gpt-a'] })
})

for (const route of [
  { provider: '', targetAgent: 'team-builder-codex', targetModel: 'gpt-a' },
  { provider: 'codex', targetAgent: 'team-builder-codex', targetModel: '' },
]) test(`fails open without modifying the input on invalid route ${JSON.stringify(route)}`, async ($, on) => {
  const w = world(on, { decision: 'ROUTED', ...route })
  expect((await $.tool.call(agent())).deny).toBeUndefined()
  expect(w.calls).toEqual([agent()])
  expect(w.processes).toHaveLength(1)
})

const codexRoute = { decision: 'ROUTED', provider: 'codex', targetAgent: 'team-builder-codex', targetModel: 'gpt-a' }
const claudeRoute = { decision: 'ROUTED', provider: 'claude', targetAgent: 'team-builder', targetModel: 'sonnet' }
const exhaustedResult = { content: [{ type: 'text', text: 'You have hit your usage limit. Please try again later.' }], exitCode: 1 }

function handoverWorld(on: On, options: {
  initialRoute?: unknown,
  reroute?: unknown,
  first?: unknown,
  second?: unknown,
  recordFailure?: string,
  rerouteFailure?: string,
  detectionFailure?: string,
  pacing?: boolean,
} = {}) {
  const calls: Array<Record<string, unknown>> = []
  const processes: Array<Record<string, unknown>> = []
  const toasts: string[] = []
  if (options.pacing) {
    on('prompt.submit', (_, e) => ({ text: e.text }))
    on('ui.status', () => ({ value: undefined }))
  }
  let routes = 0
  let exhaustedRecorded = false
  on('process.run', async (_, e) => {
    { const checked = allowAgentCheck(e); if (checked) return checked }
    processes.push({ ...e })
    const argv = e.argv as string[]
    if (argv[2] === 'prompt-context' || argv[2] === 'routes') return { value: { exitCode: 0, stdout: '', stderr: '', timedOut: false } }
    if (options.pacing && ['pacing', 'verdict'].includes(argv[2])) return { value: { exitCode: 0, stdout: JSON.stringify(argv[2] === 'pacing' ? pacingResponse : []), stderr: '', timedOut: false } }
    if (argv[2] === 'detect-exhaustion') {
      if (options.detectionFailure === 'throw') throw new Error('detector failed')
      if (options.detectionFailure === 'malformed') return { value: { exitCode: 0, stdout: '{}', stderr: '', timedOut: false } }
      const isExhausted = calls.length === 1 ? options.first === undefined : options.second === exhaustedResult
      const provider = argv[argv.indexOf('--adapter') + 1]
      return { value: { exitCode: 0, stdout: JSON.stringify(isExhausted ? { provider, reason: 'usage limit exhausted' } : null), stderr: '', timedOut: false } }
    }
    if (argv[2] === 'record-outcome') {
      // Built-in transport names are not members of the project role catalog.
      if (argv[argv.indexOf('--agent') + 1].startsWith('kairo-')) return { value: { exitCode: 1, stdout: '', stderr: 'Unknown agent in project role catalog', timedOut: false } }
      if (options.recordFailure === 'throw') throw new Error('record failed')
      if (options.recordFailure === 'pending') return new Promise(() => {})
      if (options.recordFailure === 'exit') return { value: { exitCode: 1, stdout: '', stderr: 'record failed', timedOut: false } }
      // Rerouting must wait until the exhaustion marker is durably applied.
      await Promise.resolve()
      if (argv.includes('exhausted')) exhaustedRecorded = true
      return { value: { exitCode: 0, stdout: '{}', stderr: '', timedOut: false } }
    }
    if (argv[2] === 'record-launch') return { value: { exitCode: 0, stdout: '', stderr: '', timedOut: false } }
    routes++
    if (routes > 1) {
      expect(exhaustedRecorded).toBe(true)
      if (options.rerouteFailure === 'throw') throw new Error('reroute failed')
      if (options.rerouteFailure === 'timeout') return { value: { exitCode: null, stdout: '', stderr: '', timedOut: true } }
      if (options.rerouteFailure === 'malformed') return { value: { exitCode: 0, stdout: '{', stderr: '', timedOut: false } }
    }
    return { value: { exitCode: 0, stdout: JSON.stringify(routes === 1 ? options.initialRoute ?? codexRoute : options.reroute ?? claudeRoute), stderr: '', timedOut: false } }
  })
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => {
    const { tool_use_id, ...input } = e
    calls.push(input)
    return { result: calls.length === 1 ? options.first ?? exhaustedResult : options.second ?? { content: [{ type: 'text', text: 'Finished remaining work.' }] } }
  })
  return { calls, processes, toasts }
}

test('records completed outcomes in the background without changing the tool result', async ($, on) => {
  const original = { content: [{ type: 'text', text: 'Build completed.' }] }
  const w = handoverWorld(on, { first: original, recordFailure: 'pending' })
  const result = await $.tool.call(agent())
  expect(result.result).toEqual(original)
  expect(w.calls).toHaveLength(1)
  expect(w.processes.find(p => (p.argv as string[])[2] === 'record-outcome')).toMatchObject({ argv: ['kairo', 'team', 'record-outcome', '--agent', 'team-builder-codex', '--adapter', 'codex', '--model', 'gpt-a', '--status', 'completed'] })
  expect(w.toasts).toHaveLength(0)
})

test('hands exhausted work to another provider once using the original role and working tree', async ($, on) => {
  const w = handoverWorld(on)
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(result.result).toEqual({ content: [{ type: 'text', text: 'Finished remaining work.' }] })
  expect(w.calls).toHaveLength(2)
  expect(w.calls[1]).toMatchObject({ subagent_type: 'team-builder', model: 'sonnet', description: 'build' })
  expect(w.calls[1].prompt).toContain('codex')
  expect(w.calls[1].prompt).toContain('current working tree')
  expect(w.calls[1].prompt).toContain('do not redo finished work')
  expect(w.calls[1].prompt).toContain('build it')
  const routes = w.processes.filter(p => (p.argv as string[])[2] === 'route')
  expect(routes).toHaveLength(2)
  expect(routes[1]).toMatchObject({ argv: ['kairo', 'team', 'route', '--agent', 'team-builder', '--cwd', '/tmp/project', '--json', '--host', 'claude-code'] })
  const outcomes = w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')
  expect(outcomes).toHaveLength(2)
  expect(outcomes[0].argv).toContain('exhausted')
  expect(outcomes[1].argv).toContain('completed')
  expect(outcomes[1].argv).toContain('claude')
  expect(w.toasts).toHaveLength(0)
})

test('records second provider exhaustion without a third launch or another notification', async ($, on) => {
  const w = handoverWorld(on, { second: exhaustedResult })
  expect((await $.tool.call(agent())).result).toEqual(exhaustedResult)
  expect(w.calls).toHaveLength(2)
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'route')).toHaveLength(2)
  const outcomes = w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')
  expect(outcomes).toHaveLength(2)
  expect(outcomes[1].argv).toContain('exhausted')
  expect(outcomes[1].argv).toContain('claude')
  expect(w.toasts).toHaveLength(0)
})

test('hands built-in wrapper exhaustion back to Claude using the original role', async ($, on) => {
  const w = handoverWorld(on, { initialRoute: { decision: 'ROUTED', provider: 'codex', targetModel: 'gpt-a' } })
  await $.tool.call(agent())
  expect(w.calls).toHaveLength(2)
  expect(w.calls[0]).toEqual({ ...agent(), subagent_type: 'kairo-codex', prompt: 'kairo-model: gpt-a\nbuild it' })
  expect(w.calls[1]).toMatchObject({ subagent_type: 'team-builder', model: 'sonnet' })
  expect(w.calls[1].prompt).not.toContain('kairo-model:')
  const routes = w.processes.filter(p => (p.argv as string[])[2] === 'route')
  expect(routes).toHaveLength(2)
  expect(routes[1].argv).toContain('team-builder')
})

test('keeps the concrete model header on a replacement wrapper and never hands over twice', async ($, on) => {
  const w = handoverWorld(on, { reroute: { decision: 'ROUTED', provider: 'gemini', targetModel: 'gemini-a' }, second: exhaustedResult })
  expect((await $.tool.call(agent())).result).toEqual(exhaustedResult)
  expect(w.calls).toHaveLength(2)
  expect(w.calls[1]).toEqual({ ...agent(), subagent_type: 'kairo-gemini', prompt: 'kairo-model: gemini-a\nPrevious codex provider stopped on quota. Continue from the current working tree state; do not redo finished work.\n\nbuild it' })
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'route')).toHaveLength(2)
  expect(w.toasts).toHaveLength(0)
  const outcomes = w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')
  expect(outcomes).toHaveLength(2)
  expect(outcomes[1].argv).toContain('gemini')
  expect(outcomes[1].argv).toContain('exhausted')
})

test('background launch records no outcome while the subagent keeps working', async ($, on) => {
  on('classic.SubagentStop', () => ({}))
  const launched = { content: [{ type: 'text', text: 'Async agent launched successfully.\nagentId: a1\nThe agent is working in the background. You will be notified when it completes.' }] }
  const w = handoverWorld(on, { first: launched })
  const result = await $.tool.call({ ...agent(), run_in_background: true })
  expect(result.result).toEqual(launched)
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'record-launch')).toHaveLength(1)
  expect(w.processes.filter(p => ['record-outcome', 'detect-exhaustion'].includes((p.argv as string[])[2]))).toHaveLength(0)
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1', agent_transcript_path: '/tmp/a1.jsonl', agent_type: 'team-builder-codex' })
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')).toHaveLength(1)
})

test('structured background acknowledgement does not record an outcome on tool return', async ($, on) => {
  const launched = { status: 'async_launched', agentId: 'background-1', description: 'build', prompt: 'build it', outputFile: '/tmp/background-1.output' }
  const w = handoverWorld(on, { first: launched })
  const result = await $.tool.call({ ...agent(), run_in_background: true })
  expect(result.result).toEqual(launched)
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'record-launch')).toHaveLength(1)
  expect(w.processes.filter(p => ['record-outcome', 'detect-exhaustion'].includes((p.argv as string[])[2]))).toHaveLength(0)
})

test('subagent stop records the background launch identity exactly once', async ($, on) => {
  on('classic.SubagentStop', () => ({}))
  const w = handoverWorld(on, { first: { status: 'async_launched', agentId: 'background-1' }, initialRoute: { decision: 'ROUTED', provider: 'gemini', targetAgent: null, targetModel: 'gemini-model' } })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.tool.call({ ...agent(), run_in_background: true })
  const stop = { stop_hook_active: false, agent_id: 'background-1', agent_transcript_path: '/tmp/background-1.jsonl', agent_type: 'kairo-gemini' }
  await $.classic.SubagentStop({ ...stop, agent_id: 'unrelated' })
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')).toHaveLength(0)
  await $.classic.SubagentStop(stop)
  await $.classic.SubagentStop(stop)
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')).toEqual([
    expect.objectContaining({ argv: ['kairo', 'team', 'record-outcome', '--agent', 'team-builder', '--adapter', 'gemini', '--model', 'gemini-model', '--status', 'completed', '--cwd', '/tmp/project'] }),
  ])
})

test('foreground launch with the background flag but a finished result still records its outcome', async ($, on) => {
  const w = handoverWorld(on, { first: { content: [{ type: 'text', text: 'Build completed.' }] } })
  await $.tool.call({ ...agent(), run_in_background: true })
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')).toHaveLength(1)
})

test('replaces a fixed-model hand-built agent with the Kairo wrapper when the route chose another model', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'codex', targetAgent: null, targetModel: 'gpt-6-astra' })
  defineAgent(on, 'team-builder-codex', 'gpt-6.1-sol')
  await $.tool.call({ ...agent(), subagent_type: 'team-builder-codex' })
  expect(w.calls[0]).toMatchObject({ subagent_type: 'kairo-codex', prompt: 'kairo-model: gpt-6-astra\nbuild it' })
  expect(w.processes.find(p => (p.argv as string[])[2] === 'record-launch')).toMatchObject({ argv: ['kairo', 'team', 'record-launch', '--agent', 'team-builder-codex', '--adapter', 'codex', '--model', 'gpt-6-astra'] })
})

test('keeps a catalog agent already on the route provider instead of a wrapper and records its own model', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'codex', targetAgent: null, targetModel: 'gpt-6.1-sol' })
  defineAgent(on, 'team-builder-codex', 'gpt-6.1-sol')
  const input = { ...agent(), subagent_type: 'team-builder-codex' }
  await $.tool.call(input)
  expect(w.calls).toEqual([input])
  const launch = w.processes.find(p => (p.argv as string[])[2] === 'record-launch')
  expect(launch).toMatchObject({ argv: ['kairo', 'team', 'record-launch', '--agent', 'team-builder-codex', '--adapter', 'codex', '--model', 'gpt-6.1-sol'] })
})

test('still wraps when the provider must change', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'gemini', targetAgent: null, targetModel: 'gemini-a' })
  await $.tool.call({ ...agent(), subagent_type: 'team-builder-codex' })
  expect(w.calls[0]).toMatchObject({ subagent_type: 'kairo-gemini', prompt: 'kairo-model: gemini-a\nbuild it' })
})

for (const reroute of [codexRoute, { decision: 'STALE', why: 'refresh required' }, { decision: 'ROUTED', provider: 'claude', targetAgent: null, targetModel: null }]) test(`does not relaunch exhausted work on unusable reroute ${JSON.stringify(reroute)}`, async ($, on) => {
  const w = handoverWorld(on, { reroute })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(result.result).toEqual(exhaustedResult)
  expect(w.calls).toHaveLength(1)
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('codex')
})

for (const recordFailure of ['throw', 'exit', 'pending']) test(`preserves original exhaustion when recording fails: ${recordFailure}`, async ($, on) => {
  const w = handoverWorld(on, { recordFailure })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(result.result).toEqual(exhaustedResult)
  expect(w.calls).toHaveLength(1)
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'route')).toHaveLength(1)
  expect(w.toasts).toHaveLength(1)
})

for (const rerouteFailure of ['throw', 'timeout', 'malformed']) test(`preserves original exhaustion when rerouting fails: ${rerouteFailure}`, async ($, on) => {
  const w = handoverWorld(on, { rerouteFailure })
  const result = await $.tool.call(agent())
  expect(result.result).toEqual(exhaustedResult)
  expect(w.calls).toHaveLength(1)
  expect(w.toasts).toHaveLength(1)
})

test('ordinary failed work records failure without being retried as exhausted', async ($, on) => {
  const original = { content: [{ type: 'text', text: 'Compilation failed: missing variable.' }], exitCode: 1 }
  const w = handoverWorld(on, { first: original })
  expect((await $.tool.call(agent())).result).toEqual(original)
  expect(w.calls).toHaveLength(1)
  expect(w.processes.find(p => (p.argv as string[])[2] === 'record-outcome')?.argv).toContain('failed')
  expect(w.toasts).toHaveLength(0)
})

for (const detectionFailure of ['throw', 'malformed']) test(`fails open when shared exhaustion detection fails: ${detectionFailure}`, async ($, on) => {
  const w = handoverWorld(on, { detectionFailure })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(result.result).toEqual(exhaustedResult)
  expect(w.calls).toHaveLength(1)
  expect(w.toasts).toHaveLength(1)
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')).toHaveLength(0)
})

test('sends normalized tool text and exit metadata to the shared detector CLI', async ($, on) => {
  const w = handoverWorld(on)
  await $.tool.call(agent())
  const detected = w.processes.find(p => (p.argv as string[])[2] === 'detect-exhaustion')
  expect(detected).toMatchObject({ argv: ['kairo', 'team', 'detect-exhaustion', '--text', exhaustedResult.content[0].text, '--adapter', 'codex', '--exit-code', '1'], init: { timeoutMs: 2000 } })
})


test('successful error-handling summary preserves completion when the shared detector returns null', async ($, on) => {
  const original = {
    content: [{ type: 'text', text: 'Implemented handling for usage_limit_reached and rate_limit_exceeded errors. All tests pass.' }],
    exitCode: 0,
  }
  // The backend regression verifies this null response using the actual classifier.
  const w = handoverWorld(on, { first: original })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(result.result).toEqual(original)
  expect(w.calls).toHaveLength(1)
  expect(w.processes.find(p => (p.argv as string[])[2] === 'detect-exhaustion')).toMatchObject({ argv: ['kairo', 'team', 'detect-exhaustion', '--text', original.content[0].text, '--adapter', 'codex', '--exit-code', '0'] })
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'route')).toHaveLength(1)
  const outcomes = w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')
  expect(outcomes).toHaveLength(1)
  expect(outcomes[0].argv).toContain('completed')
  expect(outcomes[0].argv).not.toContain('exhausted')
  expect(w.toasts).toHaveLength(0)
})

for (const [name, rows, failure] of [
  ['pending', [{ agent: 'team-builder', modelId: 'gpt-a', at: '2026-10-23T00:00:00Z' }], undefined],
  ['empty', [], undefined],
  ['missing kairo', [], 'throw'],
  ['nonzero', [], 'exit'],
  ['timeout', [], 'timeout'],
  ['malformed', {}, undefined],
] as const) test(`pending verdict reminder: ${name}`, async ($, on) => {
  const w = world(on, rows, failure)
  const prompts: Array<Record<string, unknown>> = []
  on('prompt.submit', (_, e) => { prompts.push({ ...e }); return { text: e.text } })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.prompt.submit({ text: 'continue', context: ['existing'] })
  expect(prompts).toHaveLength(1)
  expect(prompts[0].text).toBe('continue')
  if (name === 'pending') {
    expect(prompts[0].context).toEqual(['existing', 'Kairo: 1 delegated result waits for a verdict; after verifying, run kairo team verdict --agent NAME --result pass or fail.', planTableContext])
    expect(w.processes[0]).toMatchObject({ argv: ['kairo', 'team', 'verdict', '--pending', '--json', '--cwd', '/tmp/project'] })
  } else expect(prompts[0].context).toEqual(['existing', planTableContext])
  expect(w.toasts).toHaveLength(0)
})

const pacingResponse = {
  ok: true, generatedAt: '2026-10-23T12:00:00Z', preferredProvider: 'codex', nextWriter: 'team-builder-codex', writerCounts: { claude: 3, codex: 1 },
  providers: {
    claude: { tier: 'CONSERVE', expectedDeadTimeMs: 7200000, windows: [{ name: 'weekly', remainingPercent: 10, resetsAt: '2026-10-24T12:00:00Z', expectedDeadTimeMs: 7200000 }] },
    codex: { tier: 'WATCH', expectedDeadTimeMs: 0, windows: [{ name: '5h', remainingPercent: 60, resetsAt: '2026-10-23T14:00:00Z', expectedDeadTimeMs: 0 }] },
  },
}
function pacingWorld(on: On, provider = 'codex', claudeModel = 'sonnet') {
  const calls: Array<Record<string, unknown>> = [], prompts: Array<Record<string, unknown>> = [], statuses: unknown[] = []
  const processes: string[][] = []
  on('process.run', (_, e) => {
    { const checked = allowAgentCheck(e); if (checked) return checked }
    const argv = e.argv as string[]; processes.push(argv)
    const value = argv[2] === 'pacing' ? pacingResponse : argv[2] === 'route' ? { decision: 'ROUTED', provider, targetAgent: provider === 'claude' ? 'team-builder' : 'team-builder-codex', targetModel: provider === 'claude' ? claudeModel : 'gpt-a' } : argv[2] === 'verdict' ? [] : null
    return { value: { exitCode: 0, stdout: JSON.stringify(value), stderr: '', timedOut: false } }
  })
  on('ui.status', (_, e) => { statuses.push(e); return { value: undefined } })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }))
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => { prompts.push({ ...e }); return { text: e.text } })
  on('tool.call', (_, e) => { const { tool_use_id, ...input } = e; calls.push(input); return { result: {} } })
  return { calls, prompts, statuses, processes }
}
test('one compact pacing context line and separate status entry preserve existing context', async ($, on) => {
  const w = pacingWorld(on)
  await $.prompt.submit({ text: 'continue', context: ['existing'] })
  expect(w.prompts[0].context).toEqual(['existing', planTableContext, expect.stringContaining('Pacing:')])
  const line = (w.prompts[0].context as string[])[2]
  expect(line).toContain('claude: week 10% (resets Oct 24) - would sit unused about 2h')
  expect(line).toContain('next writer team-builder-codex')
  expect(line.split('\n')).toHaveLength(1)
  expect(w.statuses).toHaveLength(0)
})
test('the context switch hides pacing context without disabling routing', { options: { showContext: false } }, async ($, on) => {
  const w = pacingWorld(on)
  await $.prompt.submit({ text: 'continue', context: ['existing'] })
  await $.tool.call(agent())
  expect(w.prompts[0].context).toEqual(['existing', planTableContext])
  expect(w.statuses).toHaveLength(0)
  expect(w.calls[0].subagent_type).toBe('team-builder-codex')
})
for (const name of ['review-risk', 'review-resilience', 'review-readability', 'review-reliability', 'review-refuter', 'jd-judge-a', 'jd-judge-b', 'jd-fix-agent']) test(`never looks up or rewrites gentle actor ${name}`, async ($, on) => {
  const w = pacingWorld(on)
  const input = { ...agent(), subagent_type: name }
  await $.tool.call(input)
  expect(w.calls).toEqual([input])
  expect(w.processes).toHaveLength(0)
})

test('prompt no-redirect marker bypasses every subsequent Agent rewrite', async ($, on) => {
  const w = pacingWorld(on)
  await $.prompt.submit({ text: '[no-redirect] continue' })
  await $.tool.call(agent())
  expect(w.calls).toEqual([agent()])
  expect(w.processes.filter(argv => argv[2] === 'route')).toHaveLength(0)
})
test('malformed pacing windows fail open without blocking prompts', async ($, on) => {
  const prompts: unknown[] = []
  on('process.run', (_, e) => ({ value: { exitCode: 0, stdout: JSON.stringify((e.argv as string[])[2] === 'pacing' ? { ...pacingResponse, providers: { claude: { ...pacingResponse.providers.claude, windows: [null] } } } : []), stderr: '', timedOut: false } }))
  on('prompt.submit', (_, e) => { prompts.push(e); return { text: e.text } })
  await $.prompt.submit({ text: 'continue', context: ['existing'] })
  expect(prompts).toHaveLength(1)
})

test('band shows only action and constrained return, without quota percentages', async ($, on) => {
  pacingWorld(on)
  await $.prompt.submit({ text: 'continue' })
  const rendered = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', requestId: 'pacing', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} } })
  const text = JSON.stringify(rendered)
  expect(text).toContain('engine band')
  expect(text).not.toContain('runs out')
  expect(text).not.toContain('Use codex now')
  expect(text).not.toContain('would sit unused')
  expect(text).not.toContain('10%')
  expect(text).not.toContain('CONSERVE')
})
test('the prompt area keeps the engine render: no pacing band', async ($, on) => {
  pacingWorld(on)
  await $.prompt.submit({ text: 'continue' })
  const rendered = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', requestId: 'pacing', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} } })
  expect(JSON.stringify(rendered)).not.toContain('runs out')
})


test('conflicting pacing never bypasses qualified route accounting or exhaustion handling', async ($, on) => {
  const w = pacingWorld(on, 'claude')
  await $.prompt.submit({ text: 'continue' })
  await $.tool.call(agent())
  expect(w.calls[0].subagent_type).toBe('team-builder')
  expect(w.calls[0].model).toBe('sonnet')
  const launch = w.processes.find(argv => argv[2] === 'record-launch')
  expect(launch).toContain('claude')
  expect(launch).toContain('sonnet')
  expect(w.processes.filter(argv => argv[2] === 'detect-exhaustion')).toHaveLength(1)
  expect(w.processes.filter(argv => argv[2] === 'record-outcome')).toHaveLength(1)
})

test('pacing leaves provider selection to the ordinary Kairo route', async ($, on) => {
  const w = pacingWorld(on, 'claude')
  await $.prompt.submit({ text: 'continue' })
  await $.tool.call(agent())
  const route = w.processes.find(argv => argv[2] === 'route')!
  expect(route).not.toContain('--provider')
  expect(w.calls[0].subagent_type).toBe('team-builder')
})

test('empty providers appear once in context and never add unknown band rows', () => {
  const snapshot = { ...pacingResponse, providers: { ...pacingResponse.providers, 'opencode-go': { tier: null, windows: [], expectedDeadTimeMs: null } } }
  const context = pacingContext(snapshot)
  expect(context).toContain('No quota data: opencode-go')
  expect(context).not.toContain('UNKNOWN')
  expect(context.split('opencode-go')).toHaveLength(2)
  expect(pacingBand(snapshot) ?? '').not.toContain('opencode-go')
})

test('ordinary route retains concrete model, launch accounting and exhaustion handover', async ($, on) => {
  const w = handoverWorld(on, { pacing: true })
  await $.prompt.submit({ text: 'continue' })
  await $.tool.call(agent())
  const routes = w.processes.filter(p => (p.argv as string[])[2] === 'route')
  expect(routes).toHaveLength(2)
  expect(routes[0].argv).not.toContain('--provider')
  expect(routes[1].argv).not.toContain('--provider')
  expect(w.calls[0].subagent_type).toBe('team-builder-codex')
  expect(w.calls[1].model).toBe('sonnet')
  const launches = w.processes.filter(p => (p.argv as string[])[2] === 'record-launch')
  expect(launches).toHaveLength(2)
  expect(launches[0].argv).toContain('gpt-a')
  expect(launches[1].argv).toContain('sonnet')
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')).toHaveLength(2)
})


test('live status shows final routed model during launch and clears on completion', async ($, on) => {
  const statuses: unknown[] = [];
  world(on, { decision: 'ROUTED', role: 'Explorer', provider: 'claude', targetAgent: 'team-explorer', targetModel: 'claude-haiku-5-5' }, undefined, async () => {
    expect(await renderPane($)).toContain('Explorer — claude-haiku-5-5 · claude');
  });
  on('ui.status', (_, e) => { statuses.push(e); return { value: undefined } });
  await $.tool.call({ ...agent(), subagent_type: 'team-explorer' });
  expect(await renderPane($)).not.toContain('claude-haiku-5-5');
  expect(statuses).toHaveLength(0);
});


for (const [name, prompt, expected] of [
  ['wrapper metadata', '[no-redirect]\nRole: Builder (writer only).\nkairo-model: gpt-6.1-terra\nFix the issue.', 'Builder — gpt-6.1-terra · codex'],
  ['missing metadata', '[no-redirect]\nFix the issue.', 'Unknown role — Model unconfirmed · codex'],
] as const) test(`live wrapper status uses explicit role/model or uncertainty: ${name}`, async ($, on) => {
  const statuses: unknown[] = []
  const input = { ...agent(prompt), subagent_type: 'kairo-codex' }
  const w = world(on, undefined, undefined, async () => {
    const text = await renderPane($)
    expect(text).toContain(expected)
    expect(text).not.toContain('agent-own')
    expect(text).not.toContain('kairo-codex')
    expect(text).not.toContain('opus')
  })
  on('ui.status', (_, e) => { statuses.push(e); return { value: undefined } })
  await $.tool.call(input)
  expect(w.calls).toEqual([input])
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'route')).toHaveLength(0)
  expect(w.processes.find(p => (p.argv as string[])[2] === 'record-launch')).toMatchObject({ argv: ['kairo', 'team', 'record-launch', '--agent', 'kairo-codex', '--adapter', 'codex', '--model', 'agent-own'] })
  expect(await renderPane($)).not.toContain(expected)
  expect(statuses).toHaveLength(0)
})

for (const provider of ['gemini', 'opencode', 'opencode-go', 'opencode-zen', 'cursor']) test(`bypassed ${provider} bridge status does not show the Claude host model`, async ($, on) => {
  const statuses: unknown[] = []
  const input = { ...agent('[no-redirect]\nRole: Builder\nkairo-model: model-a'), subagent_type: `kairo-${provider}` }
  const w = world(on, undefined, undefined, async () => {
    expect(await renderPane($)).toContain(`Builder — model-a · ${provider}`)
  })
  on('ui.status', (_, e) => { statuses.push(e); return { value: undefined } })
  await $.tool.call(input)
  expect(w.calls).toEqual([input])
})

test('live fixed-agent status uses its own model rather than a different prompt model', async ($, on) => {
  const statuses: unknown[] = []
  const input = { ...agent('[no-redirect]\nRole: Builder\nkairo-model: gpt-6.1-terra'), subagent_type: 'team-builder-codex' }
  const w = world(on, undefined, undefined, async () => {
    expect(await renderPane($)).toContain('Builder — gpt-6.1-sol · codex')
  })
  defineAgent(on, 'team-builder-codex', 'gpt-6.1-sol')
  on('ui.status', (_, e) => { statuses.push(e); return { value: undefined } })
  await $.tool.call(input)
  expect(w.calls).toEqual([input])
})

test('live work shows in the pane, never in a band or status entry', async ($, on) => {
  const statuses: unknown[] = [];
  let visible = '';
  world(on, { decision: 'ROUTED', role: 'Explorer', provider: 'claude', targetAgent: 'team-explorer', targetModel: 'haiku' }, undefined, async () => {
    visible = await renderPane($);
  });
  on('ui.status', (_, e) => { statuses.push(e); return { value: undefined } });
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine band'] }));
  await $.tool.call({ ...agent(), subagent_type: 'team-explorer' });
  expect(visible).toContain('Explorer — haiku · claude');
  expect(statuses).toHaveLength(0);
  const idle = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', requestId: 'idle', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100, scroll: { offset: 0, bodyRows: 3 }, view: {} } });
  expect(JSON.stringify(idle)).not.toContain('Explorer — haiku · claude');
});

test('concurrent live status caps three workers and counts the rest', async ($, on) => {
  const statuses: unknown[] = [];
  const releases: Array<() => void> = [];
  let allStarted!: () => void;
  const started = new Promise<void>(resolve => { allStarted = resolve });
  world(on, { decision: 'ROUTED', role: 'Explorer', provider: 'claude', targetAgent: 'team-explorer', targetModel: 'haiku' }, undefined, () => new Promise<void>(resolve => {
    releases.push(resolve);
    if (releases.length === 4) allStarted();
  }));
  on('ui.status', (_, e) => { statuses.push(e); return { value: undefined } });
  const work = [1, 2, 3, 4].map(i => $.tool.call({ ...agent(String(i)), subagent_type: 'team-explorer' }));
  await started;
  const text = await renderPane($);
  expect(text.split('Explorer — haiku · claude').length - 1).toBe(4);
  expect(statuses).toHaveLength(0);
  for (const release of releases) release();
  await Promise.all(work);
  expect(await renderPane($)).not.toContain('haiku');
});

test('band stays hidden when every provider is healthy or watched and nothing is at 0%', () => {
  const snapshot = { ...pacingResponse, providers: {
    claude: { tier: 'HEALTHY', expectedDeadTimeMs: 0, windows: [{ name: '5h', remainingPercent: 80, resetsAt: '2026-10-23T14:00:00Z', expectedDeadTimeMs: 0, tier: 'HEALTHY' }] },
    codex: { tier: 'WATCH', expectedDeadTimeMs: 0, windows: [{ name: '5h', remainingPercent: 30, resetsAt: '2026-10-23T14:00:00Z', expectedDeadTimeMs: 0, tier: 'WATCH' }] },
  } }
  expect(pacingBand(snapshot)).toBeUndefined()
})

test('band names the provider window that runs out and where delegated work goes', () => {
  const snapshot = { generatedAt: '2026-10-23T12:00:00Z', nextWriter: 'team-builder-codex', providers: {
    claude: { tier: 'CONSERVE', expectedDeadTimeMs: 1_800_000, windows: [
      { name: 'week', remainingPercent: 70, resetsAt: '2026-10-28T17:00:00Z', expectedDeadTimeMs: 0, tier: 'HEALTHY' },
      { name: '5h', remainingPercent: 12, resetsAt: '2026-10-23T20:30:00Z', expectedDeadTimeMs: 1_800_000, tier: 'CONSERVE' }] },
    codex: { tier: 'HEALTHY', expectedDeadTimeMs: 0, windows: [{ name: '5h', remainingPercent: 90, resetsAt: '2026-10-23T15:00:00Z', expectedDeadTimeMs: 0, tier: 'HEALTHY' }] },
  } }
  const band = pacingBand(snapshot)!
  expect(band).toMatch(/^Claude 5h runs out before \d{1,2}:\d{2} [ap]m at this pace; delegated work moves to Codex until then$/)
  expect(band).not.toContain('Use claude now')
  expect(band).not.toContain('would sit unused')
})

test('band reports a provider at 0% with its reset and the other destination', () => {
  const snapshot = { generatedAt: '2026-10-23T21:15:00.000Z', nextWriter: 'team-builder', providers: {
    codex: { tier: 'CRITICAL', expectedDeadTimeMs: 5_700_000, windows: [
      { name: '5h', remainingPercent: 0, resetsAt: '2026-10-23T22:51:00.000Z', expectedDeadTimeMs: 5_700_000, tier: 'CRITICAL' }] },
    claude: { tier: 'HEALTHY', expectedDeadTimeMs: 0, windows: [{ name: '5h', remainingPercent: 95, resetsAt: '2026-10-24T02:00:00.000Z', expectedDeadTimeMs: 0, tier: 'HEALTHY' }] },
  } }
  const band = pacingBand(snapshot)!
  expect(band).toMatch(/^Codex 5h is at 0% until \d{1,2}:\d{2} [ap]m; delegated work goes to Claude$/)
  expect(band).not.toContain('Use codex now')
  expect(band).not.toContain('would sit unused')
})

// T35: explicit model, and failover on provider errors.
const mimoRoute = (targets: Record<string, number>) => ({
  decision: 'ROUTED', role: 'Builder', provider: 'opencode-go', targetAgent: null, targetModel: 'mimo-v2.6-pro',
  distribution: { applied: true, targets, deficits: targets },
})
const t35ClaudeRoute = { decision: 'ROUTED', role: 'Builder', provider: 'claude', targetAgent: 'team-builder', targetModel: 'haiku' }
const providerFailure = { isError: true, content: [{ type: 'text', text: '{"type":"error","error":{"name":"UnknownError","data":{"message":"Unexpected server error"}}}' }] }

function failoverWorld(on: On, results: unknown[], routes: { unforced: unknown, forced?: Record<string, unknown> }) {
  const calls: Array<Record<string, unknown>> = []
  const processes: string[][] = []
  const toasts: string[] = []
  mock.clock(on, { now: 1_700_000_000_000 })
  on('process.run', (_, e) => {
    { const checked = allowAgentCheck(e); if (checked) return checked }
    const argv = e.argv as string[]
    processes.push(argv)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', timedOut: false } })
    if (argv[2] === 'detect-exhaustion') return ok('null')
    if (argv[2] === 'route') {
      const at = argv.indexOf('--provider')
      return ok(JSON.stringify(at >= 0 ? routes.forced?.[argv[at + 1]] ?? { decision: 'ERROR' } : routes.unforced))
    }
    return ok('')
  })
  on('ui.toast', (_, e) => { toasts.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', async (_, e) => { const { tool_use_id, ...input } = e; calls.push(input); return { result: results[calls.length - 1] ?? {} } })
  return { calls, processes, toasts }
}

test('T35: an explicit model on the Agent call is kept when it is qualified for the role', async ($, on) => {
  const w = failoverWorld(on, [{}], { unforced: mimoRoute({ 'opencode-go/mimo-v2.6-pro': 0.2, 'claude/haiku': 0.1 }) })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.tool.call({ ...agent(), model: 'haiku' })
  expect(w.calls).toEqual([{ ...agent(), model: 'haiku' }])
  expect(w.processes.find(p => p[2] === 'record-launch')).toEqual(['kairo', 'team', 'record-launch', '--agent', 'team-builder', '--adapter', 'claude', '--model', 'haiku', '--cwd', '/tmp/project'])
})

test('T35: an explicit model that admission rejects for quota is overridden', async ($, on) => {
  const w = failoverWorld(on, [{}], { unforced: { ...mimoRoute({ 'opencode-go/mimo-v2.6-pro': 0.2, 'claude/sonnet': 0.1 }), admission: { candidates: [{ provider: 'claude', modelId: 'haiku', admitted: false }] } } })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.tool.call({ ...agent(), model: 'haiku' })
  expect(w.calls[0]).toMatchObject({ subagent_type: 'kairo-opencode-go' })
  expect(w.toasts).toHaveLength(0)
})

test('T35: a provider error fails over once to the next provider and ledgers both launches', async ($, on) => {
  const w = failoverWorld(on, [providerFailure, { content: [{ type: 'text', text: 'done' }] }], {
    unforced: mimoRoute({ 'opencode-go/mimo-v2.6-pro': 0.2, 'claude/haiku': 0.1 }),
    forced: { claude: t35ClaudeRoute },
  })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call({ ...agent(), model: undefined })
  expect(w.calls).toHaveLength(2)
  expect(w.calls[0]).toMatchObject({ subagent_type: 'kairo-opencode-go' })
  expect(w.calls[1]).toMatchObject({ subagent_type: 'team-builder', model: 'haiku' })
  expect(result.result).toEqual({ content: [{ type: 'text', text: 'done' }] })
  const failed = w.processes.find(p => p[2] === 'record-outcome' && p.includes('failed'))
  expect(failed).toEqual(expect.arrayContaining(['--adapter', 'opencode-go', '--model', 'mimo-v2.6-pro', '--reason']))
  expect(w.processes.filter(p => p[2] === 'record-launch')).toHaveLength(2)
})

test('T35: a second provider error is not failed over again, and a task failure is never retried', async ($, on) => {
  const twice = failoverWorld(on, [providerFailure, providerFailure], {
    unforced: mimoRoute({ 'opencode-go/mimo-v2.6-pro': 0.2, 'claude/haiku': 0.1 }), forced: { claude: t35ClaudeRoute },
  })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.tool.call({ ...agent(), model: undefined })
  expect(twice.calls).toHaveLength(2)
})

test('T35: a task failure reported by the agent is not retried', async ($, on) => {
  const w = failoverWorld(on, [{ isError: true, content: [{ type: 'text', text: 'blocked: 3 tests failing in parser.test.js' }] }], {
    unforced: mimoRoute({ 'opencode-go/mimo-v2.6-pro': 0.2, 'claude/haiku': 0.1 }), forced: { claude: t35ClaudeRoute },
  })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.tool.call({ ...agent(), model: undefined })
  expect(w.calls).toHaveLength(1)
})

// T31 unit B: Kairo versions of the hand-built agent enforcement, plan dispatch and CodeGraph context hooks.
function hookWorld(on: On, handlers: Record<string, () => unknown | Promise<unknown>>, planResult: Record<string, unknown> = {}) {
  const processes: Array<Record<string, unknown>> = [], calls: Array<Record<string, unknown>> = [], prompts: Array<Record<string, unknown>> = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    processes.push({ ...e })
    const run = handlers[(e.argv as string[])[2]]
    if (!run) return { value: { exitCode: 0, stdout: JSON.stringify({ decision: 'ROUTED', provider: 'claude', targetAgent: 'team-builder', targetModel: 'sonnet' }), stderr: '', timedOut: false } }
    return Promise.resolve(run()).then(value => ({ value: value as never }))
  })
  on('ui.toast', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => { prompts.push({ ...e }); return { text: e.text } })
  on('tool.call', (_, e) => { const { tool_use_id, ...input } = e; calls.push(input); return { result: planResult } })
  return { processes, calls, prompts }
}
const ok = (stdout: unknown, exitCode = 0) => ({ exitCode, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '', timedOut: false })
const generic = { tool: 'Agent', subagent_type: 'general-purpose', description: 'x', prompt: 'do it' } as const

test('a launch Kairo does not recognise is denied with the Kairo reason before any route or ledger call', async ($, on) => {
  const w = hookWorld(on, { 'check-agent': () => ok({ allowed: false, reason: 'Blocked subagent_type general-purpose' }) })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call(generic)
  expect(result.deny).toBe('Blocked subagent_type general-purpose')
  expect(w.calls).toEqual([])
  expect(w.processes).toHaveLength(1)
  expect(w.processes[0]).toMatchObject({ argv: ['kairo', 'team', 'check-agent', '--agent', 'general-purpose', '--cwd', '/tmp/project', '--json'] })
})

test('enforcement also applies to launches marked no-redirect', async ($, on) => {
  const w = hookWorld(on, { 'check-agent': () => ok({ allowed: false, reason: 'Blocked' }) })
  const result = await $.tool.call({ ...generic, prompt: 'retry [no-redirect]' })
  expect(result.deny).toBe('Blocked')
  expect(w.calls).toEqual([])
})

for (const [name, handler] of [
  ['allowed', () => ok({ allowed: true })],
  ['nonzero', () => ok('', 1)],
  ['malformed', () => ok('not json')],
  ['unusable verdict', () => ok({ ok: true })],
  ['timeout', () => ({ exitCode: null, stdout: '', stderr: '', timedOut: true })],
  ['throw', () => { throw new Error('kairo missing') }],
] as const) test(`agent enforcement lets the launch through when the check is ${name}`, async ($, on) => {
  const w = hookWorld(on, { 'check-agent': handler })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(w.calls).toHaveLength(1)
})

test('enforcement can be switched off', { options: { enforceAgents: false } }, async ($, on) => {
  const w = hookWorld(on, { 'check-agent': () => ok({ allowed: false, reason: 'Blocked' }) })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'check-agent')).toHaveLength(0)
})

test('gentle-ai actors are never checked', async ($, on) => {
  const w = hookWorld(on, { 'check-agent': () => ok({ allowed: false, reason: 'Blocked' }) })
  const result = await $.tool.call({ ...agent(), subagent_type: 'review-risk' })
  expect(result.deny).toBeUndefined()
  expect(w.processes).toHaveLength(0)
})

test('an approved plan adds the Kairo dispatch context and passes the plan to Kairo', async ($, on) => {
  const w = hookWorld(on, { dispatch: () => ok({ context: 'PLAN APPROVED. use my-builder', planPath: '/h/last-plan.md', saved: true }) })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call({ tool: 'ExitPlanMode', plan: '# Plan\n- one' } as never)
  expect(result.context).toEqual(['PLAN APPROVED. use my-builder'])
  const run = w.processes.find(p => (p.argv as string[])[2] === 'dispatch')!
  expect(run).toMatchObject({ argv: ['kairo', 'team', 'dispatch', '--cwd', '/tmp/project', '--json'], init: { stdin: '# Plan\n- one' } })
})

test('a refused plan gets no dispatch context', async ($, on) => {
  const w = hookWorld(on, { dispatch: () => ok({ context: 'PLAN APPROVED' }) }, { awaitingLeaderApproval: true })
  const result = await $.tool.call({ tool: 'ExitPlanMode', plan: '# Plan' } as never)
  expect(result.context ?? []).toEqual([])
  expect(w.processes).toHaveLength(0)
})

for (const [name, handler] of [['nonzero', () => ok('', 1)], ['malformed', () => ok('nope')], ['throw', () => { throw new Error('x') }]] as const) test(`dispatch failure (${name}) leaves the plan approval untouched`, async ($, on) => {
  hookWorld(on, { dispatch: handler })
  const result = await $.tool.call({ tool: 'ExitPlanMode', plan: '# Plan' } as never)
  expect(result.deny).toBeUndefined()
  expect(result.context ?? []).toEqual([])
})

test('relevant CodeGraph context is added after the other prompt context, with the prompt on stdin', async ($, on) => {
  const w = hookWorld(on, { 'prompt-context': () => ok('CodeGraph: routing\n- `route` (src/a.js:1) - 1 caller\nUse codegraph_explore for source and call flow.'), verdict: () => ok([]), pacing: () => ok(null) })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.prompt.submit({ text: 'how does routing work', context: ['existing'] })
  expect(w.prompts[0].context).toEqual(['existing', planTableContext, expect.stringContaining('CodeGraph: routing')])
  const run = w.processes.find(p => (p.argv as string[])[2] === 'prompt-context')!
  expect(run).toMatchObject({ argv: ['kairo', 'team', 'prompt-context', '--cwd', '/tmp/project'] })
  expect(JSON.parse((run.init as { stdin: string }).stdin)).toEqual({ prompt: 'how does routing work', cwd: '/tmp/project' })
})

for (const [name, handler] of [['empty', () => ok('')], ['nonzero', () => ok('CodeGraph: x', 1)], ['unrelated output', () => ok('[]')], ['throw', () => { throw new Error('x') }]] as const) test(`CodeGraph context (${name}) adds nothing`, async ($, on) => {
  const w = hookWorld(on, { 'prompt-context': handler, verdict: () => ok([]), pacing: () => ok(null) })
  await $.prompt.submit({ text: 'hello', context: ['existing'] })
  expect(w.prompts[0].context).toEqual(['existing', planTableContext])
})

test('CodeGraph context can be switched off', { options: { showCodeGraph: false } }, async ($, on) => {
  const w = hookWorld(on, { 'prompt-context': () => ok('CodeGraph: x'), verdict: () => ok([]), pacing: () => ok(null) })
  await $.prompt.submit({ text: 'hello', context: [] })
  expect(w.processes.filter(p => (p.argv as string[])[2] === 'prompt-context')).toHaveLength(0)
})
test('the prompt hook asks Kairo for non-blocking pacing and never refreshes quota itself', async ($, on) => {
  const processes: string[][] = []
  on('process.run', (_, e) => {
    const argv = e.argv as string[]; processes.push(argv)
    return { value: { exitCode: 0, stdout: JSON.stringify(argv[2] === 'pacing' ? pacingResponse : []), stderr: '', timedOut: false } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/tmp/project' })
  await $.prompt.submit({ text: 'continue' })
  expect(processes.filter(argv => argv[2] === 'pacing')).toEqual([['kairo', 'team', 'pacing', '--json', '--no-wait', '--cwd', '/tmp/project']])
  expect(processes.filter(argv => argv[2] === 'route')).toHaveLength(0)
})

test('main-session Edit over 20 lines is denied with the routed Builder model', async ($, on) => {
  const w = hookWorld(on, { route: () => ok({ decision: 'ROUTED', provider: 'codex', targetModel: 'gpt-5.6-terra' }) })
  await $.session.start({ cwd: '/tmp/project' })
  const result = await $.tool.call({ tool: 'Edit', file_path: '/tmp/a', old_string: 'old', new_string: Array(21).fill('x').join('\n') })
  expect(result.deny).toBe('Kairo: this inline edit changes 21 lines (limit 20). Delegate it to Builder, gpt-5.6-terra (codex).')
  expect(w.calls).toHaveLength(0)
  expect(w.processes[0]).toMatchObject({ argv: ['kairo', 'team', 'route', '--role', 'Builder', '--cwd', '/tmp/project', '--json', '--host', 'claude-code'], init: { timeoutMs: 2000 } })
})

test('main-session Edit of 20 lines is allowed without routing', async ($, on) => {
  const w = hookWorld(on, {})
  expect((await $.tool.call({ tool: 'Edit', file_path: '/tmp/a', old_string: 'old', new_string: Array(20).fill('x').join('\n') })).deny).toBeUndefined()
  expect(w.calls).toHaveLength(1)
  expect(w.processes).toHaveLength(0)
})

test('main-session Write of 21 lines is denied', async ($, on) => {
  const w = hookWorld(on, {})
  const result = await $.tool.call({ tool: 'Write', file_path: '/tmp/a', content: Array(21).fill('x').join('\n') })
  expect(result.deny).toBe('Kairo: this inline edit changes 21 lines (limit 20). Delegate it to Builder, sonnet (claude).')
  expect(w.calls).toHaveLength(0)
})

test('main-session Write of 20 lines ending in a newline is allowed', async ($, on) => {
  const w = hookWorld(on, {})
  expect((await $.tool.call({ tool: 'Write', file_path: '/tmp/a', content: 'x\n'.repeat(20) })).deny).toBeUndefined()
  expect(w.calls).toHaveLength(1)
  expect(w.processes).toHaveLength(0)
})

test('main-session MultiEdit sums changed lines across edits and denies over 20', async ($, on) => {
  const w = hookWorld(on, {})
  const result = await $.tool.call({ tool: 'MultiEdit', file_path: '/tmp/a', edits: [
    { old_string: 'old', new_string: Array(11).fill('x').join('\n') },
    { old_string: Array(10).fill('old').join('\n'), new_string: '' },
  ] })
  expect(result.deny).toBe('Kairo: this inline edit changes 21 lines (limit 20). Delegate it to Builder, sonnet (claude).')
  expect(w.calls).toHaveLength(0)
})

test('main-session Edit deleting 30 lines is denied', async ($, on) => {
  const w = hookWorld(on, {})
  const result = await $.tool.call({ tool: 'Edit', file_path: '/tmp/a', old_string: 'old\n'.repeat(30), new_string: '' })
  expect(result.deny).toBe('Kairo: this inline edit changes 30 lines (limit 20). Delegate it to Builder, sonnet (claude).')
  expect(w.calls).toHaveLength(0)
})

test('prompt no-redirect marker does not disable the inline edit block', async ($, on) => {
  const w = hookWorld(on, { verdict: () => ok([]), pacing: () => ok(null) })
  await $.prompt.submit({ text: '[no-redirect] continue' })
  const result = await $.tool.call({ tool: 'Edit', file_path: '/tmp/a', old_string: 'old', new_string: Array(21).fill('x').join('\n') })
  expect(result.deny).toBe('Kairo: this inline edit changes 21 lines (limit 20). Delegate it to Builder, sonnet (claude).')
  expect(w.calls).toHaveLength(0)
})

test('tool no-redirect marker does not disable the inline edit block', async ($, on) => {
  const w = hookWorld(on, {})
  const result = await $.tool.call({ tool: 'Edit', prompt: '[no-redirect]', file_path: '/tmp/a', old_string: 'old', new_string: Array(21).fill('x').join('\n') })
  expect(result.deny).toBe('Kairo: this inline edit changes 21 lines (limit 20). Delegate it to Builder, sonnet (claude).')
  expect(w.calls).toHaveLength(0)
})

test('main-session Write of an odd/tasks logbook is exempt from the inline edit block', async ($, on) => {
  const w = hookWorld(on, {})
  const content = Array(60).fill('x').join('\n')
  expect((await $.tool.call({ tool: 'Write', file_path: '/repo/odd/tasks/feature.md', content })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Write', file_path: '/repo/docs/odd/tasks-notes.md', content })).deny).toBeDefined()
  expect(w.calls).toHaveLength(1)
})

test('subagent Edit of 100 lines is allowed without routing', async ($, on) => {
  const w = hookWorld(on, {})
  expect((await $.tool.call({ tool: 'Edit', agentId: 'worker-1', file_path: '/tmp/a', old_string: 'old', new_string: Array(100).fill('x').join('\n') })).deny).toBeUndefined()
  expect(w.calls).toHaveLength(1)
  expect(w.processes).toHaveLength(0)
})

for (const [name, route] of [
  ['failure', () => ok('', 1)],
  ['malformed', () => ok('{')],
  ['timeout', () => ({ exitCode: null, stdout: '', stderr: '', timedOut: true })],
  ['invalid route', () => ok({ decision: 'ROUTED', provider: '', targetModel: '' })],
] as const) test(`large inline Edit still denies on route ${name}`, async ($, on) => {
  const w = hookWorld(on, { route })
  const result = await $.tool.call({ tool: 'Edit', file_path: '/tmp/a', old_string: 'old', new_string: Array(21).fill('x').join('\n') })
  expect(result.deny).toBe('Kairo: this inline edit changes 21 lines (limit 20). Delegate it to the Builder role (route unavailable).')
  expect(w.calls).toHaveLength(0)
})

test('prompt context requires a role and model dispatch table', async ($, on) => {
  const w = hookWorld(on, { verdict: () => ok([]), pacing: () => ok(null) })
  await $.prompt.submit({ text: 'implement the plan' })
  expect(JSON.stringify(w.prompts[0].context)).toContain('Step | Role | Model (provider) | Inline or delegated')
  expect(JSON.stringify(w.prompts[0].context)).toContain('kairo team route --role ROLE')
  expect(JSON.stringify(w.prompts[0].context)).toContain('Orchestrator (session model)')
})

test('pacing nextWriter does not rewrite a Kairo-routed Codex builder to Claude', async ($, on) => {
  const w = hookWorld(on, {
    pacing: () => ok({ ...pacingResponse, preferredProvider: 'claude', nextWriter: 'team-builder' }),
    route: () => ok({ decision: 'ROUTED', provider: 'codex', targetAgent: 'team-builder-codex', targetModel: 'gpt-6.1-sol' }),
    'check-agent': () => ok({ allowed: true }),
    'detect-exhaustion': () => ok(null),
  })
  await $.prompt.submit({ text: 'continue' })
  await $.tool.call({ ...agent(), subagent_type: 'team-builder-codex' })
  expect(w.calls[0].subagent_type).toBe('team-builder-codex')
  const routes = w.processes.filter(p => (p.argv as string[])[2] === 'route')
  expect(routes).toHaveLength(1)
  expect(routes[0].argv).not.toContain('--provider')
})

const t6Rows = [
  { role: 'Builder', provider: 'codex', modelId: 'gpt-a', displayName: 'GPT A', decision: 'ROUTED', waitUntil: null, why: '' },
  { role: 'Reviewer', provider: null, modelId: null, displayName: null, decision: 'WAIT', waitUntil: '2026-10-27T15:30:00Z', why: '' },
]
function t6World(on: On, getPlan: () => unknown) {
  const messages: string[] = []
  on('session.append', { door: 'note' }, async (_, e, next) => { messages.push((e.message.content[0] as { text: string }).text); return next(e) })
  const w = hookWorld(on, { routes: () => getPlan(), verdict: () => ok([]), pacing: () => ok(null), 'detect-exhaustion': () => ok(null) })
  return { ...w, messages }
}
test('T6: plan rows replace reminder and changed fingerprints produce one human notice', async ($, on) => {
  let fingerprint = 'one'
  const w = t6World(on, () => ok({ status: 'ok', rows: t6Rows, fingerprint }))
  await $.session.start({ cwd: '/tmp/project' })
  await $.prompt.submit({ text: 'one', context: ['existing'] })
  expect(w.processes).toContainEqual(expect.objectContaining({ argv: ['kairo', 'team', 'routes', '--json', '--cwd', '/tmp/project'] }))
  const context = (w.prompts[0].context as string[]).join('\n')
  expect(context).toContain('Role | Model (provider) | Now')
  expect(context).toContain('Builder | GPT A (codex) | routed')
  expect(context).toContain('Reviewer | unknown (unknown) | waiting until')
  expect(context).toContain('Orchestrator (session model)')
  expect(context).not.toContain('kairo team route --role ROLE')
  expect(w.messages).toHaveLength(1)
  expect(w.messages[0]).toContain('Builder | GPT A (codex) | routed')
  await $.prompt.submit({ text: 'two' })
  expect(w.messages).toHaveLength(1)
  fingerprint = 'two'
  await $.prompt.submit({ text: 'three' })
  expect(w.messages).toHaveLength(2)
  await $.session.start({ cwd: '/tmp/project' })
  await $.prompt.submit({ text: 'four' })
  expect(w.messages).toHaveLength(3)
})
test('T15c: plan table and pane notice mark non-independent routes', async ($, on) => {
  const rows = [{ ...t6Rows[0], role: 'Reviewer', why: 'Not provider-independent: codex also holds the Builder; independent providers unavailable until reset.' }]
  const w = t6World(on, () => ok({ status: 'ok', rows, fingerprint: 'non-independent' }))
  await $.prompt.submit({ text: 'continue' })
  expect((w.prompts[0].context as string[]).join('\n')).toContain('Reviewer | GPT A (codex) | routed (not independent)')
  expect(w.messages[0]).toContain('Reviewer | GPT A (codex) | routed (not independent)')
})
for (const [name, response] of [['failure', ok('', 1)], ['empty rows', ok({ status: 'ok', rows: [], fingerprint: 'x' })], ['timeout', { exitCode: null, stdout: '', stderr: '', timedOut: true }]] as const) test(`T6: plan ${name} preserves reminder`, async ($, on) => {
  const w = t6World(on, () => response)
  await $.prompt.submit({ text: 'continue' })
  expect(w.prompts[0].context).toEqual([planTableContext])
  expect(w.messages).toHaveLength(0)
})
test('T6: routed background delegation has start and finish notices', async ($, on) => {
  const messages: string[] = []
  on('session.append', { door: 'note' }, async (_, e, next) => { messages.push((e.message.content[0] as { text: string }).text); return next(e) })
  on('classic.SubagentStop', () => ({}))
  handoverWorld(on, { first: { status: 'async_launched', agentId: 't6-agent' }, initialRoute: { decision: 'ROUTED', role: 'Builder', provider: 'codex', targetAgent: 'team-builder-codex', targetModel: 'gpt-a', displayName: 'GPT A' } })
  await $.tool.call({ ...agent(), run_in_background: true })
  expect(messages).toEqual([expect.stringMatching(/Builder.*GPT A.*codex.*started/i)])
  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 't6-agent', agent_transcript_path: '/tmp/t6.jsonl', agent_type: 'team-builder-codex' })
  expect(messages).toEqual([expect.any(String), expect.stringMatching(/Builder.*GPT A.*codex.*finished/i)])
})

test('routing a disqualified explicit model does not emit a routing toast', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', role: 'Builder', provider: 'codex', targetAgent: 'team-builder-codex', targetModel: 'gpt-a', distribution: { targets: {} } })
  await $.tool.call(agent())
  expect(w.toasts).toEqual([])
})

// T6c: the spinner names the stage or the running delegated work instead of a decorative word.
function spinnerWorld(on: On, response: unknown = { decision: 'ROUTED', role: 'Builder', provider: 'codex', targetAgent: 'team-builder-codex', targetModel: 'gpt-6.1-sol' }, hold?: () => Promise<void>) {
  const seen: Array<Record<string, unknown>> = []
  on('process.run', (_, e) => {
    { const checked = allowAgentCheck(e); if (checked) return checked }
    const argv = e.argv as string[]
    return { value: { exitCode: 0, stdout: argv[2] === 'route' ? JSON.stringify(response) : argv[2] === 'detect-exhaustion' ? 'null' : '', stderr: '', timedOut: false } }
  })
  on('ui.render', (_, e) => { if (e.component === 'Spinner') seen.push({ ...(e.props as Record<string, unknown>) }); return { type: 'Text', props: {}, children: ['spinner'] } })
  on('ui.toast', () => ({ value: undefined }))
  on('session.append', { door: 'note' }, (_, e, next) => next(e))
  on('tool.call', async () => { await hold?.(); return { result: {} } })
  return seen
}
const spin = ($: any, props: Record<string, unknown>) => $.ui.render({ component: 'Spinner', surface: 'terminal', requestId: 'spin', props: { word: 'Schlepping', message: null, suffix: '…', mode: 'responding', ...props } })

test('T6c: spinner names role, model and provider of one running delegation', async ($, on) => {
  let during: Record<string, unknown> | undefined
  const seen = spinnerWorld(on, undefined, async () => { await spin($, {}); during = seen.at(-1) })
  await $.tool.call(agent())
  expect(during).toMatchObject({ message: 'Builder · gpt-6.1-sol (codex)' })
})

test('T6c: spinner shows the first running delegation plus +N for the rest', async ($, on) => {
  let during: Record<string, unknown> | undefined
  let depth = 0
  const seen = spinnerWorld(on, undefined, async () => {
    if (depth++ === 0) { await $.tool.call(agent()); return }
    await spin($, {}); during = seen.at(-1)
  })
  await $.tool.call(agent())
  expect(during).toMatchObject({ message: 'Builder · gpt-6.1-sol (codex) +1' })
})

for (const [mode, stage] of [['thinking', 'Thinking'], ['requesting', 'Waiting for the model'], ['responding', 'Writing the answer'], ['tool-input', 'Preparing a tool call'], ['tool-use', 'Running a tool']] as const) test(`T6c: idle spinner in ${mode} mode names the stage`, async ($, on) => {
  const seen = spinnerWorld(on)
  await spin($, { mode })
  expect(seen.at(-1)).toMatchObject({ message: stage })
})

test('T6c: spinner fails open on an unknown mode', async ($, on) => {
  const seen = spinnerWorld(on)
  await spin($, { mode: 'mystery' })
  expect(seen.at(-1)).toMatchObject({ word: 'Schlepping', message: null, mode: 'mystery' })
})

test('explicit opus survives active Claude pacing redirect', async ($, on) => {
  const w = pacingWorld(on, 'claude', 'opus')
  await $.prompt.submit({ text: 'continue' })
  await $.tool.call({ ...agent(), model: 'opus' })
  expect(w.calls[0].model).toBe('opus')
})

test('agent-own launch records the model from the launched agent definition', async ($, on) => {
  const w = world(on)
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.read', (_, e) => {
    if (e.path === '/home/u/.claude/agents/team-builder-codex.md') return { value: '---\nname: team-builder-codex\nmodel: haiku\n---\nRun `codex exec -m gpt-new`.\n' }
    throw new Error('not found')
  })
  await $.tool.call({ ...agent('[no-redirect]'), subagent_type: 'team-builder-codex' })
  expect(w.processes.find(p => (p.argv as string[])[2] === 'record-launch')).toMatchObject({ argv: expect.arrayContaining(['--model', 'gpt-new']) })
})

test('explicit unqualified Claude model remains selected when admission does not reject it', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', role: 'Builder', provider: 'codex', targetAgent: 'team-builder-codex', targetModel: 'gpt-a', distribution: { targets: { 'codex/gpt-a': 1 } }, admission: { candidates: [{ provider: 'claude', modelId: 'haiku', admitted: true }] } })
  await $.tool.call({ ...agent(), model: 'haiku' })
  expect(w.calls[0]).toMatchObject({ subagent_type: 'team-builder', model: 'haiku' })
})

test('a project-local agent definition is read before the user one', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'codex', targetAgent: null, targetModel: 'gpt-6-astra' })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.read', (_, e) => {
    if (e.path === '/tmp/project/.claude/agents/team-builder-codex.md') return { value: '---\nname: team-builder-codex\nmodel: haiku\n---\nRun `codex exec -m gpt-6.1-sol`.\n' }
    throw new Error('not found')
  })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.tool.call({ ...agent(), subagent_type: 'team-builder-codex' })
  expect(w.calls[0]).toMatchObject({ subagent_type: 'kairo-codex', prompt: 'kairo-model: gpt-6-astra\nbuild it' })
})

test('an unreadable Codex agent definition never implies model compatibility', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'codex', targetAgent: null, targetModel: 'gpt-6-astra' })
  await $.tool.call({ ...agent(), subagent_type: 'team-builder-codex' })
  expect(w.calls[0]).toMatchObject({ subagent_type: 'kairo-codex' })
})

test('a codex exec command continued over lines still yields the worker model, never the frontmatter model', async ($, on) => {
  const w = world(on)
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.read', (_, e) => {
    if (e.path === '/home/u/.claude/agents/team-builder-codex.md') return { value: '---\nname: team-builder-codex\nmodel: haiku\n---\nRun:\ncodex exec \\\n  -m gpt-6.1-sol \\\n  -\n' }
    if (e.path === '/home/u/.claude/agents/team-researcher-codex.md') return { value: '---\nname: team-researcher-codex\nmodel: haiku\n---\nNo worker here.\n' }
    throw new Error('not found')
  })
  await $.tool.call({ ...agent('[no-redirect]'), subagent_type: 'team-builder-codex' })
  await $.tool.call({ ...agent('[no-redirect]'), subagent_type: 'team-researcher-codex' })
  const launches = w.processes.filter(p => (p.argv as string[])[2] === 'record-launch').map(p => (p.argv as string[]).at(-1))
  expect(launches).toEqual(['gpt-6.1-sol', 'agent-own'])
})

const MSGS = [{ role: 'user', text: 'hi', toolUses: [] }]
// Automatic checkpoint triggers: fire-and-forget spawns of `kairo checkpoint`, never a change to the host action.
function checkpointWorld(on: On, toolResult: Record<string, unknown> = { result: { stdout: '', stderr: '' } }, spawnMode: 'ok' | 'fails' | 'pending' = 'ok', deny = false) {
  const spawns: string[][] = []
  const runs: string[][] = []
  mock.clock(on, { now: 1_700_000_000_000 })
  on('process.run', (_, e) => {
    if (deny && (e.argv as string[])[2] === 'check-agent') return { value: { exitCode: 0, stdout: '{"allowed":false,"reason":"Blocked"}', stderr: '', timedOut: false } }
    { const checked = allowAgentCheck(e); if (checked) return checked }
    runs.push([...(e.argv as string[])])
    return { value: { exitCode: 1, stdout: '', stderr: '', timedOut: false } }
  })
  on('process.spawn', async function* (_, e) {
    spawns.push([...(e.argv as string[])])
    if (spawnMode === 'fails') throw new Error('spawn unavailable')
    if (spawnMode === 'pending') await new Promise(() => {})
    return { value: { code: 0, signal: null } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => toolResult as never)
  on('session.compact', () => ({ messages: MSGS }))
  const checkpoints = () => spawns.filter(argv => argv[1] === 'checkpoint')
  return { spawns, runs, checkpoints }
}

test('a successful git commit starts kairo checkpoint with the commit trigger', async ($, on) => {
  const w = checkpointWorld(on)
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' } as never)
  expect(result.deny).toBeUndefined()
  expect(w.checkpoints()).toEqual([['kairo', 'checkpoint', '--trigger', 'commit', '--command', 'git commit -m "feat: x"', '--json', '--cwd', '/tmp/project']])
})

test('a commit tool error still defers to the CLI, which decides by HEAD', async ($, on) => {
  const w = checkpointWorld(on, { result: { stdout: '', stderr: 'x' }, isError: true })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call({ tool: 'Bash', command: 'git commit -m "feat: x"' } as never)
  expect(result.isError).toBe(true)
  expect(w.checkpoints()).toHaveLength(1)
})

test('a denied Agent launch never starts a checkpoint', async ($, on) => {
  const w = checkpointWorld(on, { result: {} }, 'ok', true)
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call({ tool: 'Agent', subagent_type: 'general-purpose', description: 'x', prompt: 'x' } as never)
  expect(result.deny).toBe('Blocked')
  expect(w.checkpoints()).toEqual([])
})

test('128 rapid launches with a stalled checkpoint child leave at most one pending spawn', async ($, on) => {
  const w = checkpointWorld(on, { result: {} }, 'pending')
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  for (let i = 0; i < 128; i += 1) await $.tool.call({ tool: 'Agent', subagent_type: 'claude-code-guide', description: 'x', prompt: 'x' } as never)
  expect(w.checkpoints()).toHaveLength(1)
})

test('a non-commit Bash command never starts a checkpoint', async ($, on) => {
  const w = checkpointWorld(on)
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  expect(w.checkpoints()).toEqual([])
})

test('an Agent launch starts a checkpoint without waiting for it', async ($, on) => {
  const w = checkpointWorld(on, { result: {} }, 'pending')
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call({ tool: 'Agent', subagent_type: 'claude-code-guide', description: 'x', prompt: 'x' } as never)
  expect(result.deny).toBeUndefined()
  expect(w.checkpoints()).toHaveLength(1)
  expect(w.runs.filter(argv => argv[1] === 'checkpoint')).toEqual([])
})

// Assisted close: after a commit checkpoint the mod asks Kairo for the stable-point decision and shows one toast.
const TRIGGER_RESULT = { trigger: 'commit', written: true, clean: true, taskType: 'feature', feature: 'f', head: 'abc1234' }
function suggestWorld(on: On, opts: { trigger?: unknown, usage?: unknown, decision?: unknown, decideFails?: boolean, usageFails?: boolean, toastFails?: boolean, slowDecision?: boolean } = {}) {
  const decides: Array<{ argv: string[], stdin?: string }> = []
  const toasts: string[] = []
  mock.clock(on, { now: 1_700_000_000_000 })
  on('process.run', (_, e) => {
    { const checked = allowAgentCheck(e); if (checked) return checked }
    if ((e.argv as string[])[1] === 'checkpoint') {
      decides.push({ argv: [...(e.argv as string[])], stdin: (e as { init?: { stdin?: string } }).init?.stdin })
      if (opts.decideFails) throw new Error('decide unavailable')
      if (opts.slowDecision) return new Promise(resolve => setTimeout(() => resolve({ value: { exitCode: 0, stdout: '{"suggest":false}', stderr: '', timedOut: false } }), 300))
      return { value: { exitCode: 0, stdout: JSON.stringify(opts.decision ?? { suggest: true, message: 'Delivery closed and checkpoint saved (context 47%). Start a fresh session: run kairo continue in a new terminal, or /kairo-continue.' }), stderr: '', timedOut: false } }
    }
    return { value: { exitCode: 1, stdout: '', stderr: '', timedOut: false } }
  })
  on('session.usage', () => {
    if (opts.usageFails) throw new Error('usage unavailable')
    return { value: (opts.usage ?? { context: { percent: 47 } }) as never }
  })
  on('ui.toast', (_, e) => { if (opts.toastFails) throw new Error('toast unavailable'); toasts.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '' } }) as never)
  const checkpoints: string[] = []
  on('process.spawn', async function* (_, e) {
    const argv = e.argv as string[]
    if (argv[1] === 'checkpoint') { checkpoints.push(argv[3]); if (argv[3] === 'commit') yield { stream: 'stdout', text: JSON.stringify(opts.trigger ?? TRIGGER_RESULT) + '\n' } }
    return { value: { code: 0, signal: null } }
  })
  return { decides, toasts, checkpoints }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 50))
const commitCall = { tool: 'Bash', command: 'git commit -m "feat: x"' } as never

test('a commit with a suggest result shows one toast and sends the context fill to the decision', async ($, on) => {
  const w = suggestWorld(on)
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.tool.call(commitCall)
  await settle()
  expect(w.toasts).toEqual(['Delivery closed and checkpoint saved (context 47%). Start a fresh session: run kairo continue in a new terminal, or /kairo-continue.'])
  expect(w.decides[0].argv).toEqual(['kairo', 'checkpoint', '--decide', '--cwd', '/tmp/project'])
  expect(JSON.parse(w.decides[0].stdin!)).toEqual({ ...TRIGGER_RESULT, contextPercent: 47 })
})

test('the same HEAD twice shows one toast', async ($, on) => {
  const w = suggestWorld(on)
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.tool.call(commitCall)
  await settle()
  await $.tool.call(commitCall)
  await settle()
  expect(w.toasts).toHaveLength(1)
})

test('a no-suggest result shows nothing', async ($, on) => {
  const w = suggestWorld(on, { decision: { suggest: false, reason: 'below the threshold' } })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.tool.call(commitCall)
  await settle()
  expect(w.toasts).toEqual([])
})

for (const [name, trigger] of [['a dirty tree', { ...TRIGGER_RESULT, clean: false }], ['a small task', { ...TRIGGER_RESULT, taskType: 'small' }], ['no new checkpoint', { ...TRIGGER_RESULT, written: false }]] as const) {
  test(`${name} never reaches the decision`, async ($, on) => {
    const w = suggestWorld(on, { trigger })
    await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
    await $.tool.call(commitCall)
    await settle()
    expect(w.decides).toEqual([])
    expect(w.toasts).toEqual([])
  })
}

test('the commit tool result is unchanged by the suggestion', async ($, on) => {
  suggestWorld(on)
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call(commitCall)
  expect(result.deny).toBeUndefined()
  expect(result.result).toEqual({ stdout: 'ok', stderr: '' })
})

test('a throwing toast neither throws nor changes the result (that HEAD loses its suggestion)', async ($, on) => {
  suggestWorld(on, { toastFails: true })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call(commitCall)
  await settle()
  expect(result.deny).toBeUndefined()
  expect(result.result).toEqual({ stdout: 'ok', stderr: '' })
})

test('a delegate trigger arriving while the decision is pending still spawns its checkpoint', async ($, on) => {
  const w = suggestWorld(on, { slowDecision: true })
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.tool.call(commitCall)
  await new Promise(resolve => setTimeout(resolve, 30))
  await $.tool.call({ tool: 'Agent', subagent_type: 'claude-code-guide', description: 'x', prompt: 'x' } as never)
  await settle()
  expect(w.checkpoints).toEqual(['commit', 'delegate'])
})

for (const [name, opts] of [['usage fails', { usageFails: true }], ['the decision fails', { decideFails: true }], ['usage has no percent', { usage: {} }], ['the decision is malformed', { decision: 'nope' }]] as const) {
  test(`the hook never throws when ${name}`, async ($, on) => {
    const w = suggestWorld(on, opts)
    await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
    const result = await $.tool.call(commitCall)
    await settle()
    expect(result.deny).toBeUndefined()
    expect(w.toasts).toEqual([])
  })
}

for (const trigger of ['auto', 'manual'] as const) {
  test(`${trigger} compaction starts a checkpoint`, async ($, on) => {
    const w = checkpointWorld(on)
    await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
    await ($.session.compact as any)({ trigger, messages: MSGS })
    expect(w.checkpoints().map(argv => argv[3])).toEqual(['compact'])
  })
}

test('precompute and subagent compactions never start a checkpoint', async ($, on) => {
  const w = checkpointWorld(on)
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await ($.session.compact as any)({ trigger: 'precompute', messages: MSGS })
  await ($.session.compact as any)({ trigger: 'auto', agentId: 'sub-1', messages: MSGS })
  expect(w.checkpoints()).toEqual([])
})

test('a failing checkpoint never changes the tool result or the compaction', async ($, on) => {
  const w = checkpointWorld(on, { result: { stdout: 'ok', stderr: '' } }, 'fails')
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call({ tool: 'Bash', command: 'git commit -m x' } as never)
  expect(result.result).toEqual({ stdout: 'ok', stderr: '' })
  expect(result.deny).toBeUndefined()
  const compacted = await ($.session.compact as any)({ trigger: 'auto', messages: MSGS })
  expect(compacted.skip).toBeUndefined()
  expect(w.checkpoints().length).toBeGreaterThan(0)
})

test('pacing context labels the Claude session window 5h like Codex', () => {
  const window = (name: string, remainingPercent: number) => ({ name, remainingPercent, resetsAt: '2026-10-23T14:00:00Z', expectedDeadTimeMs: 0 })
  const snapshot = { ...pacingResponse, providers: { ...pacingResponse.providers,
    claude: { tier: 'HEALTHY', expectedDeadTimeMs: 0, windows: [window('Current session', 80), window('Current week (all models)', 60)] } } }
  const context = pacingContext(snapshot)
  expect(context).toContain('claude: 5h 80%')
  expect(context).toContain(', week 60%')
  expect(context).not.toContain('Current session')
})
