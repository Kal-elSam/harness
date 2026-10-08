import test from "node:test";
import assert from "node:assert/strict";
import {
  createGuardedRunner, createRddModeReader, isReadOnlyGentleArgv, parseRddModeStatus, rddModeArgv
} from "../src/global/conversation/rdd-mode-reader.js";
import { createGentleReader } from "../src/global/conversation/gentle-reader.js";
import { createConversationService } from "../src/global/conversation/service.js";
import { createConversationOperations } from "../src/global/conversation/operations.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToolHandlers } from "../src/global/mcp/kairo-mcp.js";
import { GENTLE_230_BOOTSTRAP } from "../src/global/control-plane/review-status.js";

const BIN = "/opt/fake/gentle-ai";
const ROOT = "/p";

// Captured from the installed binary: `gentle-ai review mode status --cwd <repo> --json`.
const REAL_ON_DEFAULT = {
  schema: "gentle-ai.review-mode/v1",
  operation: "status",
  scope: "both",
  status: { schema: "gentle-ai.rdd-mode-status/v1", global: "", clone_local: "", effective: "on", source: "default" }
};
const variant = (status) => ({ ...REAL_ON_DEFAULT, status: { ...REAL_ON_DEFAULT.status, ...status } });

const ok = (payload) => ({ ok: true, payload, status: 0, error: null });

function rddHarness(run) {
  const calls = [];
  const runCommand = (args, options) => { calls.push({ args, options }); return run(args, options); };
  const read = createRddModeReader({ runCommand, env: {}, binaryPath: BIN });
  return { read, calls };
}

test("parses the exact captured JSON: on / default, unset scopes", () => {
  const out = parseRddModeStatus(REAL_ON_DEFAULT);
  assert.deepEqual(out, { ok: true, mode: "on", source: "default", global: null, cloneLocal: null });
});

test("parses variants: off/global, off/clone-local with global on", () => {
  assert.deepEqual(parseRddModeStatus(variant({ effective: "off", source: "global", global: "off" })),
    { ok: true, mode: "off", source: "global", global: "off", cloneLocal: null });
  assert.deepEqual(parseRddModeStatus(variant({ effective: "off", source: "clone-local", global: "on", clone_local: "off" })),
    { ok: true, mode: "off", source: "clone-local", global: "on", cloneLocal: "off" });
});

test("unknown or invalid effective values are unknown, never on", () => {
  for (const effective of ["", "maybe", "ON ", null, 1, undefined, "enabled", true]) {
    const out = parseRddModeStatus(variant({ effective }));
    assert.equal(out.ok, true);
    assert.equal(out.mode, "unknown", `effective=${JSON.stringify(effective)}`);
  }
  assert.equal(parseRddModeStatus(variant({ effective: "on", global: "weird", clone_local: 7 })).global, null);
});

test("wrong schema, wrong operation or missing status object is gentle_incompatible", () => {
  for (const payload of [
    { ...REAL_ON_DEFAULT, schema: "gentle-ai.review-mode/v2" },
    { ...REAL_ON_DEFAULT, operation: "enable" },
    variant({ schema: "other/v1" }),
    { schema: "gentle-ai.review-mode/v1", operation: "status" },
    { schema: "gentle-ai.review-mode/v1", operation: "status", status: [] },
    [], "text", null
  ]) {
    assert.deepEqual(parseRddModeStatus(payload), { ok: false, error: "gentle_incompatible" });
  }
});

test("reader runs exactly review mode status --cwd root --json, bounded and strict", async () => {
  const { read, calls } = rddHarness(() => ok(REAL_ON_DEFAULT));
  const out = await read({ projectRoot: ROOT });
  assert.deepEqual(out, { mode: "on", source: "default", global: null, cloneLocal: null, error: null });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["review", "mode", "status", "--cwd", ROOT, "--json"]);
  assert.deepEqual(calls[0].args, rddModeArgv(ROOT));
  assert.equal(calls[0].options.command, BIN);
  assert.equal(calls[0].options.strict, true);
  assert.ok(calls[0].options.timeoutMs > 0 && calls[0].options.timeoutMs <= 10_000);
});

