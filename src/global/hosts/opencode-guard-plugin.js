import { guardRole, guardToolCall } from './codex-guard-hook.js';

/** OpenCode v2: throw from tool.execute.before before the tool runs. */
export function createKairoGuardSetup({ nodePath, run } = {}) {
  return async function setup(ctx) {
    await ctx.tool.hook('execute.before', async event => {
      // The host's session metadata, not tool input, establishes primary status.
      // A failed lookup denies; a primary session can never impersonate a Builder.
      let session;
      try { session = await ctx.session.get({ sessionID: event.sessionID }); }
      catch { throw new Error('Kairo team guard denied: session identity unavailable'); }
      if (!session || session.id !== event.sessionID) throw new Error('Kairo team guard denied: invalid session identity');
      const role = session.parentID ? guardRole(event.agent) : undefined;
      const decision = guardToolCall({ host: 'opencode', role, tool: event.tool, input: event.input }, {
        nodePath, run, cwd: ctx.location?.directory,
      });
      if (!decision.allow) throw new Error(`Kairo team guard denied: ${decision.reason}`);
    });
  };
}
