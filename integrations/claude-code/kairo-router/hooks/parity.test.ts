import { expect, test } from 'claude-code/testing'
import { decidePacingRewrite, inlineWriteHint, pacingContext } from './register'

// Frozen reference-rule fixtures from team-pacing/hooks/pacing.ts (2026-10-23).
// Keep this oracle independent of Kairo implementation and machine-local paths.
const status = (tier: string, dead: number) => ({ tier, expectedDeadTimeMs: dead, windows: [] })
const fixtures = [
  { claude: status('CRITICAL', 40), codex: status('CRITICAL', 0), nextWriter: 'team-builder-codex', agent: 'team-builder', model: 'opus', prompt: 'build', expected: { subagent_type: 'team-builder-codex' } },
  { claude: status('HEALTHY', 0), codex: status('CONSERVE', 5), nextWriter: 'team-builder', agent: 'team-builder-codex', model: 'opus', prompt: 'build', expected: { subagent_type: 'team-builder' } },
  { claude: status('CONSERVE', 5), codex: status('WATCH', 0), nextWriter: 'team-builder-codex', agent: 'team-researcher', model: 'opus', prompt: 'research', expected: { subagent_type: 'team-researcher-codex' } },
  { claude: status('CONSERVE', 5), codex: status('WATCH', 0), nextWriter: 'team-builder-codex', agent: 'team-builder', model: 'opus', prompt: '[no-redirect] build', expected: {} },
  { claude: status('CONSERVE', 5), codex: status('WATCH', 0), nextWriter: 'team-builder-codex', agent: 'team-explorer', model: 'opus', prompt: 'map', expected: { model: 'sonnet' } },
] as const
for (const [i, f] of fixtures.entries()) test(`reference rewrite parity ${i}`, () => {
  expect(decidePacingRewrite({ subagent_type: f.agent, model: f.model, prompt: f.prompt }, { providers: { claude: f.claude, codex: f.codex }, nextWriter: f.nextWriter, writerCounts: { claude: 0, codex: 0 } })).toEqual(f.expected)
})
for (const name of ['review-risk', 'review-resilience', 'review-readability', 'review-reliability', 'review-refuter', 'jd-judge-a', 'jd-judge-b', 'jd-fix-agent']) test(`gentle actor stays untouched: ${name}`, () => {
  expect(decidePacingRewrite({ subagent_type: name, model: 'opus' }, { providers: { claude: status('CRITICAL', 5), codex: status('HEALTHY', 0) }, nextWriter: 'team-builder-codex' })).toEqual({})
})
test('reference inline nudge threshold and tier parity', () => {
  for (const claude of ['HEALTHY', 'WATCH', 'CONSERVE', 'CRITICAL']) for (const codex of ['HEALTHY', 'WATCH', 'CONSERVE', 'CRITICAL']) for (const lines of [20, 21]) {
    const expected = ['CONSERVE', 'CRITICAL'].includes(claude) && ['HEALTHY', 'WATCH'].includes(codex) && lines > 20
    expect(Boolean(inlineWriteHint({ providers: { claude: status(claude, 0), codex: status(codex, 0) } }, 'Write', { content: Array(lines).fill('x').join('\n') }))).toBe(expected)
  }
})

// Reference's final writer-share rule applies only after availability ties.
for (const [agent, counts, expected] of [
  ['team-builder', { claude: 7, codex: 3 }, { subagent_type: 'team-builder-codex' }],
  ['team-builder', { claude: 6, codex: 4 }, {}],
  ['team-builder-codex', { claude: 3, codex: 7 }, { subagent_type: 'team-builder' }],
  ['team-researcher', { claude: 7, codex: 3 }, {}],
] as const) test(`reference tied-availability share rule ${agent} ${counts.claude}`, () => {
  expect(decidePacingRewrite({ subagent_type: agent, model: 'sonnet' }, { providers: { claude: status('WATCH', 0), codex: status('WATCH', 0) }, preferredProvider: null, nextWriter: 'team-builder-codex', writerCounts: counts })).toEqual(expected)
})


// The Node CLI test reads this JSON block too: one reference fixture set across
// the plugin's enforced module boundary, without importing application code.
const writerChoiceFixtures = /* writer-choice-fixtures:start */
[
  { "claude": ["CRITICAL", 40, 1, -0.5], "codex": ["CRITICAL", 0, 100, -0.5], "counts": { "claude": 0, "codex": 0 }, "preferred": "codex", "writer": "team-builder-codex" },
  { "claude": ["CONSERVE", 0, 50, 0.1], "codex": ["WATCH", 0, 50, 0.1], "counts": { "claude": 0, "codex": 0 }, "preferred": "codex", "writer": "team-builder-codex" },
  { "claude": ["WATCH", 0, 20, 0.1], "codex": ["WATCH", 0, 80, 0.1], "counts": { "claude": 0, "codex": 0 }, "preferred": "codex", "writer": "team-builder-codex" },
  { "claude": ["WATCH", 0, null, 0.2], "codex": ["WATCH", 0, null, 0.1], "counts": { "claude": 0, "codex": 0 }, "preferred": "claude", "writer": "team-builder" },
  { "claude": ["WATCH", 0, null, 0.2], "codex": ["WATCH", 0, null, 0.2], "counts": { "claude": 7, "codex": 3 }, "preferred": null, "writer": "team-builder-codex" }
]
/* writer-choice-fixtures:end */
const choiceStatus = (values: (string | number | null)[]) => ({ tier: values[0] as string, expectedDeadTimeMs: values[1] as number,
  windows: [{ name: '5h', remainingPercent: 50, resetsAt: '2026-10-23T14:00:00Z', resetsInMs: 1000, exhaustionInMs: values[2], projectedRemaining: values[3] }],
})
for (const [i, f] of writerChoiceFixtures.entries()) test(`same-fixture reference writer choice and plugin decision ${i}`, () => {
  const pacing = { providers: { claude: choiceStatus(f.claude), codex: choiceStatus(f.codex) }, preferredProvider: f.preferred, nextWriter: f.writer, writerCounts: f.counts }
  expect(pacingContext(pacing)).toContain(`next writer ${f.writer}`)
  const input = { subagent_type: 'team-builder', model: 'sonnet' }
  expect(decidePacingRewrite(input, pacing).subagent_type ?? input.subagent_type).toBe(f.writer)
})
