import { expect, test } from 'claude-code/testing'

const pane = { plugin: 'kairo-router', component: 'Pane', requestId: 'kairo', surface: 'desktop', props: { title: 'Kairo', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } } as const

test('pane renders unavailable sources without blocking the prompt', async ($, on) => {
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', timedOut: false } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/project', surface: null, isInteractive: false })
  await $.prompt.submit({ text: 'hello' })
  const ui = await $.ui.mount(pane)
  expect((await ui.find({ type: 'Text', text: /Quota: unavailable/ }))?.text).toContain('unavailable')
  expect((await ui.find({ type: 'Text', text: /Plan: unavailable/ }))?.text).toContain('unavailable')
  expect((await ui.find({ type: 'Text', text: /Verdicts: unavailable/ }))?.text).toContain('unavailable')
  await ui.unmount()
})

test('pane displays quota, plan, running work and pending verdicts', async ($, on) => {
  on('process.run', (_, e) => {
    const cmd = (e.argv as string[])[2]
    const value = cmd === 'pacing' ? { ok: true, stale: true, generatedAt: '2026-01-01T00:00:00Z', preferredProvider: null, nextWriter: null, providers: { claude: { tier: 'HEALTHY', expectedDeadTimeMs: null, windows: [{ name: 'week', remainingPercent: 75, resetsAt: '2026-01-02T00:00:00Z' }] }, codex: { tier: null, expectedDeadTimeMs: null, windows: [] } } } : cmd === 'routes' ? { fingerprint: 'a', rows: [{ role: 'Builder', provider: 'codex', modelId: 'gpt-a', displayName: 'GPT A', decision: 'ROUTED' }] } : cmd === 'verdict' ? [{ agent: 'team-builder' }] : {}
    return { value: { exitCode: 0, stdout: JSON.stringify(value), stderr: '', timedOut: false } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.session.start({ cwd: '/project', surface: null, isInteractive: false })
  await $.prompt.submit({ text: 'hello' })
  const ui = await $.ui.mount(pane)
  expect((await ui.find({ type: 'Text', text: /claude.*75%.*stale/i }))?.text).toContain('resets')
  expect((await ui.find({ type: 'Text', text: /Builder.*GPT A.*codex/ }))?.text).toContain('Builder')
  expect((await ui.find({ type: 'Text', text: /Running: none/ }))?.text).toContain('none')
  expect((await ui.find({ type: 'Text', text: /Verdicts: 1.*team-builder/ }))?.text).toContain('team-builder')
  await ui.unmount()
})

test('pane refreshes when a delegation finishes', async ($, on) => {
  let release!: () => void
  let started!: () => void
  const running = new Promise<void>(resolve => { started = resolve })
  const wait = new Promise<void>(resolve => { release = resolve })
  on('process.run', (_, e) => {
    const command = (e.argv as string[])[2]
    const value = command === 'check-agent' ? { allowed: true } : command === 'route'
      ? { decision: 'ROUTED', role: 'Builder', provider: 'claude', targetAgent: 'team-builder', targetModel: 'sonnet' }
      : command === 'detect-exhaustion' ? null : []
    return { value: { exitCode: 0, stdout: JSON.stringify(value), stderr: '', timedOut: false } }
  })
  on('tool.call', async () => { started(); await wait; return { result: {} } })
  const ui = await $.ui.mount(pane)
  const work = $.tool.call({ tool: 'Agent', subagent_type: 'team-builder', description: 'build', prompt: 'build' })
  await running
  expect((await ui.find({ type: 'Text', text: /Builder.*sonnet.*claude/ }))?.text).toContain('Builder')
  release()
  await work
  expect((await ui.find({ type: 'Text', text: /Running: none/ }))?.text).toContain('none')
  await ui.unmount()
})

test('a source that fails after a successful refresh becomes unavailable', async ($, on) => {
  let failed = false
  on('process.run', (_, e) => {
    const command = (e.argv as string[])[2]
    if (failed && command === 'verdict') return { value: { exitCode: 1, stdout: '', stderr: 'unavailable', timedOut: false } }
    return { value: { exitCode: 0, stdout: JSON.stringify(command === 'verdict' ? [{ agent: 'team-builder' }] : {}), stderr: '', timedOut: false } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  await $.prompt.submit({ text: 'first' })
  const ui = await $.ui.mount(pane)
  expect((await ui.find({ type: 'Text', text: /Verdicts: 1.*team-builder/ }))?.text).toContain('team-builder')
  failed = true
  await $.prompt.submit({ text: 'second' })
  expect((await ui.find({ type: 'Text', text: /Verdicts: unavailable/ }))?.text).toContain('unavailable')
  await ui.unmount()
})
