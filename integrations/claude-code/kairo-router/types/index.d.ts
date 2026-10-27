export type PaneState = {
  quota: string[]
  plan: string[]
  running: string[]
  verdicts: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'kairo-router': { pane: Shaped<PaneState> }
  }
}
