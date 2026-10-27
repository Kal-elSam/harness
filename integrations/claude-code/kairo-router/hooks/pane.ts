import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'
import type { PaneState } from '../types'

export const PANE = 'kairo'
// Change the tag when a field changes: it declines what an earlier version stored.
const state = atom({ plugin: 'kairo-router', key: 'pane' } as const, { quota: [], plan: [], running: [], verdicts: null } as PaneState, { shape: 'pane-1' })

// A function patch reads live sources when the update applies, so concurrent
// updates never write back a snapshot taken before another one landed.
export async function setPane($: EngineInterface, patch: Partial<PaneState> | (() => Partial<PaneState>)) {
  try { await update($, state, current => ({ ...current, ...(typeof patch === 'function' ? patch() : patch) })) } catch { /* Display failures cannot interrupt work. */ }
}

export function registerPane(on: On) {
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const data = await read($, state)
    const rows = [
      ...(data.quota.length ? data.quota : ['Quota: unavailable']),
      ...(data.plan.length ? data.plan : ['Plan: unavailable']),
      ...(data.running.length ? ['Running:', ...data.running] : ['Running: none']),
      data.verdicts ?? 'Verdicts: unavailable',
    ]
    return { type: 'Box', props: { flexDirection: 'column' }, children: rows.map(text => ({ type: 'Text', props: {}, children: [text] })) }
  })
}
