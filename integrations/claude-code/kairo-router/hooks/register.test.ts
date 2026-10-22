import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

function world(on: On, response: unknown = { decision: 'ROUTED', provider: 'codex', targetAgent: 'team-builder-codex', targetModel: 'gpt-a' }, failure?: string) {
  const calls: Array<Record<string, unknown>> = []
  const processes: Array<Record<string, unknown>> = []
  const toasts: string[] = []
  mock.clock(on, { now: 1_700_000_000_000 })
  on('process.run', (_, e) => {
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
  on('tool.call', (_, e) => { const { tool_use_id, ...input } = e; calls.push(input); return { result: {} } })
  return { calls, processes, toasts }
}
const agent = (prompt = 'build it') => ({ tool: 'Agent', subagent_type: 'team-builder', description: 'build', prompt, model: 'opus' }) as const

test('routes to the Codex agent without setting a non-Claude model', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  const result = await $.tool.call(agent())
  expect(result.deny).toBeUndefined()
  expect(w.calls).toEqual([{ ...agent(), subagent_type: 'team-builder-codex' }])
  expect(w.processes).toHaveLength(4)
  expect(w.processes[0]).toMatchObject({ argv: ['kairo', 'team', 'route', '--agent', 'team-builder', '--cwd', '/tmp/project', '--json'], init: { timeoutMs: 2000 } })
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

for (const prompt of ['retry [no-redirect]', 'retry [please no-redirect here]']) test(`bracket marker bypasses lookup: ${prompt}`, async ($, on) => {
  const w = world(on)
  expect((await $.tool.call(agent(prompt))).deny).toBeUndefined()
  expect(w.calls).toEqual([agent(prompt)])
  expect(w.processes).toHaveLength(0)
  expect(w.toasts).toHaveLength(0)
})

test('missing provider variant passes through unchanged', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'codex', targetAgent: null, targetModel: 'gpt-a' })
  expect((await $.tool.call(agent())).deny).toBeUndefined()
  expect(w.calls).toEqual([agent()])
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

test('does not record a route with no launchable provider variant', async ($, on) => {
  const w = world(on, { decision: 'ROUTED', provider: 'codex', targetAgent: null, targetModel: 'gpt-a' })
  await $.tool.call(agent())
  expect(w.processes).toHaveLength(1)
})


const codexRoute = { decision: 'ROUTED', provider: 'codex', targetAgent: 'team-builder-codex', targetModel: 'gpt-a' }
const claudeRoute = { decision: 'ROUTED', provider: 'claude', targetAgent: 'team-builder', targetModel: 'sonnet' }
const exhaustedResult = { content: [{ type: 'text', text: 'You have hit your usage limit. Please try again later.' }], exitCode: 1 }

function handoverWorld(on: On, options: {
  reroute?: unknown,
  first?: unknown,
  second?: unknown,
  recordFailure?: string,
  rerouteFailure?: string,
  detectionFailure?: string,
} = {}) {
  const calls: Array<Record<string, unknown>> = []
  const processes: Array<Record<string, unknown>> = []
  const toasts: string[] = []
  let routes = 0
  let exhaustedRecorded = false
  on('process.run', async (_, e) => {
    processes.push({ ...e })
    const argv = e.argv as string[]
    if (argv[2] === 'detect-exhaustion') {
      if (options.detectionFailure === 'throw') throw new Error('detector failed')
      if (options.detectionFailure === 'malformed') return { value: { exitCode: 0, stdout: '{}', stderr: '', timedOut: false } }
      const isExhausted = calls.length === 1 ? options.first === undefined : options.second === exhaustedResult
      const provider = argv[argv.indexOf('--adapter') + 1]
      return { value: { exitCode: 0, stdout: JSON.stringify(isExhausted ? { provider, reason: 'usage limit exhausted' } : null), stderr: '', timedOut: false } }
    }
    if (argv[2] === 'record-outcome') {
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
    return { value: { exitCode: 0, stdout: JSON.stringify(routes === 1 ? codexRoute : options.reroute ?? claudeRoute), stderr: '', timedOut: false } }
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
  expect(routes[1]).toMatchObject({ argv: ['kairo', 'team', 'route', '--agent', 'team-builder', '--cwd', '/tmp/project', '--json'] })
  const outcomes = w.processes.filter(p => (p.argv as string[])[2] === 'record-outcome')
  expect(outcomes).toHaveLength(2)
  expect(outcomes[0].argv).toContain('exhausted')
  expect(outcomes[1].argv).toContain('completed')
  expect(outcomes[1].argv).toContain('claude')
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('codex')
  expect(w.toasts[0]).toContain('claude')
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
  expect(w.toasts).toHaveLength(1)
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
