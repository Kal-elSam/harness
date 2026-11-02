import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../src/cli.js";
import { runObsidianCli } from "../src/global/obsidian-command.js";

async function setup() {
  const base = await mkdtemp(join(tmpdir(), "kairo-obs-"));
  const home = join(base, "home");
  const vault = join(base, "vault");
  await mkdir(home, { recursive: true });
  await mkdir(vault, { recursive: true });
  const out = [];
  const exit = { code: 0 };
  const deps = {
    env: { HARNESS_HOME: home },
    print: (line) => out.push(String(line)),
    setExitCode: (c) => { exit.code = c; },
    loadEngramExport: async () => ({
      decisions: [
        { id: "d1", title: "Use Postgres", body: "Chosen", project: "alpha" },
        { id: "d2", title: "Cache Layer", body: "Redis", project: "beta" }
      ]
    }),
    loadGraphifyExport: async () => ({
      architecture: [{ id: "a1", title: "Core", detail: "Kernel", project: "alpha" }]
    }),
    now: () => "2026-10-29T00:00:00.000Z"
  };
  return { base, home, vault, out, exit, deps };
}
const run = (action, extra, deps) =>
  runObsidianCli({ obsidianAction: action, json: false, ...extra }, deps);

test("parseArgs: obsidian actions and --vault", () => {
  const p = parseArgs(["obsidian", "config", "--vault", "/x/y"]);
  assert.equal(p.command, "obsidian");
  assert.equal(p.options.obsidianAction, "config");
  assert.equal(p.options.obsidianVault, "/x/y");
  assert.equal(parseArgs(["obsidian"]).options.obsidianAction, "status");
  assert.equal(parseArgs(["obsidian", "publish", "--yes"]).options.yes, true);
  assert.throws(() => parseArgs(["obsidian", "nope"]), /Unknown obsidian action/);
});

test("config persists the vault under HARNESS_HOME and rejects relative or missing paths", async () => {
  const s = await setup();
  try {
    await assert.rejects(() => run("config", { obsidianVault: "relative/dir" }, s.deps), /absolute/);
    await assert.rejects(() => run("config", { obsidianVault: join(s.base, "missing") }, s.deps), /does not exist/);
    assert.deepEqual(await readdir(s.home), [], "nothing persisted on rejection");
    await run("config", { obsidianVault: s.vault }, s.deps);
    const saved = JSON.parse(await readFile(join(s.home, ".harness", "obsidian.json"), "utf8"));
    assert.equal(saved.vaultPath, s.vault);
    assert.match(s.out.join("\n"), new RegExp(s.vault.replace(/[/\\]/g, ".")));
    s.out.length = 0;
    await run("config", {}, s.deps);
    assert.match(s.out.join("\n"), /vault: /);
  } finally { await rm(s.base, { recursive: true, force: true }); }
});

test("config refuses a symlinked vault root", async () => {
  const s = await setup();
  try {
    const link = join(s.base, "link");
    await symlink(s.vault, link);
    await assert.rejects(() => run("config", { obsidianVault: link }, s.deps), /symlink/);
  } finally { await rm(s.base, { recursive: true, force: true }); }
});

test("status: unconfigured is reported, configured prints a compact summary and --json", async () => {
  const s = await setup();
  try {
    await run("status", {}, s.deps);
    assert.match(s.out.join("\n"), /unconfigured/);
    assert.equal(s.exit.code, 0);
    await run("config", { obsidianVault: s.vault }, s.deps);
    s.out.length = 0;
    await run("status", {}, s.deps);
    assert.match(s.out.join("\n"), /state: partial/);
    assert.match(s.out.join("\n"), /notes: 0/);
    s.out.length = 0;
    await run("status", { json: true }, s.deps);
    const json = JSON.parse(s.out.join("\n"));
    assert.equal(json.state, "partial");
    assert.equal(json.vaultPath, await realpath(s.vault));
  } finally { await rm(s.base, { recursive: true, force: true }); }
});

test("publish requires a configured vault", async () => {
  const s = await setup();
  try {
    await assert.rejects(() => run("publish", { yes: true }, s.deps), /not configured/);
  } finally { await rm(s.base, { recursive: true, force: true }); }
});

test("publish is a dry run without --yes: writes nothing, says how to apply", async () => {
  const s = await setup();
  try {
    await run("config", { obsidianVault: s.vault }, s.deps);
    s.out.length = 0;
    await run("publish", {}, s.deps);
    assert.deepEqual(await readdir(s.vault), [], "vault untouched");
    const text = s.out.join("\n");
    assert.match(text, /dry run/i);
    assert.match(text, /--yes/);
    assert.match(text, /decisions\/use-postgres\.md/);
    assert.match(text, /Home\.md/);
    assert.equal(s.exit.code, 0);
  } finally { await rm(s.base, { recursive: true, force: true }); }
});

