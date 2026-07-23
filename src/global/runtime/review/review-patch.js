import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { REVIEW_SCOPE_MODES, isReviewPrivatePath } from "./review-types.js";
import { ReviewExecError } from "./review-exec.js";
import { readReviewRegularFile } from "./review-git.js";

export const REVIEW_PATCH_ERROR_CODES = Object.freeze({
  INVALID_CWD: "invalid_cwd", GIT_FAILED: "git_failed"
});

const defaultExecFile = promisify(execFileCb);

async function gitDiff(cwd, args, execFileImpl) {
  try {
    const { stdout } = await execFileImpl("git", args, {
      cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024
    });
    return stdout ?? "";
  } catch (error) {
    if ((error?.code === 1 || error?.status === 1) && typeof error.stdout === "string") {
      return error.stdout;
    }
    throw new ReviewExecError(String(error?.stderr ?? error?.message ?? error).trim() || "git failed", {
      code: REVIEW_PATCH_ERROR_CODES.GIT_FAILED, details: { args }
    });
  }
}

function unquoteGitPath(path) {
  if (path.startsWith("\"") && path.endsWith("\"")) {
    try { return JSON.parse(path); } catch { return path.slice(1, -1); }
  }
  return path;
}

function pathsFromGitDiffHeader(line) {
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
  if (!match) return [];
  return [unquoteGitPath(match[1]), unquoteGitPath(match[2])];
}

/** Keep only unified-diff sections for admitted paths; drop any private endpoint. */
export function filterDiffToAdmittedPaths(diffText, admittedPaths) {
  const admitted = new Set(admittedPaths);
  if (admitted.size === 0) return "";
  const out = [];
  let keep = false;
  for (const line of String(diffText ?? "").split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      const paths = pathsFromGitDiffHeader(line);
      keep = paths.some((path) => admitted.has(path)) && !paths.some((path) => isReviewPrivatePath(path));
    }
    if (keep) out.push(line);
  }
  while (out.length && out.at(-1) === "") out.pop();
  return out.length ? `${out.join("\n")}\n` : "";
}

function synthesizeNewFileDiff(path, content) {
  const raw = String(content);
  const body = raw.endsWith("\n") ? raw.slice(0, -1).split("\n") : raw.split("\n");
  const hunk = body.length === 0
    ? ["@@ -0,0 +0,0 @@"]
    : [`@@ -0,0 +1,${body.length} @@`, ...body.map((line) => `+${line}`)];
  return [
    `diff --git a/${path} b/${path}`, "new file mode 100644", "--- /dev/null", `+++ b/${path}`,
    ...hunk, ""
  ].join("\n");
}

function admittedPaths(files) {
  const paths = [];
  for (const file of files) {
    if (file.path) paths.push(file.path);
    if (file.sourcePath) paths.push(file.sourcePath);
  }
  return paths;
}

/**
 * Host-generated unified diff limited to snapshot.files paths.
 * Covers WT (unstaged/staged/untracked/deleted), base, and commit scopes.
 * Never includes excluded/private paths from snapshot.excluded.
 */
export async function buildScopedReviewPatch(snapshot, { execFileImpl = defaultExecFile } = {}) {
  const cwd = snapshot?.cwd;
  if (typeof cwd !== "string" || !cwd) {
    throw new ReviewExecError("Scoped review patch requires snapshot.cwd.", {
      code: REVIEW_PATCH_ERROR_CODES.INVALID_CWD
    });
  }
  const files = Array.isArray(snapshot.files) ? snapshot.files : [];
  const admitted = admittedPaths(files);
  if (admitted.length === 0) return "";

  let raw = "";
  if (snapshot.mode === REVIEW_SCOPE_MODES.BASE) {
    raw = await gitDiff(cwd, ["diff", `${snapshot.base}...HEAD`, "--", ...admitted], execFileImpl);
  } else if (snapshot.mode === REVIEW_SCOPE_MODES.COMMIT) {
    raw = await gitDiff(
      cwd, ["show", "--format=", "--patch", snapshot.commit, "--", ...admitted], execFileImpl
    );
  } else {
    raw = [
      await gitDiff(cwd, ["diff", "--", ...admitted], execFileImpl),
      await gitDiff(cwd, ["diff", "--cached", "--", ...admitted], execFileImpl)
    ].join("");
    for (const file of files) {
      if (file.status !== "??") continue;
      try {
        const buffer = await readReviewRegularFile(join(cwd, file.path));
        raw += synthesizeNewFileDiff(file.path, buffer.toString("utf8"));
      } catch (error) {
        if (error?.code === "REVIEW_SYMLINK" || error?.code === "REVIEW_NON_REGULAR") continue;
        throw error;
      }
    }
  }
  return filterDiffToAdmittedPaths(raw, admitted);
}
