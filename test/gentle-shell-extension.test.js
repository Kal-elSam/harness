import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import register, { MODEL_ROUTES_READ_EVENT, MODEL_SELECTION_EVENT, readModelRouteSnapshots } from '../src/global/hosts/gentle-shell-extension.js';

const row = (agent, model = 'openai/example') => ({ agent, model, thinking: 'high', source: 'binding', inherited: false, state: 'resolved' });
const snapshot = (kind, routes = [row(kind === 'ordinary' ? 'gentle-ai-worker' : 'review-risk')], sessionId = 'session-a') => ({
  schema: 'gentle-shell.model-routes/v1', kind, sessionId, routes,
  ...(kind === 'ordinary' ? { errors: [] } : {})
});

test('the package declares its shipped Pi extension without adding a runtime SDK dependency', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(pkg.pi?.extensions, ['./src/global/hosts/gentle-shell-extension.js']);
  assert.ok(pkg.files.includes('src'));
  assert.equal(pkg.dependencies['@earendil-works/pi-coding-agent'], undefined);
});

const liveKeys = f => [...f.statuses].filter(([, v]) => v !== undefined).map(([k]) => k).sort();
const panelText = f => liveKeys(f).map(k => f.statuses.get(k)).join('\n');
const noSnapshot = { buildSnapshot: async () => null };

function fixture(respond) {
  const hooks = new Map();
  const widgets = new Map();
  const statuses = new Map();
  let sessionId = 'session-a';
  let cwd = '/project';
  const requests = [];
  const listeners = new Map();
  const pi = {
    on(name, handler) { hooks.set(name, handler); },
    events: { on(name, handler) { listeners.set(name, handler); return () => listeners.delete(name); },
      emit(name, request) {
      assert.equal(name, MODEL_ROUTES_READ_EVENT);
      requests.push(request);
      respond?.(request);
    } }
  };
  const ctx = { hasUI: true, sessionManager: { getSessionId: () => sessionId, getCwd: () => cwd },
    ui: { setWidget: (key, value) => widgets.set(key, value), setStatus: (key, value) => statuses.set(key, value) } };
  return { pi, ctx, hooks, listeners, widgets, statuses, requests, switchSession(id) { sessionId = id; }, switchRoot(root) { cwd = root; } };
}

test('fresh request preserves ordinary/reviewer provenance without mutating host snapshots', () => {
  const ordinary = snapshot('ordinary');
  const review = snapshot('review');
  const before = JSON.stringify([ordinary, review]);
  const f = fixture(request => { request.respond(ordinary); request.respond(review); });
  const result = readModelRouteSnapshots(f.pi, f.ctx);
  assert.equal(result.state, 'available');
  assert.equal(result.ordinary.routes[0].source, 'binding');
  assert.equal(result.review.routes[0].agent, 'review-risk');
  assert.equal(JSON.stringify([ordinary, review]), before);
  ordinary.routes[0].model = 'changed-after-read';
  assert.equal(result.ordinary.routes[0].model, 'openai/example');
  assert.equal(f.requests[0].sessionId, 'session-a');
  assert.equal(f.requests[0].cwd, '/project');
});

for (const invalid of [
  { ...snapshot('ordinary'), schema: 'unsupported' },
  snapshot('ordinary', [row('worker')], 'other-session'),
  snapshot('ordinary', [row('worker'), row('worker')]),
  snapshot('ordinary', [{ ...row('worker'), inherited: true }]),
  snapshot('ordinary', [row('unsafe\nagent')])
]) {
  test(`invalid host snapshot is unavailable: ${JSON.stringify(invalid)}`, () => {
    const f = fixture(request => request.respond(invalid));
    const result = readModelRouteSnapshots(f.pi, f.ctx);
    assert.equal(result.state, 'unavailable');
    assert.equal(result.ordinary, null);
  });
}

test('duplicate and late replies never become current assignment authority', async () => {
  let late;
  const f = fixture(request => {
    request.respond(snapshot('ordinary'));
    request.respond(snapshot('ordinary'));
    late = request.respond;
  });
  const result = readModelRouteSnapshots(f.pi, f.ctx);
  assert.equal(result.state, 'unavailable');
  await Promise.resolve();
  late(snapshot('review'));
  assert.equal(result.review, null);
});

