import test from "node:test";
import assert from "node:assert/strict";
import { createGentleReader } from "../src/global/conversation/gentle-reader.js";
import { createConversationService } from "../src/global/conversation/service.js";
import { PROVIDER } from "../src/global/control-plane/constants.js";
import { GENTLE_230_BOOTSTRAP } from "../src/global/control-plane/review-status.js";

const BIN = "/opt/fake/gentle-ai";
const FORBIDDEN = /\b(start|grant|decline|acknowledge|consent|disable|enable|abandon|invalidate|recover|capture|finalize)\b/;

const availableProbe = (extra = {}) => async () => ({
  state: "available", contractCompatible: true, version: "2.3.0",
  evidence: [{ kind: "binary", path: BIN }, { kind: "bootstrap", command: GENTLE_230_BOOTSTRAP }],
  ...extra
});

const STATUS = {
  schema: "gentle-ai.review-integration.status/v2",
  contract: "gentle-ai.review-integration/v2",
  action: "start",
  applicability: "required",
  next_transition: { kind: "execute", operation: "review.start" }
};

function harness({ probe = availableProbe(), run, readRddMode } = {}) {
  const calls = [];
  const runCommand = (args, options) => {
    calls.push({ args, options });
    return run ? run(args, options) : { ok: true, payload: STATUS, status: 0, error: null };
  };
  const reader = createGentleReader({ probe, runCommand, readRddMode });
  return { reader, calls };
}

test("connected Gentle: one read-only review status call, mapped status returned, rdd unknown by default", async () => {
  const { reader, calls } = harness();
  const out = await reader({ projectRoot: "/p" });
  assert.equal(out.provider, PROVIDER.CONNECTED);
  assert.equal(out.mappedStatus.ok, true);
  assert.equal(out.mappedStatus.nextTransition.kind, "execute");
  assert.equal(out.rddMode, "unknown");
  assert.equal(out.error ?? null, null);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 2), ["review", "status"]);
  assert.equal(calls[0].args.some((a) => FORBIDDEN.test(a)), false, "no mutating verb is ever passed");
  assert.equal(calls[0].options.command, BIN);
  assert.equal(calls[0].options.strict, true);
  assert.ok(calls[0].options.timeoutMs > 0 && calls[0].options.timeoutMs <= 10_000, "bounded");
});

test("rdd mode comes only from the injected read-only reader", async () => {
  const { reader } = harness({ readRddMode: async () => "on" });
  assert.equal((await reader({ projectRoot: "/p" })).rddMode, "on");
  const bad = harness({ readRddMode: async () => { throw new Error("boom"); } });
  assert.equal((await bad.reader({ projectRoot: "/p" })).rddMode, "unknown");
});

test("binary missing -> typed unavailable, status never run", async () => {
  const { reader, calls } = harness({ probe: async () => ({ state: "missing", evidence: [{ kind: "binary", path: null }] }) });
  const out = await reader({ projectRoot: "/p" });
  assert.equal(out.provider, PROVIDER.UNAVAILABLE);
  assert.equal(out.error, "gentle_binary_missing");
  assert.equal(calls.length, 0);
});

test("probe timeout -> typed unavailable gentle_timeout", async () => {
  const { reader, calls } = harness({
    probe: async () => ({ state: "error", error: "timeout", diagnostics: ["gentle-ai review capabilities timed out"], evidence: [] })
  });
  const out = await reader({ projectRoot: "/p" });
  assert.equal(out.provider, PROVIDER.UNAVAILABLE);
  assert.equal(out.error, "gentle_timeout");
  assert.equal(calls.length, 0);
});

test("incompatible contract -> provider incompatible, status never run", async () => {
  const { reader, calls } = harness({ probe: async () => ({ state: "incompatible", contractCompatible: false, evidence: [] }) });
  const out = await reader({ projectRoot: "/p" });
  assert.equal(out.provider, PROVIDER.INCOMPATIBLE);
  assert.equal(calls.length, 0);
});

