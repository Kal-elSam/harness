import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import { staleLoadWarning } from './register'

const installed = (version: string) => JSON.stringify({ version: 2, plugins: { 'kairo-router@kairo': [{ scope: 'user', version }] } })

function world(on: On, loaded: string, installedText: string | Error) {
  const statuses: Array<string | undefined> = [], prompts: Array<{ context?: readonly string[] }> = []
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.read', (_, e) => {
    if (String(e.path).endsWith('/.claude-plugin/plugin.json')) return { value: JSON.stringify({ name: 'kairo-router', version: loaded }) }
    if (e.path === '/home/u/.claude/plugins/installed_plugins.json') {
      if (installedText instanceof Error) throw installedText
      return { value: installedText }
    }
    throw new Error(`unexpected read ${e.path}`)
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', timedOut: false } }))
  on('ui.status', (_, e) => { statuses.push(e.text); return { value: undefined } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => { prompts.push({ ...e }); return { text: e.text } })
  return { statuses, prompts }
}

test('warns when the loaded version differs from the installed one', () => {
  expect(staleLoadWarning('0.2.1', installed('0.3.1'))).toBe('kairo-router 0.2.1 loaded, 0.3.1 installed: restart Claude Code')
})

test('stays quiet when versions match or install data is missing or invalid', () => {
  expect(staleLoadWarning('0.3.1', installed('0.3.1'))).toBeUndefined()
  expect(staleLoadWarning('0.3.1', undefined)).toBeUndefined()
  expect(staleLoadWarning('0.3.1', 'not json')).toBeUndefined()
  expect(staleLoadWarning(undefined, installed('0.3.1'))).toBeUndefined()
})

test('a prompt shows the restart warning in the status line and the model context', async ($, on) => {
  const w = world(on, '0.2.1', installed('0.3.1'))
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.prompt.submit({ text: 'hi' })
  expect(w.statuses.at(-1)).toBe('kairo-router 0.2.1 loaded, 0.3.1 installed: restart Claude Code')
  expect(w.prompts.at(-1)?.context ?? []).toContain('kairo-router 0.2.1 loaded, 0.3.1 installed: restart Claude Code')
})

test('a prompt keeps the ordinary status when versions match or the read fails', async ($, on) => {
  const w = world(on, '0.3.1', new Error('ENOENT'))
  await $.session.start({ cwd: '/tmp/project', surface: null, isInteractive: false })
  await $.prompt.submit({ text: 'hi' })
  expect(w.statuses.at(-1)).toBeUndefined()
  expect(w.prompts.at(-1)?.context ?? []).not.toContain(expect.stringContaining('restart Claude Code'))
})