test("publish --yes writes project notes, hubs and Home; second run skips everything", async () => {
  const s = await setup();
  try {
    await run("config", { obsidianVault: s.vault }, s.deps);
    await mkdir(join(s.vault, ".obsidian"), { recursive: true });
    await writeFile(join(s.vault, ".obsidian", "app.json"), "{}", "utf8");
    await writeFile(join(s.vault, "mine.md"), "# mine\n", "utf8");
    await run("publish", { yes: true }, s.deps);
    const k = join(s.vault, "Kairo");
    const pg = await readFile(join(k, "decisions", "use-postgres.md"), "utf8");
    assert.match(pg, /project: "alpha"/);
    assert.match(pg, /kairo_sha256: "[0-9a-f]{64}"/);
    const hubAlpha = await readFile(join(k, "projects", "alpha.md"), "utf8");
    assert.match(hubAlpha, /\[\[decisions\/use-postgres\|Use Postgres\]\]/);
    assert.match(hubAlpha, /\[\[architecture\/core\|Core\]\]/);
    const home = await readFile(join(k, "Home.md"), "utf8");
    assert.match(home, /\[\[projects\/alpha\|alpha\]\]/);
    assert.match(home, /\[\[projects\/beta\|beta\]\]/);
    assert.equal(await readFile(join(s.vault, "mine.md"), "utf8"), "# mine\n");
    assert.equal(await readFile(join(s.vault, ".obsidian", "app.json"), "utf8"), "{}");
    const saved = JSON.parse(await readFile(join(s.home, ".harness", "obsidian.json"), "utf8"));
    assert.equal(saved.lastPublishAt, "2026-10-29T00:00:00.000Z");

    s.out.length = 0;
    await run("publish", { yes: true, json: true }, s.deps);
    const again = JSON.parse(s.out.join("\n"));
    assert.equal(again.state, "noop");
    assert.ok(again.results.every((r) => r.action === "skip"));
  } finally { await rm(s.base, { recursive: true, force: true }); }
});

test("publish refuses an edited managed note and leaves it untouched", async () => {
  const s = await setup();
  try {
    await run("config", { obsidianVault: s.vault }, s.deps);
    await run("publish", { yes: true }, s.deps);
    const file = join(s.vault, "Kairo", "decisions", "use-postgres.md");
    const mine = (await readFile(file, "utf8")).replace("Chosen", "I rewrote this");
    await writeFile(file, mine, "utf8");
    s.deps.loadEngramExport = async () => ({
      decisions: [{ id: "d1", title: "Use Postgres", body: "Changed upstream", project: "alpha" }]
    });
    s.out.length = 0;
    await run("publish", { yes: true, json: true }, s.deps);
    const res = JSON.parse(s.out.join("\n"));
    const r = res.results.find((x) => x.relativePath === "decisions/use-postgres.md");
    assert.equal(r.action, "refuse");
    assert.match(r.reason, /modified since last publish/);
    assert.equal(await readFile(file, "utf8"), mine);
    const backups = await readdir(join(s.vault, "Kairo")).catch(() => []);
    assert.ok(!backups.includes(".kairo-backups"), "no backup for a refused note");
  } finally { await rm(s.base, { recursive: true, force: true }); }
});

test("publish with a missing default engram binary reports a typed diagnostic and writes nothing", async () => {
  const s = await setup();
  try {
    await run("config", { obsidianVault: s.vault }, s.deps);
    delete s.deps.loadEngramExport;
    delete s.deps.loadGraphifyExport;
    s.deps.cwd = s.base;
    s.deps.execFile = async () => {
      throw Object.assign(new Error("engram binary missing"), { code: "ENOENT" });
    };
    s.out.length = 0;
    await run("publish", { yes: true }, s.deps);
    assert.match(s.out.join("\n"), /engram export failed: binary_missing/);
    assert.deepEqual(await readdir(s.vault), []);
  } finally { await rm(s.base, { recursive: true, force: true }); }
});

test("--vault and --project stay obsidian-only; other commands parse as before", () => {
  assert.equal(parseArgs(["intelligence", "status"]).options.obsidianVault, null);
  assert.throws(() => parseArgs(["team", "show", "--vault", "x"]), /Unknown|unknown|Use/);
  assert.equal(parseArgs(["intelligence", "status", "--json"]).options.intelligenceAction, "status");
});
