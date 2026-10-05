import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adapterMark,
  claimVisibleNotice,
  engramObservation,
  fillFingerprint,
  formatHookOutput,
  installContextFillHooks,
  payloadCwd,
  readCachedReport,
  recordContextFill,
  reminderFor,
  runtimeAdapter
} from "../src/global/observability/context-fill-hook.js";
import { execFileSync } from "node:child_process";
import { handoffDir, handoffMarkdown, writeSessionHandoff } from "../src/global/observability/context-fill-handoff.js";
import { loadCheckpoint, writeCheckpoint } from "../src/global/observability/context-fill-checkpoint.js";

function report(cwd = "/work/demo") {
  return {
    cwd,
    readings: [
      { adapter: "codex", status: "measured", used: 160000, limit: 200000, ratio: 0.8, band: "saturated" },
      { adapter: "claude", status: "tokens_only", used: 10, limit: null, ratio: null, band: "unknown" },
      { adapter: "cursor", status: "unavailable", used: null, limit: null, ratio: null, band: "unknown" }
    ]
  };
}

test("hook output names only the tool that is actually full", () => {
  const filled = report();
  assert.match(reminderFor("codex", filled), /80%/);
  assert.equal(reminderFor("cursor", filled), null);
  assert.equal(formatHookOutput("cursor", null).continue, true);
  assert.equal(formatHookOutput("cursor", null).additional_context, undefined);
  const codex = formatHookOutput("codex", reminderFor("codex", filled), { announce: true });
  assert.equal(codex.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(codex.hookSpecificOutput.additionalContext, /80%/);
  assert.match(codex.systemMessage, /80%/);
  const cursor = formatHookOutput("cursor", "aviso", { announce: true });
  assert.equal(cursor.continue, true);
  assert.equal(cursor.additional_context, "aviso");
  assert.equal(cursor.user_message, undefined);
});

test("engram note avoids pretending every tool shares one percentage", () => {
  const observation = engramObservation(report());
  assert.match(observation.content, /codex 80%/);
  assert.match(observation.content, /OpenCode counters accumulate/);
  assert.equal(observation.content.includes("/work/demo"), false);
  assert.equal(fillFingerprint(report()), "codex:80:saturated");
  assert.equal(payloadCwd({ cwd: "/work/demo" }), "/work/demo");
  assert.equal(runtimeAdapter("claude", { hook_event_name: "beforeSubmitPrompt", cursor_version: "3" }), "cursor");
  assert.equal(runtimeAdapter("claude", { hook_event_name: "UserPromptSubmit" }), "claude");
  assert.equal(adapterMark("codex", report()), "codex:80:saturated");
});

test("a repeated fill is cached and remembered once", async () => {
  const home = mkdtempSync(join(tmpdir(), "context-hook-"));
  const saves = [];
  const cachedReport = report();
  cachedReport.readings[2] = { adapter: "cursor", status: "measured", used: null, limit: null, ratio: 0.2, band: "comfortable" };
  await recordContextFill({
    homeDir: home,
    report: cachedReport,
    saveEngram: async (observation) => {
      saves.push(observation.title);
      return true;
    }
  });
  await recordContextFill({
    homeDir: home,
    report: cachedReport,
    now: Date.now() + 1000,
    saveEngram: async () => {
      saves.push("again");
      return true;
    }
  });
  assert.deepEqual(saves, ["Context fill work/demo"]);
  const cached = await readCachedReport(home, "/work/demo");
  assert.equal(cached.readings[0].band, "saturated");
});

test("install adds one hook per tool and does not repeat it", async () => {
  const home = mkdtempSync(join(tmpdir(), "context-install-"));
  await mkdir(join(home, ".cursor"), { recursive: true });
  await mkdir(join(home, ".claude"), { recursive: true });
  await mkdir(join(home, ".codex"), { recursive: true });
  await writeFile(join(home, ".cursor", "hooks.json"), JSON.stringify({ version: 1, hooks: { beforeSubmitPrompt: [{ command: "keep" }] } }));
  await writeFile(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { UserPromptSubmit: [] } }));
  await writeFile(join(home, ".codex", "hooks.json"), JSON.stringify({ hooks: {} }));
  const commands = {
    cursor: "node context-fill-hook.js cursor",
    claude: "node context-fill-hook.js claude",
    codex: "node context-fill-hook.js codex"
  };
  assert.deepEqual(await installContextFillHooks({ homeDir: home, commands }), [
    "cursor", "claude", "codex", "cursor-session", "claude-session", "codex-session"
  ]);
  assert.deepEqual(await installContextFillHooks({ homeDir: home, commands }), []);
  const cursor = JSON.parse(await readFile(join(home, ".cursor", "hooks.json"), "utf8"));
  assert.equal(cursor.hooks.beforeSubmitPrompt[0].command, "keep");
  assert.match(cursor.hooks.beforeSubmitPrompt[1].command, /cursor$/);
  const claude = JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"));
  assert.match(claude.hooks.UserPromptSubmit[0].hooks[0].command, /claude$/);
});

test("the visible notice is claimed once and the backup is global", async () => {
  const home = mkdtempSync(join(tmpdir(), "context-notice-"));
  const repo = mkdtempSync(join(tmpdir(), "context-repo-"));
  const filled = report(repo);
  const mark = adapterMark("codex", filled);
  assert.equal(await claimVisibleNotice(home, repo, "codex", mark), true);
  assert.equal(await claimVisibleNotice(home, repo, "codex", mark), false);
  await recordContextFill({ homeDir: home, report: filled, saveEngram: async () => false });
  const state = JSON.parse(await readFile(join(home, ".harness", "context-fill.json"), "utf8"));
  const entry = Object.values(state.projects)[0];
  assert.equal(entry.announced.codex, mark);
  const latest = await writeSessionHandoff({
    homeDir: home,
    cwd: repo,
    report: filled,
    adapter: "codex",
    prompt: "sigue el handoff"
  });
  assert.equal(latest, join(handoffDir(home, repo), "latest.md"));
  const body = await readFile(latest, "utf8");
  assert.match(body, /codex: 80%/);
  assert.match(body, /sigue el handoff/);
  assert.equal(body.includes(join(repo, "handoff.md")), false);
  assert.match(handoffMarkdown(filled, "codex"), /Disparado por: codex/);
});

test("checkpoint comes from git and the next session can load it", async () => {
  const home = mkdtempSync(join(tmpdir(), "context-git-home-"));
  const repo = mkdtempSync(join(tmpdir(), "context-git-repo-"));
  execFileSync("git", ["init"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "checkpoint@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "checkpoint"], { cwd: repo });
  await writeFile(join(repo, "readme.txt"), "one\n");
  execFileSync("git", ["add", "readme.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "add readme"], { cwd: repo });
  await writeFile(join(repo, "pending.txt"), "todo\n");
  const filled = report(repo);
  const path = await writeCheckpoint({
    homeDir: home,
    cwd: repo,
    report: filled,
    adapter: "codex",
    prompt: "cierra la unidad",
    decisions: "El checkpoint vive fuera del repo."
  });
  const body = await readFile(path, "utf8");
  assert.match(body, /add readme/);
  assert.match(body, /pending\.txt/);
  assert.match(body, /El checkpoint vive fuera del repo/);
  assert.equal(body.includes("cierra la unidad"), false);
  const loaded = await loadCheckpoint(home, repo);
  assert.match(loaded, /Continúa el trabajo pendiente/);
  assert.equal(loaded.includes("otro chat"), false);
  assert.match(loaded, /gana git/);
  assert.match(loaded, /add readme/);
});