test("off with its source is surfaced; global on + clone-local off is off", async () => {
  const { read } = rddHarness(() => ok(variant({ effective: "off", source: "clone-local", global: "on", clone_local: "off" })));
  const out = await read({ projectRoot: ROOT });
  assert.equal(out.mode, "off");
  assert.equal(out.source, "clone-local");
  assert.equal(out.cloneLocal, "off");
});

test("typed errors: binary missing, timeout, non-zero, unparseable, schema mismatch", async () => {
  const missing = createRddModeReader({
    runCommand: () => { throw new Error("must not run"); }, env: {}, resolveBinary: () => null
  });
  assert.deepEqual(await missing({ projectRoot: ROOT }), { mode: "unknown", source: null, global: null, cloneLocal: null, error: "gentle_binary_missing" });

  const cases = [
    [() => ({ ok: false, error: "spawnSync gentle-ai ETIMEDOUT", payload: null }), "gentle_timeout"],
    [() => ({ ok: false, error: "gentle_nonzero_status", payload: { x: 1 }, status: 2 }), "gentle_nonzero_status"],
    [() => ({ ok: false, error: "gentle_parse_failed", payload: null }), "gentle_parse_failed"],
    [() => ok({ schema: "nope" }), "gentle_incompatible"],
    [() => { throw new Error("kaboom /Users/x/secret"); }, "gentle_reader_failed"]
  ];
  for (const [run, error] of cases) {
    const out = await rddHarness(run).read({ projectRoot: ROOT });
    assert.equal(out.mode, "unknown");
    assert.equal(out.error, error);
    assert.equal(JSON.stringify(out).includes("/Users/x"), false);
  }
});

test("text-format output is not parsed: real runner turns it into gentle_parse_failed", async () => {
  const text = "receipt-driven development: on (decided by default)\n  global:      unset\n  clone-local: unset\n";
  const { runGentleCommand } = await import("../src/global/control-plane/gentle-adapters.js");
  const read = createRddModeReader({
    env: {}, binaryPath: BIN,
    runCommand: (args, options) => runGentleCommand(args, { ...options, spawn: () => ({ status: 0, stdout: text, stderr: "" }) })
  });
  assert.equal((await read({ projectRoot: ROOT })).error, "gentle_parse_failed");
  assert.equal((await read({ projectRoot: ROOT })).mode, "unknown");
});

test("allow-list: only the exact read-only mode status shape is accepted", () => {
  assert.equal(isReadOnlyGentleArgv(["review", "mode", "status", "--cwd", ROOT, "--json"]), true);
  const refused = [
    ["review", "mode", "enable", "--cwd", ROOT, "--json"],
    ["review", "mode", "disable", "--cwd", ROOT, "--json"],
    ["review", "mode", "disable", "--scope", "clone", "--cwd", ROOT],
    ["review", "mode", "enable", "--scope", "global"],
    ["review", "mode", "status", "--cwd", ROOT, "--json", "--scope", "global"],
    ["review", "mode", "status", "--cwd", ROOT, "--json", "--expected-revision", "3"],
    ["review", "mode", "status", "--cwd", ROOT, "--json", "extra"],
    ["review", "mode", "status", "--json", "--cwd", ROOT],
    ["review", "mode", "status", "--cwd", ROOT],
    ["review", "mode", "status", "--cwd", "", "--json"],
    ["review", "mode"],
    ["review", "mode", "status=enable", "--cwd", ROOT, "--json"],
    ["review", "start", "--cwd", ROOT],
    ["sdd", "mode", "status", "--cwd", ROOT, "--json"]
  ];
  for (const argv of refused) assert.equal(isReadOnlyGentleArgv(argv), false, argv.join(" "));
});

test("guarded runner never executes enable/disable or flagged status, and does not call the runner", () => {
  const seen = [];
  const run = createGuardedRunner((args) => { seen.push(args); return ok({}); });
  for (const argv of [
    ["review", "mode", "enable", "--cwd", ROOT, "--json"],
    ["review", "mode", "disable", "--cwd", ROOT, "--json"],
    ["review", "mode", "status", "--cwd", ROOT, "--json", "--scope", "global"],
    ["review", "mode", "status", "--cwd", ROOT, "--json", "--expected-revision", "1"]
  ]) {
    assert.deepEqual(run(argv, { command: BIN }), { ok: false, error: "gentle_incompatible", payload: null });
  }
  assert.equal(seen.length, 0);
  run(["review", "mode", "status", "--cwd", ROOT, "--json"], { command: BIN });
  assert.equal(seen.length, 1);
});