test('session or root changes during a read discard all replies', () => {
  for (const change of [f => f.switchSession('new-session'), f => f.switchRoot('/other-project')]) {
    const f = fixture(request => { request.respond(snapshot('ordinary')); change(f); });
    assert.equal(readModelRouteSnapshots(f.pi, f.ctx).state, 'unavailable');
  }
});

test('context and widget show informational inherited/unconfigured states, never stale routes', async () => {
  let available = true;
  const f = fixture(request => {
    if (!available) return;
    request.respond(snapshot('ordinary', [{ agent: 'gentle-ai-worker', model: null, thinking: null, source: 'inherit', inherited: true, state: 'inherited-unobserved' }]));
    request.respond(snapshot('review', [{ ...row('review-risk', null), source: 'session-profile', state: 'unconfigured' }]));
  });
  register(f.pi, {}, noSnapshot);
  const event = { systemPrompt: 'Keep existing instructions.' };
  const result = await f.hooks.get('before_agent_start')(event, f.ctx);
  assert.match(result.message.content, /informational/i);
  assert.match(result.message.content, /inherited-unobserved/);
  assert.match(result.message.content, /unconfigured/);
  assert.equal(result.message.display, false);
  assert.equal(result.systemPrompt, undefined);
  assert.equal(event.systemPrompt, 'Keep existing instructions.');
  assert.match(panelText(f), /worker · inherit \(no-snapshot\)/);
  available = false;
  const next = await f.hooks.get('before_agent_start')(event, f.ctx);
  assert.match(next.message.content, /unavailable/);
  assert.doesNotMatch(next.message.content, /gentle-ai-worker/);
  assert.equal(f.requests.length, 2);
  f.hooks.get('session_shutdown')({}, f.ctx);
  assert.equal(f.widgets.get('kairo-team'), undefined);
  assert.deepEqual(liveKeys(f), []);
});

test('missing host, partial discovery and headless UI remain non-authoritative', async () => {
  const f = fixture(request => request.respond({ ...snapshot('ordinary'), errors: ['private/path: discovery failure'] }));
  assert.equal(readModelRouteSnapshots(f.pi, f.ctx).state, 'partial');
  f.ctx.hasUI = false;
  register(f.pi, {}, noSnapshot);
  const result = await f.hooks.get('before_agent_start')({}, f.ctx);
  assert.match(result.message.content, /partial/);
  assert.doesNotMatch(result.message.content, /private\/path/);
  assert.equal(f.widgets.size, 0);
  assert.equal(readModelRouteSnapshots({ events: { emit() { throw new Error('unavailable'); } } }, f.ctx).state, 'unavailable');
});

test('child sessions do not install the Kairo team extension', () => {
  const f = fixture();
  register(f.pi, { GENTLE_PI_AGENTS_CHILD: '1' });
  assert.equal(f.hooks.size, 0);
});

const selectionSnapshot = { roles: { Builder: { candidates: [{ provider: 'openai', modelId: 'gpt-a', admitted: true }] } }, agents: { 'gentle-ai-worker': 'Builder' } };
async function armed() {
  const f = fixture();
  f.ctx.modelRegistry = { getAll: () => [{ provider: 'openai', id: 'gpt-a' }] };
  register(f.pi, {}, { buildSnapshot: async () => selectionSnapshot });
  await f.hooks.get('before_agent_start')({}, f.ctx);
  const ask = (overrides = {}) => {
    const answers = [];
    f.listeners.get(MODEL_SELECTION_EVENT)?.({ sessionId: 'session-a', cwd: '/project', agent: 'gentle-ai-worker', model: null, source: null,
      respond: value => answers.push(value), ...overrides });
    return answers;
  };
  return { f, ask };
}

test('selection listener answers synchronously for the matching session and cwd', async () => {
  const { ask } = await armed();
  assert.deepEqual(ask(), [{ model: 'openai/gpt-a' }]);
});

test('selection listener ignores a stale session or cwd', async () => {
  const { ask } = await armed();
  assert.deepEqual(ask({ sessionId: 'old' }), []);
  assert.deepEqual(ask({ cwd: '/other' }), []);
});

