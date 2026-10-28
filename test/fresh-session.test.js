import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  DEFAULT_FRESH_SESSION_CONFIG,
  decideFreshSession,
  readFreshSessionConfig,
  resolveFreshSessionConfig,
  runFreshSessionDecision,
  suggestionMessage
} from "../src/global/session/fresh-session.js";

const scratch = [];
const tmp = () => { const dir = mkdtempSync(join(tmpdir(), "kairo-fresh-")); scratch.push(dir); return dir; };
after(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

const closed = { taskType: "feature", checkpointWritten: true, clean: true, contextPercent: 47, config: DEFAULT_FRESH_SESSION_CONFIG };

test("a small task (no feature document) never gets a suggestion", () => {
  assert.equal(decideFreshSession({ ...closed, taskType: "small", contextPercent: 99 }).suggest, false);
});

test("an investigation never gets an automatic suggestion", () => {
  assert.equal(decideFreshSession({ ...closed, taskType: "investigation", contextPercent: 99 }).suggest, false);
});

test("a feature below the threshold gets none", () => {
  assert.equal(decideFreshSession({ ...closed, contextPercent: 39 }).suggest, false);
});

test("a feature at or above the threshold with a clean tree and a saved checkpoint gets a suggestion", () => {
  assert.equal(decideFreshSession({ ...closed, contextPercent: 40 }).suggest, true);
  assert.equal(decideFreshSession({ ...closed, contextPercent: 47 }).suggest, true);
});

test("a dirty tree gets none", () => {
  assert.equal(decideFreshSession({ ...closed, clean: false }).suggest, false);
});

test("no new checkpoint gets none", () => {
  assert.equal(decideFreshSession({ ...closed, checkpointWritten: false }).suggest, false);
});

test("an unknown context fill gets none", () => {
  assert.equal(decideFreshSession({ ...closed, contextPercent: null }).suggest, false);
  assert.equal(decideFreshSession({ ...closed, contextPercent: undefined }).suggest, false);
});

test("a config override changes the threshold", () => {
  const { config } = resolveFreshSessionConfig({ feature: { contextPercent: 60 } });
  assert.equal(decideFreshSession({ ...closed, config, contextPercent: 47 }).suggest, false);
  assert.equal(decideFreshSession({ ...closed, config, contextPercent: 60 }).suggest, true);
});

test("enabled false turns the suggestion off", () => {
  const { config } = resolveFreshSessionConfig({ enabled: false });
  assert.equal(decideFreshSession({ ...closed, config }).suggest, false);
});

test("an invalid config falls back to the defaults with one warning", () => {
  for (const raw of ["x", [], { enabled: "yes" }, { feature: { contextPercent: 0 } }, { feature: { contextPercent: 101 } }, { feature: { contextPercent: "40" } }, { feature: 3 }]) {
    const result = resolveFreshSessionConfig(raw);
    assert.deepEqual(result.config, DEFAULT_FRESH_SESSION_CONFIG);
    assert.match(result.warning, /session\.freshSessionSuggest/);
  }
  assert.equal(resolveFreshSessionConfig(undefined).warning, null);
});

test("the message carries the context fill and both ways to restart", () => {
  const text = suggestionMessage(47);
  assert.match(text, /context 47%/);
  assert.match(text, /kairo continue/);
  assert.match(text, /\/kairo-continue/);
});

function deps(root, git = () => root) {
  const homeDir = tmp();
  const out = { err: "" };
  return { out, deps: { homeDir, env: {}, stderr: t => { out.err += t; }, git, fs: { readFileSync, writeFileSync, mkdirSync, readdirSync } } };
}

test("the config comes from .harness/kairo.json session.freshSessionSuggest", () => {
  const root = tmp();
  mkdirSync(join(root, ".harness"));
  writeFileSync(join(root, ".harness", "kairo.json"), JSON.stringify({ session: { freshSessionSuggest: { feature: { contextPercent: 70 } } } }));
  const { config, warning } = readFreshSessionConfig(deps(root).deps, root);
  assert.equal(config.feature.contextPercent, 70);
  assert.equal(warning, null);
});

test("a missing kairo.json gives the defaults without a warning; broken JSON warns", () => {
  const root = tmp();
  assert.deepEqual(readFreshSessionConfig(deps(root).deps, root), { config: DEFAULT_FRESH_SESSION_CONFIG, warning: null });
  mkdirSync(join(root, ".harness"));
  writeFileSync(join(root, ".harness", "kairo.json"), "{nope");
  const result = readFreshSessionConfig(deps(root).deps, root);
  assert.deepEqual(result.config, DEFAULT_FRESH_SESSION_CONFIG);
  assert.match(result.warning, /kairo\.json/);
});

const trigger = { written: true, clean: true, taskType: "feature", feature: "f", head: "abc1234" };

test("the decision command suggests once per HEAD and warns once about a bad config", () => {
  const root = tmp();
  mkdirSync(join(root, ".harness"));
  writeFileSync(join(root, ".harness", "kairo.json"), JSON.stringify({ session: { freshSessionSuggest: { enabled: 1 } } }));
  const d = deps(root);
  const first = runFreshSessionDecision({ ...trigger, contextPercent: 47 }, { cwd: root }, d.deps);
  assert.equal(first.suggest, true);
  assert.match(first.message, /context 47%/);
  assert.equal(d.out.err.split("\n").filter(Boolean).length, 1);
  const again = runFreshSessionDecision({ ...trigger, contextPercent: 47 }, { cwd: root }, d.deps);
  assert.equal(again.suggest, false);
  assert.match(again.reason, /already/);
  const next = runFreshSessionDecision({ ...trigger, head: "def5678", contextPercent: 47 }, { cwd: root }, d.deps);
  assert.equal(next.suggest, true);
});

test("a no-suggest decision leaves no marker, so the same HEAD can suggest later", () => {
  const root = tmp();
  const d = deps(root);
  assert.equal(runFreshSessionDecision({ ...trigger, contextPercent: 10 }, { cwd: root }, d.deps).suggest, false);
  assert.equal(runFreshSessionDecision({ ...trigger, contextPercent: 50 }, { cwd: root }, d.deps).suggest, true);
});

test("malformed input never throws and never suggests", () => {
  const root = tmp();
  const d = deps(root);
  for (const input of [null, undefined, "x", {}, { head: 3 }]) {
    assert.equal(runFreshSessionDecision(input, { cwd: root }, d.deps).suggest, false);
  }
});

test("from a subdirectory the root config and the root marker apply", () => {
  const root = tmp();
  const sub = join(root, "src");
  mkdirSync(sub);
  mkdirSync(join(root, ".harness"));
  const git = (args, cwd) => { if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return root; throw new Error("unexpected git"); };
  const input = { ...trigger, contextPercent: 50 };
  writeFileSync(join(root, ".harness", "kairo.json"), JSON.stringify({ session: { freshSessionSuggest: { enabled: false } } }));
  assert.equal(runFreshSessionDecision(input, { cwd: sub }, deps(root, git).deps).suggest, false);
  writeFileSync(join(root, ".harness", "kairo.json"), "{}");
  const d = deps(root, git);
  assert.equal(runFreshSessionDecision(input, { cwd: sub }, d.deps).suggest, true);
  assert.equal(runFreshSessionDecision(input, { cwd: root }, { ...d.deps, homeDir: d.deps.homeDir }).suggest, false);
});

test("the marker is created exclusively: an existing marker for the HEAD means already suggested", () => {
  const root = tmp();
  const d = deps(root);
  const input = { ...trigger, contextPercent: 50 };
  assert.equal(runFreshSessionDecision(input, { cwd: root }, d.deps).suggest, true);
  const racing = { ...d.deps, fs: { ...d.deps.fs, readFileSync: () => { throw new Error("no read expected"); } } };
  assert.match(runFreshSessionDecision(input, { cwd: root }, racing).reason, /already/);
});