test("reader refuses a hostile project root that would smuggle a flag", async () => {
  const { read, calls } = rddHarness(() => ok(REAL_ON_DEFAULT));
  for (const projectRoot of ["", undefined, "--scope", "relative/path", null]) {
    const out = await read({ projectRoot });
    assert.equal(out.mode, "unknown");
    assert.equal(out.error, "gentle_incompatible");
  }
  assert.equal(calls.length, 0);
});

// --- wiring into the Gentle reader and projections ---

const STATUS = {
  schema: "gentle-ai.review-integration.status/v2",
  contract: "gentle-ai.review-integration/v2",
  action: "start",
  applicability: "required",
  next_transition: { kind: "execute", operation: "review.start" }
};
const availableProbe = async () => ({
  state: "available", contractCompatible: true, version: "2.3.0",
  evidence: [{ kind: "binary", path: BIN }, { kind: "bootstrap", command: GENTLE_230_BOOTSTRAP }]
});

test("gentle reader accepts a structured readRddMode result and keeps rddMode a string", async () => {
  const reader = createGentleReader({
    probe: availableProbe, runCommand: () => ok(STATUS),
    readRddMode: async () => ({ mode: "off", source: "global", global: "off", cloneLocal: null, error: null })
  });
  const out = await reader({ projectRoot: ROOT });
  assert.equal(out.rddMode, "off");
  assert.equal(out.rddSource, "global");
  assert.equal(out.rddError ?? null, null);
});

test("legacy string readRddMode fakes keep working; junk values are unknown", async () => {
  for (const [value, expected] of [["on", "on"], ["off", "off"], ["enabled", "unknown"], [42, "unknown"], [{ mode: "yes" }, "unknown"], [null, "unknown"]]) {
    const reader = createGentleReader({ probe: availableProbe, runCommand: () => ok(STATUS), readRddMode: async () => value });
    assert.equal((await reader({ projectRoot: ROOT })).rddMode, expected);
  }
});

test("a failed mode read keeps the status result and reports unknown with its typed error", async () => {
  const reader = createGentleReader({
    probe: availableProbe, runCommand: () => ok(STATUS),
    readRddMode: async () => ({ mode: "unknown", source: null, error: "gentle_timeout" })
  });
  const out = await reader({ projectRoot: ROOT });
  assert.equal(out.rddMode, "unknown");
  assert.equal(out.rddError, "gentle_timeout");
  assert.equal(out.error ?? null, null);
});

test("production default reads mode through the same injected runner: status call then mode call", async () => {
  const calls = [];
  const runCommand = (args) => {
    calls.push(args);
    return args[1] === "mode" ? ok(variant({ effective: "off", source: "global", global: "off" })) : ok(STATUS);
  };
  const reader = createGentleReader({ probe: availableProbe, runCommand, useProductionRddReader: true });
  const out = await reader({ projectRoot: ROOT });
  assert.equal(out.rddMode, "off");
  assert.equal(out.rddSource, "global");
  assert.deepEqual(calls.map((c) => c.slice(0, 3)), [["review", "status", "--cwd"], ["review", "mode", "status"]]);
});

test("injected fakes without readRddMode never run the production mode reader", async () => {
  const calls = [];
  const reader = createGentleReader({ probe: availableProbe, runCommand: (args) => { calls.push(args); return ok(STATUS); } });
  const out = await reader({ projectRoot: ROOT });
  assert.equal(out.rddMode, "unknown");
  assert.equal(calls.length, 1);
});

function serviceWith(runCommand, extra = {}) {
  return createConversationService({
    resolveRoot: async (cwd) => cwd,
    homeDir: "/home/t",
    gentle: { probe: availableProbe, runCommand, useProductionRddReader: true },
    readPlan: async () => ({ status: { taskId: "t-1" } }),
    readExecution: async () => ({ runId: "run_a", agentId: "codex" }),
    readRun: async () => ({ runId: "run_a", state: "completed", agentId: "codex" }),
    readRunEvents: async () => [{ type: "run.transcript", source: "codex", data: { text: "Done." } }],
    transitionStore: { read: async () => ({ state: "ok", entries: [] }), append: async () => ({ recorded: false }) },
    ...extra
  });
}