test('selection listener stays silent without a snapshot', async () => {
  const f = fixture();
  register(f.pi, {}, noSnapshot);
  await f.hooks.get('before_agent_start')({}, f.ctx);
  const answers = [];
  f.listeners.get(MODEL_SELECTION_EVENT)({ sessionId: 'session-a', cwd: '/project', agent: 'gentle-ai-worker', model: null, source: null, respond: v => answers.push(v) });
  assert.deepEqual(answers, []);
});

test('selection listener unsubscribes on shutdown', async () => {
  const { f } = await armed();
  assert.ok(f.listeners.has(MODEL_SELECTION_EVENT));
  f.hooks.get('session_shutdown')({}, f.ctx);
  assert.equal(f.listeners.has(MODEL_SELECTION_EVENT), false);
});

test('judges sharing a provider add a table line while the assignment table is unchanged', async () => {
  const f = fixture();
  f.ctx.modelRegistry = { getAll: () => [{ provider: 'openai', id: 'gpt-a' }] };
  const snap = { roles: { Reviewer: { candidates: [{ provider: 'openai', modelId: 'gpt-a', admitted: true }] } }, agents: {} };
  register(f.pi, {}, { buildSnapshot: async () => snap });
  const result = await f.hooks.get('before_agent_start')({}, f.ctx);
  assert.match(result.message.content, /same provider/);
  assert.match(result.message.content, /assignment snapshot/);
});

test('session_start shows the panel and arms the selector without any prompt', async () => {
  const f = fixture(request => request.respond(snapshot('ordinary')));
  f.ctx.modelRegistry = { getAll: () => [{ provider: 'openai', id: 'gpt-a' }] };
  register(f.pi, {}, { buildSnapshot: async () => selectionSnapshot });
  await f.hooks.get('session_start')({ type: 'session_start', reason: 'startup' }, f.ctx);
  assert.equal(f.widgets.get('kairo-team'), undefined);
  assert.match(f.statuses.get('kairo-team-00'), /^─ Kairo · team \(partial\) ─$/);
  assert.equal(f.statuses.get('kairo-team-01'), '› worker · manual example');
  const answers = [];
  f.listeners.get(MODEL_SELECTION_EVENT)({ sessionId: 'session-a', cwd: '/project', agent: 'gentle-ai-worker', model: null, source: null, respond: v => answers.push(v) });
  assert.deepEqual(answers, [{ model: 'openai/gpt-a' }]);
});

test('session_start never throws when the UI or snapshot build fails', async () => {
  const f = fixture();
  f.ctx.ui.setWidget = () => { throw new Error('ui'); };
  register(f.pi, {}, { buildSnapshot: async () => { throw new Error('boom'); } });
  await assert.doesNotReject(async () => f.hooks.get('session_start')({}, f.ctx));
});

test('before_agent_start still returns the hidden context message after session_start', async () => {
  const f = fixture(request => request.respond(snapshot('ordinary')));
  register(f.pi, {}, noSnapshot);
  await f.hooks.get('session_start')({}, f.ctx);
  const result = await f.hooks.get('before_agent_start')({}, f.ctx);
  assert.equal(result.message.customType, 'kairo.gentle-shell-team');
  assert.equal(result.message.display, false);
  assert.match(result.message.content, /assignment snapshot/);
  assert.match(panelText(f), /worker/);
});

const hostRow = (agent, model, source) => ({ agent, model, thinking: null, source, inherited: model === null, state: model === null ? 'inherited-unobserved' : 'resolved' });
const fullSnapshot = { roles: { Builder: { candidates: [{ provider: 'openai', modelId: 'gpt-a', admitted: true }] },
  Reviewer: { candidates: [{ provider: 'openai', modelId: 'gpt-a', admitted: true }, { provider: 'anthropic', modelId: 'opus', admitted: true }] } },
  agents: { 'gentle-ai-worker': 'Builder', 'gentle-ai-verify': 'Reviewer' } };
const registry = [{ provider: 'openai', id: 'gpt-a' }, { provider: 'anthropic', id: 'opus' }];

