import {
  open as fsOpen, rename as fsRename, unlink as fsUnlink, link as fsLink
} from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

function defaultTempPath(targetPath) {
  return join(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  );
}

async function bestEffort(fn) {
  try { await fn(); } catch { /* ignore */ }
}

/**
 * Atomic JSON write. Default rename-replace; createExclusive uses link (EEXIST).
 * link/rename are commit points; post-commit temp cleanup is best-effort.
 */
export async function writeAtomicJson(targetPath, value, deps = {}) {
  const open = deps.open ?? fsOpen;
  const rename = deps.rename ?? fsRename;
  const unlink = deps.unlink ?? fsUnlink;
  const link = deps.link ?? fsLink;
  const createTempPath = deps.createTempPath ?? defaultTempPath;
  const createExclusive = deps.createExclusive === true;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const tempPath = createTempPath(targetPath);
  let handle;
  let committed = false;

  try {
    handle = await open(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (createExclusive) {
      await link(tempPath, targetPath);
      committed = true;
      await bestEffort(() => unlink(tempPath));
    } else {
      await rename(tempPath, targetPath);
      committed = true;
    }
  } catch (error) {
    if (committed) return;
    if (handle) await bestEffort(() => handle.close());
    await bestEffort(() => unlink(tempPath));
    throw error;
  }
}
