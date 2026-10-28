// OpenCode v2 plugin logic for advisory quota pacing. The generated plugin file stays thin and imports this module.
import { readPacingContext } from './pacing-context.js';

// Inside OpenCode, process.execPath is the opencode binary, so the generated plugin passes the Node path.
export function createKairoPacingSetup({ nodePath, readContext = readPacingContext, maxSessions = 50 } = {}) {
  const cache = new Map(); // sessionID -> latest text; insertion order drives oldest-first eviction
  const inflight = new Map(); // sessionID -> pending refresh

  function store(sessionID, text) {
    cache.delete(sessionID);
    if (!text) return;
    cache.set(sessionID, text);
    while (cache.size > maxSessions) cache.delete(cache.keys().next().value);
  }

  return async function setup(ctx) {
    const cwd = () => {
      const directory = ctx?.location?.directory;
      return typeof directory === 'string' && directory.trim() ? directory : process.cwd();
    };
    await ctx.session.hook('prompt', async event => {
      try {
        const sessionID = event?.sessionID;
        if (typeof sessionID !== 'string' || !sessionID) return;
        if (!inflight.has(sessionID)) {
          const refresh = (async () => {
            try {
              const text = await readContext({ cwd: cwd(), host: 'opencode', ...(nodePath ? { execPath: nodePath } : {}) });
              store(sessionID, typeof text === 'string' && text.trim() ? text : null);
            } catch { store(sessionID, null); }
          })().finally(() => inflight.delete(sessionID));
          inflight.set(sessionID, refresh);
        }
        await inflight.get(sessionID);
      } catch { /* Pacing must never block a prompt. */ }
    });
    await ctx.session.hook('context', async event => {
      try {
        const text = cache.get(event?.sessionID);
        if (text && Array.isArray(event.system)) event.system.push({ type: 'text', text });
      } catch { /* Fail open: no injection. */ }
    });
  };
}