test('panel publishes ordered single-line statuses with the decision, reasons and manual markers', async () => {
  const f = fixture(request => {
    if (request.respond) {
      request.respond(snapshot('ordinary', [hostRow('gentle-ai-worker', null, 'inherit'), hostRow('gentle-ai-verify', 'openai/pinned', 'binding'), hostRow('gentle-ai-mystery', null, 'inherit')]));
      request.respond(snapshot('review'));
    }
  });
  f.ctx.modelRegistry = { getAll: () => registry };
  register(f.pi, {}, { buildSnapshot: async () => fullSnapshot });
  await f.hooks.get('session_start')({}, f.ctx);
  const keys = liveKeys(f);
  assert.equal(keys[0], 'kairo-team-00');
  const lines = keys.map(k => f.statuses.get(k));
  assert.equal(lines[0], '─ Kairo · team (available) ─');
  assert.ok(lines.slice(1).every(l => l.startsWith('› ')));
  assert.ok(lines.every(l => !/[\n\t]/.test(l)));
  assert.ok(lines.includes('› worker → gpt-a'));
  assert.ok(lines.includes('› verify · manual pinned'));
  assert.ok(lines.includes('› mystery · inherit (unknown-agent)'));
  assert.ok(lines.includes('› jd-judge-a → gpt-a'));
  assert.ok(lines.includes('› review lenses · gentle-ai'));
  assert.equal(f.widgets.get('kairo-team'), undefined);
  assert.equal(f.statuses.get('kairo-team'), undefined);
});

test('the panel routes from the authenticated registry when unauthenticated providers repeat a model id', async () => {
  const f = fixture(request => { if (request.respond) request.respond(snapshot('ordinary', [hostRow('gentle-ai-worker', null, 'inherit')])); });
  f.ctx.modelRegistry = {
    getAll: () => [...registry, { provider: 'openrouter', id: 'gpt-a' }, { provider: 'openrouter', id: 'opus' }],
    getAvailable: () => registry,
  };
  register(f.pi, {}, { buildSnapshot: async () => fullSnapshot });
  await f.hooks.get('session_start')({}, f.ctx);
  const lines = liveKeys(f).map(k => f.statuses.get(k));
  assert.ok(lines.includes('› worker → gpt-a'));
  assert.ok(lines.includes('› jd-judge-b → opus'));
});

test('refresh with fewer agents clears stale keys and shutdown clears all', async () => {
  let routes = [hostRow('gentle-ai-worker', null, 'inherit'), hostRow('gentle-ai-a', null, 'inherit'), hostRow('gentle-ai-b', null, 'inherit')];
  const f = fixture(request => request.respond(snapshot('ordinary', routes)));
  register(f.pi, {}, noSnapshot);
  await f.hooks.get('session_start')({}, f.ctx);
  const before = liveKeys(f).length;
  routes = [hostRow('gentle-ai-worker', null, 'inherit')];
  await f.hooks.get('before_agent_start')({}, f.ctx);
  assert.equal(liveKeys(f).length, before - 2);
  f.hooks.get('session_shutdown')({}, f.ctx);
  assert.deepEqual(liveKeys(f), []);
});

test('panel is capped with a more line', async () => {
  const routes = Array.from({ length: 15 }, (_, i) => hostRow(`gentle-ai-x${i}`, null, 'inherit'));
  const f = fixture(request => request.respond(snapshot('ordinary', routes)));
  register(f.pi, {}, noSnapshot);
  await f.hooks.get('session_start')({}, f.ctx);
  const keys = liveKeys(f);
  assert.equal(keys.length, 10);
  assert.match(f.statuses.get(keys.at(-1)), /^› … \+\d+ more$/);
});

test('hidden message shows the Kairo decision beside the host assignment', async () => {
  const f = fixture(request => request.respond(snapshot('ordinary', [hostRow('gentle-ai-worker', null, 'inherit')])));
  f.ctx.modelRegistry = { getAll: () => registry };
  register(f.pi, {}, { buildSnapshot: async () => fullSnapshot });
  const result = await f.hooks.get('before_agent_start')({}, f.ctx);
  assert.match(result.message.content, /\| gentle-ai-worker \| Inherited \(unobserved\) \| openai\/gpt-a \|/);
});
