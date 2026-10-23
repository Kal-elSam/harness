import { readFile, copyFile, lstat } from "node:fs/promises";
import { constants } from "node:fs";

/** Returns { symlink: true } for any symlink (even dangling), else file text or null. */
export async function readIfExists(path) {
  try {
    if ((await lstat(path)).isSymbolicLink()) return { symlink: true };
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Exclusive, collision-safe backup: `<path>.kairo-backup.<stamp>[-n]`. Returns the backup path. */
export async function backupExclusive(path, stamp) {
  for (let n = 0; ; n++) {
    const target = `${path}.kairo-backup.${stamp}${n === 0 ? "" : `-${n}`}`;
    try {
      await copyFile(path, target, constants.COPYFILE_EXCL);
      return target;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}