test("non-zero exit -> typed error, no mapped status", async () => {
  const { reader } = harness({ run: () => ({ ok: false, error: "gentle_nonzero_status", payload: { x: 1 }, status: 2 }) });
  const out = await reader({ projectRoot: "/p" });
  assert.equal(out.error, "gentle_nonzero_status");
  assert.equal(out.mappedStatus ?? null, null);
  assert.equal(out.provider, PROVIDER.CONNECTED);
});

test("unparseable output -> typed gentle_parse_failed", async () => {
  const { reader } = harness({ run: () => ({ ok: false, error: "gentle_parse_failed", payload: null }) });
  assert.equal((await reader({ projectRoot: "/p" })).error, "gentle_parse_failed");
});

test("spawn timeout -> typed gentle_timeout", async () => {
  const { reader } = harness({ run: () => ({ ok: false, error: "spawnSync gentle-ai ETIMEDOUT", payload: null }) });
  assert.equal((await reader({ projectRoot: "/p" })).error, "gentle_timeout");
});

test("runner throwing is contained as typed unavailable", async () => {
  const { reader } = harness({ run: () => { throw new Error("kaboom /Users/x/secret"); } });
  const out = await reader({ projectRoot: "/p" });
  assert.equal(out.provider, PROVIDER.UNAVAILABLE);
  assert.equal(out.error, "gentle_reader_failed");
});

test("bootstrap that is not review status is refused before any process runs", async () => {
  const { reader, calls } = harness({
    probe: async () => ({
      state: "available", contractCompatible: true,
      evidence: [{ kind: "binary", path: BIN }, { kind: "bootstrap", command: "gentle-ai review start --cwd <repo>" }]
    })
  });
  const out = await reader({ projectRoot: "/p" });
  assert.equal(out.error, "gentle_incompatible");
  assert.equal(calls.length, 0);
});

test("service default reader is the real one (no gentle_reader_not_wired) and keeps task result honest on failure", async () => {
  const service = createConversationService({
    resolveRoot: async (cwd) => cwd,
    homeDir: "/home/t",
    gentle: { probe: async () => ({ state: "missing", evidence: [] }), runCommand: () => { throw new Error("must not run"); } },
    readPlan: async () => ({ status: { taskId: "t-1" } }),
    readExecution: async () => ({ runId: "run_a", agentId: "codex" }),
    readRun: async () => ({ runId: "run_a", state: "completed", agentId: "codex" }),
    readRunEvents: async () => [{ type: "run.transcript", source: "codex", data: { text: "Done." } }],
    transitionStore: { read: async () => ({ state: "ok", entries: [] }), append: async () => ({ recorded: false }) }
  });
  const out = await service.readTaskResult({ cwd: "/p", taskId: "t-1" });
  assert.equal(out.status, "terminal");
  assert.equal(out.gentle.state, "unavailable");
  assert.equal(out.gentle.reason, "gentle_binary_missing");
  assert.equal(out.gentle.taskReview, "not_established");
});

test("a project receipt is never read as approval of the task", async () => {
  const service = createConversationService({
    resolveRoot: async (cwd) => cwd,
    homeDir: "/home/t",
    gentle: {
      probe: availableProbe(),
      runCommand: () => ({ ok: true, status: 0, error: null, payload: { ...STATUS, receipt: { id: "rcpt-1", status: "approved", gate: "pass" } } }),
      readRddMode: async () => "on"
    },
    readPlan: async () => ({ status: { taskId: "t-1" } }),
    readExecution: async () => ({ runId: "run_a", agentId: "codex" }),
    readRun: async () => ({ runId: "run_a", state: "completed", agentId: "codex" }),
    readRunEvents: async () => [{ type: "run.transcript", source: "codex", data: { text: "Done." } }],
    transitionStore: { read: async () => ({ state: "ok", entries: [] }), append: async () => ({ recorded: false }) }
  });
  const out = await service.readTaskResult({ cwd: "/p", taskId: "t-1" });
  assert.equal(out.gentle.scope, "project_context");
  assert.equal(out.gentle.taskReview, "not_established");
});
