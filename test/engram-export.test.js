import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const fixture = JSON.parse(await readFile(new URL("./fixtures/obsidian/export.json", import.meta.url)));

test("official export uses argument array, timeout, private scratch and parses observations", async () => {
  const { loadEngramExport } = await import("../src/global/integrations/engram-export.js");
  let called = false;
  const result = await loadEngramExport({ project: "demo; echo nope", execFile: async (bin, args, opts) => {
    called = true;
    assert.equal(bin, "engram");
    assert.deepEqual([args[0], ...args.slice(2)], ["export", "--project", "demo; echo nope"]);
    assert.equal(opts.shell, false);
    assert.ok(opts.timeout > 0);
    assert.ok(!args[1].startsWith(process.cwd()));
    await writeFile(args[1], JSON.stringify(fixture));
  }});
  assert.equal(called, true);
  assert.equal(result.error, null);
  assert.deepEqual(result.records, fixture.observations);
  console.log(`scratch: ${result.scratchPath}`);
});

test("export missing binary, timeout, command failure and malformed JSON return typed errors", async () => {
  const { loadEngramExport } = await import("../src/global/integrations/engram-export.js");
  for (const [code, expected] of [["ENOENT", "binary_missing"], ["ETIMEDOUT", "timeout"], [1, "export_failed"]]) {
    const result = await loadEngramExport({ project: "demo", execFile: async () => { throw Object.assign(new Error("private stderr"), { code }); } });
    assert.equal(result.error.code, expected);
    assert.deepEqual(result.records, []);
    assert.ok(!JSON.stringify(result).includes("private stderr"));
    console.log(`scratch: ${result.scratchPath}`);
  }
  for (const payload of ["bad json", "{}"] ) {
    const result = await loadEngramExport({ project: "demo", execFile: async (_, args) => writeFile(args[1], payload) });
    assert.equal(result.error.code, "invalid_export");
    console.log(`scratch: ${result.scratchPath}`);
  }
});
