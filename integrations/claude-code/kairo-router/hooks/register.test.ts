import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

function world(on: On, response: unknown = { decision: 'ROUTED', provider: 'codex', targetAgent: 'team-builder-codex', targetModel: 'gpt-a' }, failure?: string) {
  const calls: Array<Record<string, unknown>> = []
  const processes: Array<Record<string, unknown>> = []
  const toasts: string[] = []
  mock.clock(on, { now: 1_700_000_000_000 })
  on('process.run', (_, e) => {
    processes.push({ ...e })
    if ((e.argv as string[])[2] === 'record-launch') {
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
  expect(w.processes).toHaveLength(2)
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
