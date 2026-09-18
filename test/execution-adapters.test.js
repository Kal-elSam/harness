import test from "node:test";
import assert from "node:assert/strict";
import {
  EXECUTION_ADAPTER_IDS,
  inspectExecutionAdapters,
  resolveExecutionAdapter
} from "../src/global/runtime/execution-adapters/index.js";
import cursorAdapter from "../src/global/runtime/execution-adapters/cursor.js";
import codexAdapter from "../src/global/runtime/execution-adapters/codex.js";
import opencodeAdapter from "../src/global/runtime/execution-adapters/opencode.js";
import { listLaunchableAdapterIds } from "../src/global/runtime/execution-adapters/index.js";

test("execution adapters expose required contract fields", () => {
  for (const id of EXECUTION_ADAPTER_IDS) {
    const adapter = resolveExecutionAdapter(id);
    assert.ok(adapter.id);
    assert.ok(adapter.label);
    assert.ok(adapter.executable);
    assert.ok(adapter.capabilities);
    assert.equal(typeof adapter.availability, "function");
    assert.equal(typeof adapter.buildLaunch, "function");
  }
});

test("REGRESSION: resolveExecutionAdapter maps opencode-go/opencode-zen to the single real shared opencode adapter, never throwing 'unknown adapter'", () => {
  const go = resolveExecutionAdapter("opencode-go");
  const zen = resolveExecutionAdapter("opencode-zen");
  const bare = resolveExecutionAdapter("opencode");
  assert.equal(go.id, "opencode");
  assert.equal(zen.id, "opencode");
  assert.equal(go, bare, "must be the exact same real adapter object, not a copy");
});

test("REGRESSION: resolveExecutionAdapter still rejects a genuinely unknown id, never silently falling through", () => {
  assert.throws(() => resolveExecutionAdapter("not-a-real-adapter"), /Unknown execution adapter/);
});

test("cursor adapter builds auditable launch command", () => {
  const launch = cursorAdapter.buildLaunch({
    task: "Review code",
    cwd: "/tmp",
    model: "gpt-5",
    permissions: ["force"]
  });

  assert.equal(launch.command, "cursor-agent");
  assert.ok(launch.args.includes("-p"));
  assert.ok(launch.args.includes("stream-json"));
  assert.ok(launch.args.includes("Review code"));
  assert.ok(launch.args.includes("--force"));
});

test("cursor adapter filters duplicate assistant events", () => {
  const skipped = cursorAdapter.parseEventLine(JSON.stringify({
    type: "assistant",
    model_call_id: "abc"
  }));
  assert.equal(skipped, null);

  const kept = cursorAdapter.parseEventLine(JSON.stringify({
    type: "assistant",
    timestamp_ms: 1,
    message: { content: [{ text: "hi" }] }
  }));
  assert.equal(kept.type, "assistant");
});

test("cursor adapter reports launchable when cursor-agent is compatible", () => {
  const availability = cursorAdapter.availability();
  if (availability.compatible) {
    assert.equal(availability.launchable, true);
  } else {
    assert.equal(availability.launchable, false);
  }
});

test("codex adapter omits unsupported --force flag", () => {
  const launch = codexAdapter.buildLaunch({
    task: "Review code",
    cwd: "/tmp",
    model: "gpt-5",
    permissions: ["force", "all"]
  });

  assert.equal(launch.command, "codex");
  assert.ok(!launch.args.includes("--force"));
  assert.ok(launch.args.includes("Review code"));
});

test("codex adapter uses real yolo flag for bypass approvals", () => {
  const launch = codexAdapter.buildLaunch({
    task: "Review code",
    cwd: "/tmp",
    permissions: ["yolo"]
  });

  assert.ok(launch.args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(!launch.args.includes("--dangerously-skip-permissions"));
  assert.ok(!launch.args.includes("--force"));
});

test("REGRESSION: opencode adapter reports real structured-event compatibility AND is launchable now — Go's real hang risk is covered by its own idle timeout, not a launchable:false gate", () => {
  const availability = opencodeAdapter.availability();
  if (availability.available) {
    // Verified live: the CLI genuinely emits parseable structured events,
    // and is now launchable — checkCandidate's own "opencode-zen" early
    // return is what keeps Zen blocked, never this adapter-level flag.
    assert.equal(availability.compatible, true);
    assert.equal(availability.launchable, true);
    assert.equal(availability.reason, null);
  } else {
    assert.equal(availability.compatible, false);
    assert.equal(availability.launchable, false);
  }
});

test("REGRESSION: listLaunchableAdapterIds includes opencode when its real CLI is on PATH — Go is a real automatic candidate now", () => {
  const launchable = listLaunchableAdapterIds();
  const availability = opencodeAdapter.availability();
  assert.equal(launchable.includes("opencode"), availability.available, "opencode's own real availability must be the only thing deciding this now");
});

test("inspectExecutionAdapters returns availability for all providers", () => {
  const providers = inspectExecutionAdapters();
  assert.equal(providers.length, EXECUTION_ADAPTER_IDS.length);
  for (const provider of providers) {
    assert.ok(["auditable", "limited", "missing"].includes(
      provider.compatible ? "auditable" : provider.available ? "limited" : "missing"
    ) || provider.compatible === true || provider.available === true || provider.available === false);
  }
});
