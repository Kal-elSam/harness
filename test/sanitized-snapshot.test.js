import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { buildSanitizedSnapshot } from "../src/global/conversation/sanitized-snapshot.js";

async function makeRealProject(files) {
  const root = await mkdtemp(join(tmpdir(), "kairo-fixture-project-"));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(root, relPath);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content, "utf8");
  }
  return root;
}

test("buildSanitizedSnapshot copies real text files with real secrets redacted, never the real value on disk", async () => {
  const root = await makeRealProject({
    "src/app/api/chat/route.ts": 'const AZURE_OPENAI_API_KEY = "abcd1234efgh5678ijkl9012mnop3456";\nexport const handler = () => {};'
  });
  const snapshot = await buildSanitizedSnapshot(root);
  try {
    assert.equal(snapshot.filesCopied, 1);
    assert.equal(snapshot.secretsRedacted, 1);
    assert.deepEqual(snapshot.redactedFiles, ["src/app/api/chat/route.ts"]);
    const copied = await readFile(join(snapshot.snapshotRoot, "src/app/api/chat/route.ts"), "utf8");
    assert.doesNotMatch(copied, /abcd1234efgh5678ijkl9012mnop3456/, "the real secret value must never exist on disk in the sanitized snapshot");
    assert.match(copied, /\[REDACTED-SECRET\]/);
    assert.match(copied, /export const handler/, "real, non-secret code must survive the copy");
  } finally {
    await snapshot.cleanup();
  }
});

test("buildSanitizedSnapshot excludes known private paths outright (.env, secrets/, credentials.*, keys) — never even copies them, redacted or not", async () => {
  const root = await makeRealProject({
    ".env": "REAL_SECRET=abcd1234",
    "secrets/prod.txt": "another real secret",
    "src/index.js": "export const x = 1;"
  });
  const snapshot = await buildSanitizedSnapshot(root);
  try {
    assert.equal(snapshot.filesCopied, 1, "only the real, non-private source file should be copied");
    assert.ok(!existsSync(join(snapshot.snapshotRoot, ".env")));
    assert.ok(snapshot.excludedPrivatePaths.some((p) => p === ".env"));
  } finally {
    await snapshot.cleanup();
  }
});

test("buildSanitizedSnapshot skips real vendor/build directories entirely (node_modules, .git, dist)", async () => {
  const root = await makeRealProject({
    "node_modules/some-pkg/index.js": "module.exports = {};",
    ".git/config": "[core]",
    "dist/bundle.js": "console.log(1)",
    "src/real.js": "export const y = 2;"
  });
  const snapshot = await buildSanitizedSnapshot(root);
  try {
    assert.equal(snapshot.filesCopied, 1);
    assert.ok(!existsSync(join(snapshot.snapshotRoot, "node_modules")));
    assert.ok(!existsSync(join(snapshot.snapshotRoot, ".git")));
    assert.ok(!existsSync(join(snapshot.snapshotRoot, "dist")));
  } finally {
    await snapshot.cleanup();
  }
});

test("buildSanitizedSnapshot respects a real bounded file-count budget — never copies an unbounded amount of a real large repo", async () => {
  const files = {};
  for (let i = 0; i < 10; i += 1) files[`src/file-${i}.js`] = `export const v${i} = ${i};`;
  const root = await makeRealProject(files);
  const snapshot = await buildSanitizedSnapshot(root, { maxFiles: 3 });
  try {
    assert.equal(snapshot.filesCopied, 3);
  } finally {
    await snapshot.cleanup();
  }
});

test("buildSanitizedSnapshot excludes a real oversized file rather than truncating it silently", async () => {
  const root = await makeRealProject({ "src/huge.js": "x".repeat(1000) });
  const snapshot = await buildSanitizedSnapshot(root, { maxFileBytes: 100 });
  try {
    assert.equal(snapshot.filesCopied, 0);
    assert.deepEqual(snapshot.excludedOversized, ["src/huge.js"]);
  } finally {
    await snapshot.cleanup();
  }
});

test("buildSanitizedSnapshot's copiedFiles lists every real path actually copied — used to validate the analyst's own evidenceReferences later", async () => {
  const root = await makeRealProject({ "src/a.js": "export const a = 1;", "src/b.js": "export const b = 2;" });
  const snapshot = await buildSanitizedSnapshot(root);
  try {
    assert.deepEqual(new Set(snapshot.copiedFiles), new Set(["src/a.js", "src/b.js"]));
  } finally {
    await snapshot.cleanup();
  }
});

test("cleanup() is idempotent — calling it more than once must never throw", async () => {
  const root = await makeRealProject({ "src/a.js": "export const a = 1;" });
  const snapshot = await buildSanitizedSnapshot(root);
  await snapshot.cleanup();
  await snapshot.cleanup();
  assert.ok(!existsSync(snapshot.snapshotRoot));
});

test("a real failure while writing a file mid-copy still cleans up the temp directory instead of leaving it behind", async () => {
  // Captures the real snapshotRoot directly via injected mkdtemp, rather
  // than diffing the shared OS tmpdir's listing — scanning the shared
  // tmpdir is racy under this test runner's cross-file concurrency
  // (another test's own real buildSanitizedSnapshot call can create/
  // remove a kairo-analyst-snapshot-* dir at the same moment).
  const root = await makeRealProject({ "src/a.js": "export const a = 1;", "src/b.js": "export const b = 2;" });
  let capturedSnapshotRoot = null;
  const capturingMkdtemp = async (...args) => {
    capturedSnapshotRoot = await mkdtemp(...args);
    return capturedSnapshotRoot;
  };
  let calls = 0;
  const failingWriteFile = async (...args) => {
    calls += 1;
    if (calls === 2) throw new Error("simulated real disk write failure");
    return writeFile(...args);
  };
  await assert.rejects(
    () => buildSanitizedSnapshot(root, {}, { writeFile: failingWriteFile, mkdtemp: capturingMkdtemp }),
    /simulated real disk write failure/
  );
  assert.ok(capturedSnapshotRoot, "mkdtemp must have been called");
  assert.ok(!existsSync(capturedSnapshotRoot), "a failed snapshot build must never leave its temp directory behind");
});

test("cleanup() actually removes the real temporary snapshot directory from disk", async () => {
  const root = await makeRealProject({ "src/a.js": "export const a = 1;" });
  const snapshot = await buildSanitizedSnapshot(root);
  assert.ok(existsSync(snapshot.snapshotRoot));
  await snapshot.cleanup();
  assert.ok(!existsSync(snapshot.snapshotRoot));
});
