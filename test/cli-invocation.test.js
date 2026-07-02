import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSuggestedInvocation } from "../src/cli.js";

const packageName = "@kal-elsam/harness";

test("uses bare CLI name when invoked from a known bin", () => {
  assert.equal(
    resolveSuggestedInvocation(packageName, ["node", "/usr/local/bin/harness"]),
    "harness"
  );
});

test("suggests pnpm dlx when invoked as harness.js via pnpm", () => {
  const previousExecPath = process.env.npm_execpath;
  process.env.npm_execpath = "/Users/me/.local/share/pnpm/pnpm";

  try {
    assert.equal(
      resolveSuggestedInvocation(packageName, ["node", "/tmp/.pnpm/harness.js"]),
      "pnpm dlx @kal-elsam/harness"
    );
  } finally {
    if (previousExecPath === undefined) {
      delete process.env.npm_execpath;
    } else {
      process.env.npm_execpath = previousExecPath;
    }
  }
});

test("suggests npx when invoked as harness.js without pnpm", () => {
  const previousExecPath = process.env.npm_execpath;
  const previousUserAgent = process.env.npm_config_user_agent;
  delete process.env.npm_execpath;
  delete process.env.npm_config_user_agent;

  try {
    assert.equal(
      resolveSuggestedInvocation(packageName, ["node", "/tmp/node_modules/.bin/harness.js"]),
      "npx @kal-elsam/harness"
    );
  } finally {
    if (previousExecPath === undefined) {
      delete process.env.npm_execpath;
    } else {
      process.env.npm_execpath = previousExecPath;
    }

    if (previousUserAgent === undefined) {
      delete process.env.npm_config_user_agent;
    } else {
      process.env.npm_config_user_agent = previousUserAgent;
    }
  }
});
