import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rename as fsRename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAtomicJson } from "../src/global/runtime/write-atomic-json.js";

async function tempDir() {
  return mkdtemp(join(tmpdir(), "kairo-atomic-json-"));
}

function listTemps(entries) {
  return entries.filter((name) => name.endsWith(".tmp"));
}

test("readers only observe complete previous JSON during atomic commit", async () => {
  const dir = await tempDir();
  const target = join(dir, "state.json");
  const before = { version: "before", pad: "x".repeat(40_000) };
  const after = { version: "after", pad: "y".repeat(40_000) };
  await writeAtomicJson(target, before);

  let releaseRename;
  const renameGate = new Promise((resolve) => {
    releaseRename = resolve;
  });
  let enteredRename = false;

  const writePromise = writeAtomicJson(target, after, {
    rename: async (from, to) => {
      enteredRename = true;
      await renameGate;
      await fsRename(from, to);
    }
  });

  while (!enteredRename) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  for (let i = 0; i < 40; i++) {
    const raw = await readFile(target, "utf8");
    const parsed = JSON.parse(raw);
    assert.equal(parsed.version, "before");
    assert.equal(parsed.pad.length, 40_000);
  }

  releaseRename();
  await writePromise;

  const final = JSON.parse(await readFile(target, "utf8"));
  assert.equal(final.version, "after");
  assert.equal(listTemps(await readdir(dir)).length, 0);
});

test("concurrent writers leave parseable JSON and no residual temps", async () => {
  const dir = await tempDir();
  const target = join(dir, "state.json");
  await writeAtomicJson(target, { writer: 0, pad: "z".repeat(8_000) });

  await Promise.all([
    writeAtomicJson(target, { writer: 1, pad: "a".repeat(25_000) }),
    writeAtomicJson(target, { writer: 2, pad: "b".repeat(25_000) })
  ]);

  const parsed = JSON.parse(await readFile(target, "utf8"));
  assert.ok(parsed.writer === 1 || parsed.writer === 2);
  assert.equal(parsed.pad.length, 25_000);
  assert.equal(listTemps(await readdir(dir)).length, 0);
});

test("write failure preserves previous file and cleans temp", async () => {
  const dir = await tempDir();
  const target = join(dir, "state.json");
  const before = { ok: true };
  await writeAtomicJson(target, before);

  await assert.rejects(
    () => writeAtomicJson(target, { ok: false }, {
      open: async () => ({
        writeFile: async () => {
          throw new Error("write boom");
        },
        sync: async () => {},
        close: async () => {}
      })
    }),
    /write boom/
  );

  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), before);
  assert.equal(listTemps(await readdir(dir)).length, 0);
});

test("sync failure preserves previous file and cleans temp", async () => {
  const dir = await tempDir();
  const target = join(dir, "state.json");
  const before = { stage: "synced" };
  await writeAtomicJson(target, before);

  await assert.rejects(
    () => writeAtomicJson(target, { stage: "broken" }, {
      open: async () => ({
        writeFile: async () => {},
        sync: async () => {
          throw new Error("sync boom");
        },
        close: async () => {}
      })
    }),
    /sync boom/
  );

  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), before);
  assert.equal(listTemps(await readdir(dir)).length, 0);
});

test("rename failure preserves previous file and cleans temp", async () => {
  const dir = await tempDir();
  const target = join(dir, "state.json");
  const before = { stage: "renamed" };
  await writeAtomicJson(target, before);

  await assert.rejects(
    () => writeAtomicJson(target, { stage: "lost" }, {
      rename: async () => {
        throw new Error("rename boom");
      }
    }),
    /rename boom/
  );

  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), before);
  assert.equal(listTemps(await readdir(dir)).length, 0);
});

test("createExclusive rejects EEXIST and survives post-commit unlink failure", async () => {
  const dir = await tempDir();
  const once = join(dir, "once.json");
  await writeAtomicJson(once, { n: 1 }, { createExclusive: true });
  await assert.rejects(() => writeAtomicJson(once, { n: 2 }, { createExclusive: true }),
    (e) => e?.code === "EEXIST");
  assert.deepEqual(JSON.parse(await readFile(once, "utf8")), { n: 1 });
  await writeAtomicJson(join(dir, "ok.json"), { ok: true }, {
    createExclusive: true, unlink: async () => { throw new Error("unlink boom"); }
  });
  assert.deepEqual(JSON.parse(await readFile(join(dir, "ok.json"), "utf8")), { ok: true });
});
