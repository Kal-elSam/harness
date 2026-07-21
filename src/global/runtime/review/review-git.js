import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  REVIEW_SCOPE_MODES,
  REVIEW_SNAPSHOT_ERROR_CODES,
  ReviewSnapshotError,
  assertReviewPathSafe,
  assertWithinReviewLimits,
  canonicalFingerprint,
  isBinaryContent,
  isReviewPrivatePath,
  requirePrivateConsent,
  resolveReviewScopeMode
} from "./review-types.js";

const defaultExecFile = promisify(execFileCb);

async function git(cwd, args, execFileImpl) {
  try {
    const { stdout } = await execFileImpl("git", args, {
      cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024
    });
    return stdout ?? "";
  } catch (error) {
    throw new ReviewSnapshotError(String(error?.stderr ?? error?.message ?? error).trim() || "git failed", { code: REVIEW_SNAPSHOT_ERROR_CODES.INVALID_REF, details: { args, status: error?.code ?? null } });
  }
}

async function assertGitRepo(cwd, execFileImpl) {
  try {
    if ((await git(cwd, ["rev-parse", "--is-inside-work-tree"], execFileImpl)).trim() !== "true") {
      throw new Error("not git");
    }
  } catch (error) {
    if (error instanceof ReviewSnapshotError && error.code === REVIEW_SNAPSHOT_ERROR_CODES.INVALID_REF) {
      throw new ReviewSnapshotError("Not a git repository.", {
        code: REVIEW_SNAPSHOT_ERROR_CODES.NOT_A_GIT_REPO
      });
    }
    throw error;
  }
}

function parseNumstat(text) {
  const byPath = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [addedRaw, deletedRaw, path] = line.split("\t");
    if (!path) continue;
    const n = (addedRaw === "-" ? 0 : Number(addedRaw)) + (deletedRaw === "-" ? 0 : Number(deletedRaw));
    byPath.set(path, (byPath.get(path) ?? 0) + n);
  }
  return byPath;
}

function parsePorcelain(text) {
  return text.split("\n").filter(Boolean).map((line) => {
    let path = line.slice(3);
    if (path.includes(" -> ")) path = path.split(" -> ").at(-1);
    if (path.startsWith("\"") && path.endsWith("\"")) path = JSON.parse(path);
    return { status: line.slice(0, 2), path };
  });
}

function parseNameStatus(text) {
  return text.split("\n").filter((l) => l.trim()).map((line) => {
    const parts = line.split("\t");
    return { status: parts[0], path: parts.length >= 3 ? parts[2] : parts[1] };
  });
}

function fingerprintPayload(s) {
  return {
    mode: s.mode, headSha: s.headSha, base: s.base ?? null, commit: s.commit ?? null,
    files: s.files.map((f) => ({ path: f.path, status: f.status, hash: f.hash, changedLines: f.changedLines })),
    excluded: s.excluded.map((e) => ({ path: e.path, reason: e.reason }))
  };
}

