import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCleanReleaseMessage,
  assertCleanReleaseMessages,
  parseAttributionGuardArgs,
  readCommitMessages,
  runAttributionGuard
} from "../scripts/check-release-commit.mjs";

test("accepts a clean release commit message", () => {
  assert.doesNotThrow(() => assertCleanReleaseMessage("chore: release 0.4.1\n"));
});

test("rejects Co-authored-by trailers", () => {
  assert.throws(
    () => assertCleanReleaseMessage("chore: release 0.4.1\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n"),
    /Co-authored-by/
  );
});

test("rejects mixed-case attribution trailers", () => {
  assert.throws(
    () => assertCleanReleaseMessage("chore: release 0.4.1\n\nCo-Authored-By: Bot <bot@example.com>\n"),
    /Co-authored-by/
  );
});

test("parseAttributionGuardArgs accepts --range", () => {
  assert.deepEqual(
    parseAttributionGuardArgs(["node", "script", "--range", "origin/main...HEAD"]),
    { range: "origin/main...HEAD" }
  );
});

test("parseAttributionGuardArgs accepts --range=value", () => {
  assert.deepEqual(
    parseAttributionGuardArgs(["node", "script", "--range=abc..def"]),
    { range: "abc..def" }
  );
});

test("parseAttributionGuardArgs defaults to HEAD-only mode", () => {
  assert.deepEqual(parseAttributionGuardArgs(["node", "script"]), { range: null });
});

test("readCommitMessages returns HEAD when no range is provided", () => {
  const messages = readCommitMessages({
    runGit: (command) => {
      assert.equal(command, "git log -1 --format=%B");
      return "chore: release 0.4.1\n";
    }
  });

  assert.deepEqual(messages, ["chore: release 0.4.1\n"]);
});

test("readCommitMessages splits every commit in a range", () => {
  const messages = readCommitMessages({
    range: "origin/main...HEAD",
    runGit: (command) => {
      assert.equal(command, "git log origin/main...HEAD --format=%B%x1E");
      return "feat: one\n\x1Efix: two\n\x1E";
    }
  });

  assert.deepEqual(messages, ["feat: one\n", "fix: two\n"]);
});

test("runAttributionGuard checks every commit in a range", () => {
  assert.throws(
    () =>
      runAttributionGuard({
        range: "a..b",
        runGit: () => "clean one\n\x1Eclean two\n\x1EBad\nCo-Authored-By: Bot\n\x1E"
      }),
    /Co-authored-by/
  );
});

test("runAttributionGuard accepts a clean range", () => {
  const result = runAttributionGuard({
    range: "a..b",
    runGit: () => "chore: one\n\x1Echore: two\n\x1E"
  });

  assert.equal(result.checked, 2);
  assert.equal(result.range, "a..b");
});

test("assertCleanReleaseMessages validates multiple messages", () => {
  assert.doesNotThrow(() =>
    assertCleanReleaseMessages(["chore: release 0.4.1\n", "docs: update publishing\n"])
  );

  assert.throws(
    () => assertCleanReleaseMessages(["clean\n", "bad\nCo-authored-by: x\n"]),
    /Co-authored-by/
  );
});