test("readTaskResult shows mode and source; a receipt is still never task approval", async () => {
  const runCommand = (args) => (args[1] === "mode"
    ? ok(variant({ effective: "off", source: "clone-local", global: "on", clone_local: "off" }))
    : ok({ ...STATUS, receipt: { id: "rcpt-1", status: "approved", gate: "pass" } }));
  const out = await serviceWith(runCommand).readTaskResult({ cwd: ROOT, taskId: "t-1" });
  assert.equal(out.gentle.rddMode, "off");
  assert.equal(out.gentle.rddSource, "clone-local");
  assert.equal(out.gentle.taskReview, "not_established");
  assert.equal(out.gentle.scope, "project_context");
});

test("mode unknown (mode call fails) is projected as unknown, never on", async () => {
  const runCommand = (args) => (args[1] === "mode" ? { ok: false, error: "gentle_parse_failed", payload: null } : ok(STATUS));
  const out = await serviceWith(runCommand).readTaskResult({ cwd: ROOT, taskId: "t-1" });
  assert.equal(out.gentle.rddMode, "unknown");
  assert.equal(out.gentle.rddSource, null);
  assert.equal(out.gentle.taskReview, "not_established");
});

test("operations projection carries rddMode/rddSource; hostile values are scrubbed", async () => {
  const runCommand = (args) => (args[1] === "mode" ? ok(variant({ effective: "on", source: "default" })) : ok(STATUS));
  const service = serviceWith(runCommand);
  const ops = createConversationOperations({ cwd: ROOT, getService: () => service });
  const out = await ops.taskResult({ taskId: "t-1" });
  assert.equal(out.gentle.rddMode, "on");
  assert.equal(out.gentle.rddSource, "default");
  assert.equal(out.gentle.taskReview, "not_established");

  const { pubTaskResult } = await import("../src/global/conversation/operations.js");
  const hostile = pubTaskResult({ taskId: "t-1", gentle: { state: "x", rddMode: "/Users/kal-el/secret", rddSource: "/Users/kal-el/secret" } });
  assert.equal(hostile.gentle.rddMode, "unknown");
  assert.equal(JSON.stringify(hostile).includes("/Users/kal-el"), false);
});

test("repeated reads launch nothing beyond the read-only commands and write nothing", async () => {
  const calls = [];
  const runCommand = (args) => { calls.push(args); return args[1] === "mode" ? ok(REAL_ON_DEFAULT) : ok(STATUS); };
  const service = serviceWith(runCommand);
  for (let i = 0; i < 3; i += 1) await service.readTaskResult({ cwd: ROOT, taskId: "t-1" });
  assert.equal(calls.length, 6);
  for (const args of calls) {
    assert.equal(isReadOnlyGentleArgv(args) || (args[0] === "review" && args[1] === "status"), true, args.join(" "));
    assert.equal(args.some((a) => /^(enable|disable|start|grant|--scope|--expected-revision)$/.test(a)), false);
  }
});

test("MCP kairo_task_result shows the mode and source and exposes no path", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kairo-rdd-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const calls = [];
  const runCommand = (args) => {
    calls.push(args);
    return args[1] === "mode" ? ok(variant({ effective: "off", source: "global", global: "off" })) : ok(STATUS);
  };
  const service = serviceWith(runCommand, { resolveRoot: async () => root });
  const mcp = createToolHandlers({
    workspaceBound: true, cwdExplicit: true, cwd: root, processCwd: root, userHome: realpathSync(mkdtempSync(join(tmpdir(), "kairo-rdd-home-"))), env: {},
    conversationService: service
  });
  const mcpRes = await mcp.kairo_task_result({ taskId: "t-1" });
  const viaMcp = mcpRes.structuredContent.data ?? assert.fail(JSON.stringify(mcpRes.structuredContent));
  assert.equal(viaMcp.gentle.rddMode, "off");
  assert.equal(viaMcp.gentle.rddSource, "global");
  assert.equal(viaMcp.gentle.taskReview, "not_established");
  assert.equal(JSON.stringify(viaMcp).includes(root), false);
});
