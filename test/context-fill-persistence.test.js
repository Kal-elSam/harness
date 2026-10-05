import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, rename as fsRename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeAtomicText } from "../src/global/runtime/write-atomic-json.js";
import {
  claimVisibleNotice,
  recordContextFill
} from "../src/global/observability/context-fill-hook.js";
import {
  checkpointPath,
  loadCheckpoint,
  writeCheckpoint
} from "../src/global/observability/context-fill-checkpoint.js";
import {
  CONTEXT_FILL_LOCK_SCHEMA,
  mutateContextFillState,
  readContextFillState
} from "../src/global/observability/context-fill-state.js";
import { writeAtomicJson } from "../src/global/runtime/write-atomic-json.js";

const here = dirname(fileURLToPath(import.meta.url));
const hookModule = pathToFileURL(join(here, "../src/global/observability/context-fill-hook.js")).href;

function filledReport(cwd) {
  return {
    cwd,
    readings: [
      { adapter: "codex", status: "measured", used: 160000, limit: 200000, ratio: 0.8, band: "saturated" },
      { adapter: "cursor", status: "measured", used: null, limit: null, ratio: 0.75, band: "saturated" }
    ]
  };
}

test("readers never observe a partial STATE.md while a checkpoint commits", async () => {
  const home = mkdtempSync(join(tmpdir(), "cf-ckpt-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "cf-ckpt-cwd-"));
  const path = checkpointPath(home, cwd);
  await mkdir(dirname(path), { recursive: true });
  const before = "# Checkpoint\n\n## Terminado\nbefore-complete\n\n## Siguiente\nok\n";
  await writeAtomicText(path, before);

  let releaseRename;
  const renameGate = new Promise((resolve) => {
    releaseRename = resolve;
  });
  let enteredRename = false;
  const afterBody = `# Checkpoint\n\n## Terminado\n${"after-complete\n".repeat(2_000)}\n## Siguiente\nok\n`;

  const writePromise = writeAtomicText(path, afterBody, {
    rename: async (from, to) => {
      enteredRename = true;
      await renameGate;
      await fsRename(from, to);
    }
  });

  while (!enteredRename) await new Promise((r) => setImmediate(r));

  for (let i = 0; i < 30; i += 1) {
    const raw = await readFile(path, "utf8");
    assert.match(raw, /before-complete/);
    assert.doesNotMatch(raw, /after-complete/);
    assert.ok(raw.includes("## Siguiente"));
  }

  releaseRename();
  await writePromise;
  const finalBody = await readFile(path, "utf8");
  assert.match(finalBody, /after-complete/);
  assert.doesNotMatch(finalBody, /before-complete/);
});

test("writeCheckpoint publishes atomically so loadCheckpoint sees a full document", async () => {
  const home = mkdtempSync(join(tmpdir(), "cf-ckpt-write-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "cf-ckpt-write-cwd-"));
  const path = await writeCheckpoint({
    homeDir: home,
    cwd,
    report: filledReport(cwd),
    adapter: "codex",
    decisions: "Atomic publish."
  });
  const loaded = await loadCheckpoint(home, cwd);
  assert.match(loaded, /# Checkpoint/);
  assert.match(loaded, /Atomic publish/);
  assert.match(loaded, /## Siguiente/);
  assert.equal((await readFile(path, "utf8")).endsWith("\n"), true);
});

test("concurrent claimVisibleNotice grants the notice once", async () => {
  const home = mkdtempSync(join(tmpdir(), "cf-claim-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "cf-claim-cwd-"));
  const mark = "codex:80:saturated";
  const results = await Promise.all(Array.from({ length: 12 }, () =>
    claimVisibleNotice(home, cwd, "codex", mark)
  ));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await claimVisibleNotice(home, cwd, "codex", mark), false);
});

test("concurrent record and claim keep both announced marks", async () => {
  const home = mkdtempSync(join(tmpdir(), "cf-merge-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "cf-merge-cwd-"));
  const report = filledReport(cwd);
  await Promise.all([
    claimVisibleNotice(home, cwd, "codex", "codex:80:saturated"),
    recordContextFill({ homeDir: home, report, saveEngram: async () => false }),
    claimVisibleNotice(home, cwd, "cursor", "cursor:75:saturated")
  ]);
  const state = JSON.parse(await readFile(join(home, ".harness", "context-fill.json"), "utf8"));
  const entry = Object.values(state.projects)[0];
  assert.equal(entry.announced.codex, "codex:80:saturated");
  assert.equal(entry.announced.cursor, "cursor:75:saturated");
  assert.equal(entry.readings.length, 2);
});

test("multiprocess claims and records do not lose updates", () => {
  const home = mkdtempSync(join(tmpdir(), "cf-mp-home-"));
  const cwd = mkdtempSync(join(tmpdir(), "cf-mp-cwd-"));
  const scriptPath = join(home, "worker.mjs");
  writeFileSync(scriptPath, `
    import { claimVisibleNotice, recordContextFill } from ${JSON.stringify(hookModule)};
    const home = process.env.CF_HOME;
    const cwd = process.env.CF_CWD;
    const adapter = process.env.CF_ADAPTER;
    const mark = process.env.CF_MARK;
    const report = {
      cwd,
      readings: [
        { adapter: "codex", status: "measured", used: 1, limit: 1, ratio: 0.8, band: "saturated" },
        { adapter: "cursor", status: "measured", used: 1, limit: 1, ratio: 0.75, band: "saturated" }
      ]
    };
    const claimed = await claimVisibleNotice(home, cwd, adapter, mark);
    await recordContextFill({ homeDir: home, report, saveEngram: async () => false });
    process.stdout.write(JSON.stringify({ claimed, adapter }));
  `);
  const run = (adapter, mark) => spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: { ...process.env, CF_HOME: home, CF_CWD: cwd, CF_ADAPTER: adapter, CF_MARK: mark }
  });
  const a = run("codex", "codex:80:saturated");
  const b = run("cursor", "cursor:75:saturated");
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(JSON.parse(a.stdout).claimed, true);
  assert.equal(JSON.parse(b.stdout).claimed, true);
  const state = JSON.parse(readFileSync(join(home, ".harness", "context-fill.json"), "utf8"));
  const entry = Object.values(state.projects)[0];
  assert.equal(entry.announced.codex, "codex:80:saturated");
  assert.equal(entry.announced.cursor, "cursor:75:saturated");
});

test("live lock holder is not stolen after staleAfterMs", async () => {
  const home = mkdtempSync(join(tmpdir(), "cf-live-lock-"));
  let releaseHold;
  const hold = new Promise((resolve) => {
    releaseHold = resolve;
  });
  let enteredMutator;
  const entered = new Promise((resolve) => {
    enteredMutator = resolve;
  });
  const t0 = 1_000_000;
  let now = t0;

  const owner = mutateContextFillState(home, async (state) => {
    state.projects.owner = { held: true };
    enteredMutator();
    await hold;
    return "owner";
  }, {
    now: () => now,
    isPidAlive: () => true,
    pid: 111,
    retries: 4,
    retryMs: 5,
    staleAfterMs: 50
  });

  await entered;
  now = t0 + 10_000;
  await assert.rejects(
    () => mutateContextFillState(home, (state) => {
      state.projects.waiter = { stole: true };
      return "waiter";
    }, {
      now: () => now,
      isPidAlive: () => true,
      pid: 222,
      retries: 4,
      retryMs: 5,
      staleAfterMs: 50
    }),
    /lock busy/
  );
  releaseHold();
  assert.equal(await owner, "owner");
  const state = await readContextFillState(home);
  assert.equal(state.projects.owner?.held, true);
  assert.equal(state.projects.waiter, undefined);
});

test("dead lock holder expires and yields to the waiter", async () => {
  const home = mkdtempSync(join(tmpdir(), "cf-dead-lock-"));
  await mkdir(join(home, ".harness"), { recursive: true });
  const lockPath = join(home, ".harness", "context-fill.json.lock");
  await writeAtomicJson(lockPath, {
    schema: CONTEXT_FILL_LOCK_SCHEMA,
    token: "dead-token",
    pid: 65_534,
    startedAt: new Date(1_000_000).toISOString()
  }, { createExclusive: true });

  const result = await mutateContextFillState(home, (state) => {
    state.projects.recovered = { ok: true };
    return "recovered";
  }, {
    now: () => 1_000_000 + 60_000,
    isPidAlive: () => false,
    pid: 333,
    retries: 4,
    retryMs: 5,
    staleAfterMs: 50
  });
  assert.equal(result, "recovered");
  const state = await readContextFillState(home);
  assert.equal(state.projects.recovered?.ok, true);
});

test("contended mutators serialize: waiter succeeds after live owner releases", async () => {
  const home = mkdtempSync(join(tmpdir(), "cf-contend-"));
  let releaseHold;
  const hold = new Promise((resolve) => {
    releaseHold = resolve;
  });
  let enteredMutator;
  const entered = new Promise((resolve) => {
    enteredMutator = resolve;
  });

  const owner = mutateContextFillState(home, async (state) => {
    state.projects.seq = ["owner"];
    enteredMutator();
    await hold;
    return "owner";
  }, { retries: 40, retryMs: 10 });

  await entered;
  const waiterPromise = mutateContextFillState(home, (state) => {
    const seq = state.projects.seq ?? [];
    seq.push("waiter");
    state.projects.seq = seq;
    return "waiter";
  }, { retries: 40, retryMs: 10 });

  await new Promise((r) => setTimeout(r, 30));
  releaseHold();
  assert.deepEqual(await Promise.all([owner, waiterPromise]), ["owner", "waiter"]);
  const state = await readContextFillState(home);
  assert.deepEqual(state.projects.seq, ["owner", "waiter"]);
});