/** Bounded Git review snapshot via argv-only git (no shell, no repo writes). */
export async function resolveReviewSnapshot({
  cwd, base = null, commit = null, includePrivate = false, privateConfirmed = false,
  execFileImpl = defaultExecFile
} = {}) {
  const mode = resolveReviewScopeMode({ base, commit });
  await assertGitRepo(cwd, execFileImpl);
  const headSha = (await git(cwd, ["rev-parse", "HEAD"], execFileImpl)).trim();
  let rawEntries = [];
  let numstat = new Map();
  let diffBytes = 0;

  if (mode === REVIEW_SCOPE_MODES.WORKING_TREE) {
    rawEntries = parsePorcelain(await git(cwd, ["status", "--porcelain=v1", "-uall"], execFileImpl));
    numstat = new Map([
      ...parseNumstat(await git(cwd, ["diff", "--numstat"], execFileImpl)),
      ...parseNumstat(await git(cwd, ["diff", "--cached", "--numstat"], execFileImpl))
    ]);
    diffBytes = Buffer.byteLength(await git(cwd, ["diff"], execFileImpl), "utf8")
      + Buffer.byteLength(await git(cwd, ["diff", "--cached"], execFileImpl), "utf8");
  } else if (mode === REVIEW_SCOPE_MODES.BASE) {
    const range = `${base}...HEAD`;
    await git(cwd, ["rev-parse", "--verify", base], execFileImpl);
    rawEntries = parseNameStatus(await git(cwd, ["diff", "--name-status", range], execFileImpl));
    numstat = parseNumstat(await git(cwd, ["diff", "--numstat", range], execFileImpl));
    diffBytes = Buffer.byteLength(await git(cwd, ["diff", range], execFileImpl), "utf8");
  } else {
    await git(cwd, ["rev-parse", "--verify", `${commit}^{commit}`], execFileImpl);
    rawEntries = parseNameStatus(
      await git(cwd, ["diff-tree", "--no-commit-id", "--name-status", "-r", commit], execFileImpl)
    );
    numstat = parseNumstat(
      await git(cwd, ["diff-tree", "--no-commit-id", "--numstat", "-r", commit], execFileImpl)
    );
    diffBytes = Buffer.byteLength(await git(cwd, ["show", "--format=", "--patch", commit], execFileImpl), "utf8");
  }

  const excluded = [];
  const privateCandidates = [];
  const files = [];

  for (const entry of rawEntries) {
    const path = assertReviewPathSafe(entry.path);
    if (isReviewPrivatePath(path)) {
      if (includePrivate) privateCandidates.push(path);
      else { excluded.push({ path, reason: "private" }); continue; }
    }

    let hash;
    let changedLines = numstat.get(path) ?? 0;
    let bytes = 0;
    const deleted = /D/.test(entry.status);

    if (mode === REVIEW_SCOPE_MODES.WORKING_TREE && !deleted) {
      const buffer = await readFile(join(cwd, path));
      if (isBinaryContent(buffer)) { excluded.push({ path, reason: "binary" }); continue; }
      hash = createHash("sha256").update(buffer).digest("hex");
      bytes = buffer.length;
      if (!numstat.has(path)) changedLines = buffer.toString("utf8").split(/\r?\n/).length;
      if (entry.status === "??") diffBytes += bytes;
    } else {
      try { hash = (await git(cwd, ["rev-parse", `HEAD:${path}`], execFileImpl)).trim(); }
      catch { hash = createHash("sha256").update(`${entry.status}:${path}`).digest("hex"); }
    }

    files.push({ path, status: entry.status.trim(), hash, changedLines, bytes });
  }

  requirePrivateConsent({ includePrivate, privateConfirmed, privatePaths: privateCandidates });
  files.sort((a, b) => a.path.localeCompare(b.path));
  excluded.sort((a, b) => a.path.localeCompare(b.path));
  const changedLines = files.reduce((sum, f) => sum + f.changedLines, 0);
  assertWithinReviewLimits({ fileCount: files.length, changedLines, diffBytes });

  const snapshot = {
    version: 1, mode, cwd, headSha, base: base ?? null, commit: commit ?? null,
    files, excluded, totals: { fileCount: files.length, changedLines, diffBytes }, fingerprint: null
  };
  snapshot.fingerprint = canonicalFingerprint(fingerprintPayload(snapshot));
  return snapshot;
}

export function fingerprintReviewSnapshot(snapshot) {
  return canonicalFingerprint(fingerprintPayload(snapshot));
}

export async function detectReviewSnapshotDrift(previous, options = {}) {
  const next = await resolveReviewSnapshot({
    cwd: previous.cwd, base: previous.base, commit: previous.commit,
    includePrivate: options.includePrivate ?? false,
    privateConfirmed: options.privateConfirmed ?? false,
    execFileImpl: options.execFileImpl
  });
  return {
    stale: next.fingerprint !== previous.fingerprint,
    previousFingerprint: previous.fingerprint,
    nextFingerprint: next.fingerprint,
    next
  };
}
