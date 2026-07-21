import { open as fsOpen, rename as fsRename, unlink as fsUnlink } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

function defaultTempPath(targetPath) {
  const id = randomBytes(8).toString("hex");
  return join(
    dirname(targetPath),
    `.${basename(targetPath)}.${process.pid}.${id}.tmp`
  );
}

/**
 * Atomically replace targetPath with pretty-printed JSON.
 * Creates a unique temp in the same directory (O_EXCL), writes + fsync,
 * renames over the destination, and deletes the temp on any failure.
 */
export async function writeAtomicJson(targetPath, value, deps = {}) {
  const open = deps.open ?? fsOpen;
  const rename = deps.rename ?? fsRename;
  const unlink = deps.unlink ?? fsUnlink;
  const createTempPath = deps.createTempPath ?? defaultTempPath;

  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const tempPath = createTempPath(targetPath);
  let handle;

  try {
    handle = await open(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, targetPath);
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Best-effort close before temp cleanup.
      }
    }
    try {
      await unlink(tempPath);
    } catch {
      // Temp may not exist yet or already renamed.
    }
    throw error;
  }
}
