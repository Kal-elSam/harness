// Host-agnostic background refresh of routing inputs. Any CLI host whose hook
// cannot wait for a provider probe asks pacing with --no-wait; this starts the
// refresh detached so the next read finds fresh quota.
import { spawn } from 'node:child_process';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routingInputCachePath } from './routing-input-cache.js';

const LOCK_MS = 60_000;
const LOCK_FILE = /^routing-refresh-(\d+)\.lock$/;
const kairoBin = fileURLToPath(new URL('../../../bin/kairo.js', import.meta.url));

// One lock file per minute: creating it with `wx` admits exactly one host, and
// nobody ever deletes a lock another host may own, so racing reclaims cannot happen.
async function acquireLock(dir, bucket) {
  const path = join(dir, `routing-refresh-${bucket}.lock`);
  await mkdir(dir, { recursive: true });
  try { await writeFile(path, '', { flag: 'wx' }); } catch { return null; }
  for (const name of await readdir(dir).catch(() => [])) {
    const old = LOCK_FILE.exec(name);
    if (old && Number(old[1]) < bucket) await unlink(join(dir, name)).catch(() => {});
  }
  return path;
}

/** Starts at most one detached `kairo team route --refresh` per project per minute. Never throws. */
export async function startBackgroundRefresh({ homeDir, projectRoot }, deps = {}) {
  const bucket = Math.floor((deps.now ?? Date.now)() / LOCK_MS);
  let lock;
  try { lock = await acquireLock(dirname(routingInputCachePath(homeDir, projectRoot)), bucket); }
  catch { return false; }
  if (!lock) return false;
  const release = () => unlink(lock).catch(() => {});
  try {
    const child = (deps.spawnImpl ?? spawn)(process.execPath, [kairoBin, 'team', 'route', '--refresh', '--cwd', projectRoot], {
      detached: true, stdio: 'ignore',
    });
    // Spawn failures such as EAGAIN arrive as an event, not a throw.
    child.once?.('error', release);
    child.unref();
    return true;
  } catch {
    await release();
    return false;
  }
}
