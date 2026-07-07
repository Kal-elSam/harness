import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePublishedReleaseArgs,
  resolveReleaseTag,
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
    { version: "0.4.1", packageName: "@kal-elsam/kairo-runtime", tag: null }
  );
  assert.deepEqual(
    parsePublishedReleaseArgs(["node", "script", "--version=0.4.1"]),
    { version: "0.4.1", packageName: "@kal-elsam/kairo-runtime", tag: null }
  );
  assert.deepEqual(
    parsePublishedReleaseArgs(["node", "script", "--version", "0.4.1", "--package", "@kal-elsam/harness"]),
    { version: "0.4.1", packageName: "@kal-elsam/harness", tag: null }
  );
  assert.deepEqual(
    parsePublishedReleaseArgs([
      "node",
      "script",
      "--version",
      "0.1.1",
      "--package",
      "@kal-elsam/kairo-runtime",
      "--tag",
      "kairo-runtime-v0.1.1"
    ]),
    {
      version: "0.1.1",
      packageName: "@kal-elsam/kairo-runtime",
      tag: "kairo-runtime-v0.1.1"
    }
  );
  assert.deepEqual(
    parsePublishedReleaseArgs([
      "node",
      "script",
      "--version=0.30.0",
      "--package=@kal-elsam/harness",
      "--tag=harness-bridge-v0.30.0"
    ]),
    {
      version: "0.30.0",
      packageName: "@kal-elsam/harness",
      tag: "harness-bridge-v0.30.0"
    }
  );
});

test("resolveReleaseTag falls back to v-prefixed version tag", () => {
  assert.equal(resolveReleaseTag({ version: "0.4.1" }), "v0.4.1");
  assert.equal(resolveReleaseTag({ version: "0.4.1", tag: null }), "v0.4.1");
  assert.equal(
    resolveReleaseTag({ version: "0.1.1", tag: "kairo-runtime-v0.1.1" }),
    "kairo-runtime-v0.1.1"
  );
  assert.equal(
    resolveReleaseTag({ version: "0.30.0", tag: "harness-bridge-v0.30.0" }),
    "harness-bridge-v0.30.0"
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
      assert.equal(url, "https://registry.npmjs.org/%40kal-elsam%2Fkairo-runtime/0.4.1");
      return { version: "0.4.1", gitHead: "ffec146d" };
    }
  });

  assert.equal(result.gitHead, "ffec146d");
  assert.equal(result.tag, "v0.4.1");
  assert.equal(result.mainAhead, false);
  assert.deepEqual(commands, [
    "git rev-parse v0.4.1^{commit}",
    "git rev-parse origin/main",
    "git ls-remote --tags origin refs/tags/v0.4.1"
  ]);
});

test("verifyPublishedRelease allows origin/main ahead of npm gitHead", async () => {
  const commands = [];
  const result = await verifyPublishedRelease({
    version: "0.29.0",
    runGit: (command) => {
      commands.push(command);

      if (command === "git rev-parse v0.29.0^{commit}") return "79ef482\n";
      if (command === "git rev-parse origin/main") return "e39ed23\n";
      if (command === "git merge-base --is-ancestor 79ef482 origin/main") return "";
      if (command === "git ls-remote --tags origin refs/tags/v0.29.0") {
        return "79ef482\trefs/tags/v0.29.0\n";
      }

      throw new Error(`unexpected git command: ${command}`);
    },
    fetchJson: async () => ({ version: "0.29.0", gitHead: "79ef482" })
  });

  assert.equal(result.gitHead, "79ef482");
  assert.equal(result.mainSha, "e39ed23");
  assert.equal(result.mainAhead, true);
  assert.deepEqual(commands, [
    "git rev-parse v0.29.0^{commit}",
    "git rev-parse origin/main",
    "git merge-base --is-ancestor 79ef482 origin/main",
    "git ls-remote --tags origin refs/tags/v0.29.0"
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

test("verifyPublishedRelease fails when origin/main does not contain npm gitHead", async () => {
  await assert.rejects(
    verifyPublishedRelease({
      version: "0.4.1",
      runGit: (command) => {
        if (command === "git rev-parse v0.4.1^{commit}") return "ffec146d\n";
        if (command === "git rev-parse origin/main") return "aaaaaaaa\n";
        if (command === "git merge-base --is-ancestor ffec146d origin/main") {
          throw new Error("not ancestor");
        }
        throw new Error(command);
      },
      fetchJson: async () => ({ version: "0.4.1", gitHead: "ffec146d" })
    }),
    /does not contain npm gitHead/
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

test("verifyPublishedRelease uses explicit package-aware tag", async () => {
  const commands = [];
  const result = await verifyPublishedRelease({
    version: "0.1.1",
    packageName: "@kal-elsam/kairo-runtime",
    tag: "kairo-runtime-v0.1.1",
    runGit: (command) => {
      commands.push(command);

      if (command === "git rev-parse kairo-runtime-v0.1.1^{commit}") return "abc123\n";
      if (command === "git rev-parse origin/main") return "abc123\n";
      if (command === "git ls-remote --tags origin refs/tags/kairo-runtime-v0.1.1") {
        return "abc123\trefs/tags/kairo-runtime-v0.1.1\n";
      }

      throw new Error(`unexpected git command: ${command}`);
    },
    fetchJson: async (url) => {
      assert.equal(url, "https://registry.npmjs.org/%40kal-elsam%2Fkairo-runtime/0.1.1");
      return { version: "0.1.1", gitHead: "abc123" };
    }
  });

  assert.equal(result.tag, "kairo-runtime-v0.1.1");
  assert.deepEqual(commands, [
    "git rev-parse kairo-runtime-v0.1.1^{commit}",
    "git rev-parse origin/main",
    "git ls-remote --tags origin refs/tags/kairo-runtime-v0.1.1"
  ]);
});

test("verifyPublishedRelease supports harness bridge tag", async () => {
  const result = await verifyPublishedRelease({
    version: "0.30.0",
    packageName: "@kal-elsam/harness",
    tag: "harness-bridge-v0.30.0",
    runGit: (command) => {
      if (command === "git rev-parse harness-bridge-v0.30.0^{commit}") return "bridge123\n";
      if (command === "git rev-parse origin/main") return "bridge123\n";
      if (command === "git ls-remote --tags origin refs/tags/harness-bridge-v0.30.0") {
        return "bridge123\trefs/tags/harness-bridge-v0.30.0\n";
      }

      throw new Error(`unexpected git command: ${command}`);
    },
    fetchJson: async (url) => {
      assert.equal(url, "https://registry.npmjs.org/%40kal-elsam%2Fharness/0.30.0");
      return { version: "0.30.0", gitHead: "bridge123" };
    }
  });

  assert.equal(result.tag, "harness-bridge-v0.30.0");
  assert.equal(result.packageName, "@kal-elsam/harness");
});
