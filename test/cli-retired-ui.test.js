import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const bin = new URL("../bin/kairo.js", import.meta.url);
const message = "The terminal UI was retired. Use `kairo status` or `kairo setup`.";

for (const [args, status] of [[[], 0], [["ui"], 1], [["host"], 1], [["shell"], 1]]) {
  test(`kairo ${args.join(" ")} reports UI retirement without launching a host`, () => {
    const result = spawnSync(process.execPath, [bin.pathname, ...args], {
      encoding: "utf8", timeout: 10000,
      env: { ...process.env, KAIRO_UI_HOST: "pi" }
    });
    assert.equal(result.error, undefined);
    assert.equal(result.stdout.trim(), message);
    assert.equal(result.stderr, "");
    assert.equal(result.status, status);
  });
}
