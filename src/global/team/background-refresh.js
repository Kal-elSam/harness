// Host-agnostic background refresh of routing inputs. Any CLI host whose hook
// cannot wait for a provider probe asks pacing with --no-wait; this starts the
// refresh detached so the next read finds fresh quota.
import { spawn } from 'node:child_process';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routingInputCachePath } from './routing-input-cache.js';

const LOCK_MS = 60_000;
const kairoBin = fileURLToPath(new URL('../../../bin/kairo.js', import.meta.url));

function lockPath(homeDir, projectRoot) {
  return join(dirname(routingInputCachePath(homeDir, projectRoot)), 'routing-refresh.lock');
}

/** Starts at most one detached `kairo team route --refresh` per project per minute. Never throws. */
export async function startBackgroundRefresh({ homeDir, projectRoot }, deps = {}) {
  const now = (deps.now ?? Date.now)();
  const path = lockPath(homeDir, projectRoot);
  try {
    const startedAt = Number(await readFile(path, 'utf8').catch(() => NaN));
    if (Number.isFinite(startedAt) && startedAt <= now && now - startedAt <= LOCK_MS) return false;
    await mkdir(dirname(path), { recursive: true });
    await unlink(path).catch(() => {});
    // `wx` lets only one of two racing hosts take the lock.
    await writeFile(path, String(now), { flag: 'wx' });
  } catch { return false; }
  try {
    const child = (deps.spawnImpl ?? spawn)(process.execPath, [kairoBin, 'team', 'route', '--refresh', '--cwd', projectRoot], {
      detached: true, stdio: 'ignore',
    });
    child.unref();
    return true;
  } catch {
    await unlink(path).catch(() => {});
    return false;
  }
}
