import { open, lstat } from "node:fs/promises";
import { constants } from "node:fs";

/** lstat + open; bind handle to validated inode via fstat (portable vs O_NOFOLLOW). */
export async function readReviewRegularFile(absPath, {
  lstatImpl = lstat, openImpl = open
} = {}) {
  let st;
  try { st = await lstatImpl(absPath); }
  catch (error) {
    error.code = error.code ?? "ENOENT";
    throw error;
  }
  if (st.isSymbolicLink()) {
    const error = new Error(`Refusing symlink "${absPath}".`);
    error.code = "REVIEW_SYMLINK";
    throw error;
  }
  if (!st.isFile()) {
    const error = new Error(`Refusing non-regular file "${absPath}".`);
    error.code = "REVIEW_NON_REGULAR";
    throw error;
  }
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  let handle;
  try {
    handle = await openImpl(absPath, flags);
  } catch (error) {
    if (error?.code === "ELOOP" || error?.code === "EMLINK") {
      const wrapped = new Error(`Refusing symlink "${absPath}".`);
      wrapped.code = "REVIEW_SYMLINK";
      throw wrapped;
    }
    throw error;
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || (typeof opened.isSymbolicLink === "function" && opened.isSymbolicLink())) {
      const error = new Error(`Refusing non-regular handle "${absPath}".`);
      error.code = "REVIEW_NON_REGULAR";
      throw error;
    }
    if (opened.dev !== st.dev || opened.ino !== st.ino) {
      const error = new Error(`Refusing identity change for "${absPath}".`);
      error.code = "REVIEW_IDENTITY_CHANGED";
      throw error;
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
