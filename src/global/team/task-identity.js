import { assertTaskId } from '../architect/architect-types.js';
import { readTaskRecord } from '../architect/architect-store.js';

// Only objects resolved in this process can carry a trusted status into a trace.
const resolved = new WeakSet();
export const isResolvedTaskIdentity = identity => resolved.has(identity);
export const validExecutionId = id => typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;

// Internal callers may bind a real run id (including Architect's run_* ids).
// External execution ids are validated at their CLI/append boundary instead.
export function bindTaskExecution(identity, executionId) {
  if (!isResolvedTaskIdentity(identity)) return null;
  const bound = Object.freeze({ ...identity, executionId });
  resolved.add(bound);
  return bound;
}

export async function resolveTaskIdentity(projectRoot, rawId, deps = {}) {
  let taskIdStatus = 'absent';
  if (rawId !== undefined && rawId !== null) {
    try {
      assertTaskId(rawId);
      taskIdStatus = 'not_found';
    } catch { taskIdStatus = 'invalid'; }
    if (taskIdStatus !== 'invalid') {
      try { taskIdStatus = await (deps.readTaskRecord ?? readTaskRecord)(projectRoot, rawId) ? 'linked' : 'not_found'; }
      catch { taskIdStatus = 'unreadable'; }
    }
  }
  const identity = Object.freeze({ taskId: taskIdStatus === 'linked' ? rawId : null, taskIdStatus });
  resolved.add(identity);
  return identity;
}

export function extractTaskMarker(text) {
  const ids = new Set(typeof text === 'string' ? [...text.matchAll(/^Kairo-Task-Id: ([^\s]+)\r?$/gm)].map(match => match[1]) : []);
  // A deliberately invalid sentinel cannot impersonate an Architect id.
  return ids.size > 1 ? 'invalid:multiple-task-markers' : ids.values().next().value ?? null;
}
