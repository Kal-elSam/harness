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
