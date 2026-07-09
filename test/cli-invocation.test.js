import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs, resolveSuggestedInvocation } from "../src/cli.js";
import { formatSuggestedCliCommand } from "../src/global/brand/cli.js";

const packageName = "@kal-elsam/kairo-runtime";

test("bare harness defaults to shell for interactive entry", () => {
  const { command } = parseArgs([]);
  assert.equal(command, "shell");
});

test("bare harness flags route to setup when setup flags are present", () => {
  const { command, options } = parseArgs(["--dry-run"]);
  assert.equal(command, "setup");
  assert.equal(options.dryRun, true);
});

test("bare harness with workspace scope keeps legacy init entry", () => {
  const { command } = parseArgs(["--scope=workspace"]);
  assert.equal(command, "init");
});

test("explicit install is unchanged", () => {
  const { command } = parseArgs(["install", "--agents", "cursor"]);
  assert.equal(command, "install");
});

test("formatSuggestedCliCommand uses global bin when invoked from PATH", () => {
  assert.equal(
    formatSuggestedCliCommand("status", {
      suggestedInvocation: "kairo"
    }),
    "kairo status"
  );
});

test("formatSuggestedCliCommand uses npx when invoked via script path", () => {
  assert.equal(
    formatSuggestedCliCommand("status", {
      argv: ["node", "/tmp/node_modules/.bin/kairo.js"]
    }),
    "npx @kal-elsam/kairo-runtime status"
  );
});

test("uses bare CLI name when invoked from a known bin", () => {
  assert.equal(
    resolveSuggestedInvocation(packageName, ["node", "/usr/local/bin/harness"]),
    "harness"
  );
});

test("suggests pnpm dlx when invoked as harness.js via pnpm", () => {
  assert.equal(
    resolveSuggestedInvocation(packageName, ["node", "/tmp/.pnpm/harness.js"], {
      env: { npm_execpath: "/Users/me/.local/share/pnpm/pnpm" }
    }),
    "pnpm dlx @kal-elsam/kairo-runtime"
  );
});

test("suggests npx when invoked as harness.js without pnpm", () => {
  assert.equal(
    resolveSuggestedInvocation(packageName, ["node", "/tmp/node_modules/.bin/harness.js"], {
      env: {}
    }),
    "npx @kal-elsam/kairo-runtime"
  );
});

test("suggests yarn dlx when user agent reports yarn", () => {
  assert.equal(
    resolveSuggestedInvocation(packageName, ["node", "/tmp/harness.js"], {
      env: { npm_config_user_agent: "yarn/4.0.0" }
    }),
    "yarn dlx @kal-elsam/kairo-runtime"
  );
});

test("suggests bunx when user agent reports bun", () => {
  assert.equal(
    resolveSuggestedInvocation(packageName, ["node", "/tmp/harness.js"], {
      env: { npm_config_user_agent: "bun/1.0.0" }
    }),
    "bunx @kal-elsam/kairo-runtime"
  );
});
