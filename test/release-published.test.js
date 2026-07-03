import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePublishedReleaseArgs,
  verifyPublishedRelease
} from "../scripts/check-published-release.mjs";

test("parsePublishedReleaseArgs requires --version", () => {
  assert.throws(
    () => parsePublishedReleaseArgs(["node", "script"]),
    /Missing required --version/
  );
});

test("parsePublishedReleaseArgs accepts --version and --version=value", () => {
  assert.deepEqual(
    parsePublishedReleaseArgs(["node", "script", "--version", "0.4.1"]),
    { version: "0.4.1" }
  );
  assert.deepEqual(
    parsePublishedReleaseArgs(["node", "script", "--version=0.4.1"]),
    { version: "0.4.1" }
  );
});

test("verifyPublishedRelease matches npm gitHead, tag, and origin/main", async () => {
  const commands = [];
  const result = await verifyPublishedRelease({
    version: "0.4.1",
    runGit: (command) => {
      commands.push(command);

      if (command === "git rev-parse v0.4.1^{commit}") return "ffec146d\n";
      if (command === "git rev-parse origin/main") return "ffec146d\n";
      if (command === "git ls-remote --tags origin refs/tags/v0.4.1") {
        return "ffec146d\trefs/tags/v0.4.1\n";
      }

      throw new Error(`unexpected git command: ${command}`);
    },
    fetchJson: async (url) => {
      assert.equal(url, "https://registry.npmjs.org/%40kal-elsam%2Fharness/0.4.1");
      return { version: "0.4.1", gitHead: "ffec146d" };
    }
  });

  assert.equal(result.gitHead, "ffec146d");
  assert.equal(result.tag, "v0.4.1");
  assert.deepEqual(commands, [
    "git rev-parse v0.4.1^{commit}",
    "git rev-parse origin/main",
    "git ls-remote --tags origin refs/tags/v0.4.1"
  ]);
});

test("verifyPublishedRelease fails when npm gitHead differs from local tag", async () => {
  await assert.rejects(
    verifyPublishedRelease({
      version: "0.4.1",
      runGit: (command) => {
        if (command === "git rev-parse v0.4.1^{commit}") return "aaaaaaaa\n";
        throw new Error(command);
      },
      fetchJson: async () => ({ version: "0.4.1", gitHead: "bbbbbbbb" })
    }),
    /does not match npm gitHead/
  );
});

test("verifyPublishedRelease fails when origin/main differs from npm gitHead", async () => {
  await assert.rejects(
    verifyPublishedRelease({
      version: "0.4.1",
      runGit: (command) => {
        if (command === "git rev-parse v0.4.1^{commit}") return "ffec146d\n";
        if (command === "git rev-parse origin/main") return "aaaaaaaa\n";
        throw new Error(command);
      },
      fetchJson: async () => ({ version: "0.4.1", gitHead: "ffec146d" })
    }),
    /origin\/main/
  );
});

test("verifyPublishedRelease fails when remote tag is missing", async () => {
  await assert.rejects(
    verifyPublishedRelease({
      version: "0.4.1",
      runGit: (command) => {
        if (command === "git rev-parse v0.4.1^{commit}") return "ffec146d\n";
        if (command === "git rev-parse origin/main") return "ffec146d\n";
        if (command === "git ls-remote --tags origin refs/tags/v0.4.1") return "";
        throw new Error(command);
      },
      fetchJson: async () => ({ version: "0.4.1", gitHead: "ffec146d" })
    }),
    /Remote tag/
  );
});
