/**
 * U5b: Ops mutation adapters — sync/rollback/runs/alerts/reviews via existing
 * governance + runtime helpers. Fail-closed; no new stores.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyOpsRollback,
  applyOpsSync,
  cancelOpsRun,
  dismissOpsAlert,
  listOpsAlerts,
  listOpsReviews,
  listOpsRuns,
  previewOpsRollback,
  previewOpsSync,
  showOpsReview,
  showOpsRun
} from "../src/global/host/ops-mutations.js";

test("previewOpsSync forwards to governance preview and returns fingerprint", async () => {
  const calls = [];
  const preview = await previewOpsSync({
    homeDir: "/tmp/h",
    workspaceRoot: "/tmp/w",
    packageName: "@test/pkg",
    packageRoot: "/tmp/p",
    cliVersion: "0.0.0-test",
    previewSync: async (opts) => {
      calls.push(opts);
      return {
        kind: "sync",
        hasChanges: true,
        fingerprint: "fp-sync-1",
        changes: [{ action: "write", target: "~/.cursor/AGENTS.md" }],
        wrote: false
      };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].homeDir, "/tmp/h");
  assert.equal(preview.ok, true);
  assert.equal(preview.fingerprint, "fp-sync-1");
  assert.equal(preview.hasChanges, true);
});

test("applyOpsSync refuses missing preview fingerprint (fail-closed)", async () => {
  const result = await applyOpsSync({
    preview: { hasChanges: true },
    applySync: async () => {
      throw new Error("must not apply");
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing-preview");
  assert.equal(result.wrote, false);
});

test("applyOpsSync forwards confirmed preview to governance apply", async () => {
  const preview = { fingerprint: "fp", hasChanges: true, kind: "sync" };
  const result = await applyOpsSync({
    preview,
    homeDir: "/tmp/h",
    cliVersion: "1.0.0",
    applySync: async (args) => {
      assert.equal(args.preview.fingerprint, "fp");
      return { ok: true, reason: "repaired", wrote: true, receipt: { action: "repaired" } };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.wrote, true);
  assert.equal(result.receipt.action, "repaired");
});

test("previewOpsRollback and applyOpsRollback reuse governance rollback", async () => {
  const preview = await previewOpsRollback({
    homeDir: "/tmp/h",
    snapshot: "snap-1",
    previewRollback: async ({ snapshot }) => ({
      kind: "rollback",
      snapshot,
      fingerprint: "fp-rb",
      noop: false,
      files: [{ displayPath: "~/.cursor/AGENTS.md" }],
      wrote: false
    })
  });
  assert.equal(preview.ok, true);
  assert.equal(preview.fingerprint, "fp-rb");

  const applied = await applyOpsRollback({
    preview,
    homeDir: "/tmp/h",
    cliVersion: "1.0.0",
    applyRollback: async (args) => {
      assert.equal(args.preview.fingerprint, "fp-rb");
      return {
        ok: true,
        reason: "applied",
        wrote: true,
        receipt: { action: "rollback", snapshot: "snap-1" }
      };
    }
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.receipt.action, "rollback");
});

test("listOpsRuns fail-closed on dashboard error; cancelOpsRun requires runId", async () => {
  const empty = await listOpsRuns({
    buildDashboard: async () => {
      throw new Error("dash down");
    }
  });
  assert.equal(empty.ok, false);
  assert.deepEqual(empty.runs, []);
  assert.match(empty.error, /dash down/);

  const listed = await listOpsRuns({
    buildDashboard: async () => ({
      activeRuns: [{ runId: "run-1", state: "running", agentId: "codex" }],
      recentRuns: [{ runId: "run-2", state: "succeeded", agentId: "claude" }]
    })
  });
  assert.equal(listed.ok, true);
  assert.equal(listed.runs.length, 2);
  assert.equal(listed.runs[0].cancellable, true);
  assert.equal(listed.runs[1].cancellable, false);

  const refused = await cancelOpsRun({
    runId: "",
    stop: async () => {
      throw new Error("must not stop");
    }
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "missing-runId");

  const cancelled = await cancelOpsRun({
    homeDir: "/tmp/h",
    runId: "run-1",
    stop: async (homeDir, runId) => {
      assert.equal(homeDir, "/tmp/h");
      assert.equal(runId, "run-1");
      return { runId, state: "cancelled" };
    }
  });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.runId, "run-1");
});

test("dismissOpsAlert requires confirmed:true and uses cockpit source", async () => {
  const refused = await dismissOpsAlert({
    alertId: "alt-aaaaaaaaaaaaaaaa",
    confirmed: false,
    dismiss: async () => {
      throw new Error("must not dismiss");
    }
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "confirm-required");

  const calls = [];
  const ok = await dismissOpsAlert({
    alertId: "alt-aaaaaaaaaaaaaaaa",
    confirmed: true,
    homeDir: "/tmp/h",
    dismiss: async (args) => {
      calls.push(args);
      return { ok: true, code: "ok", alert: { alertId: args.alertId, state: "dismissed" } };
    }
  });
  assert.equal(ok.ok, true);
  assert.equal(calls[0].confirmed, true);
  assert.equal(calls[0].source, "cockpit");
  assert.equal(calls[0].alertId, "alt-aaaaaaaaaaaaaaaa");
});

test("listOpsAlerts and listOpsReviews fail-closed to empty arrays", async () => {
  const alerts = await listOpsAlerts({
    listAlerts: async () => {
      throw new Error("alerts missing");
    }
  });
  assert.equal(alerts.ok, false);
  assert.deepEqual(alerts.alerts, []);

  const reviews = await listOpsReviews({
    listReviews: async () => {
      throw new Error("reviews missing");
    }
  });
  assert.equal(reviews.ok, false);
  assert.deepEqual(reviews.reviews, []);

  const good = await listOpsReviews({
    listReviews: async () => [{ reviewId: "rev-1", state: "pass" }]
  });
  assert.equal(good.ok, true);
  assert.equal(good.reviews[0].reviewId, "rev-1");
});

const GOOD_RUN_ID = "run_abc123_x1y2z3";
const GOOD_REVIEW_ID = "rev-0123456789abcdef0123";

test("showOpsRun returns redacted, bounded detail without task text", async () => {
  const events = Array.from({ length: 5 }, (_, i) => ({
    timestamp: `2026-01-01T00:00:0${i}Z`,
    type: "process.stdout",
    data: { line: i === 4 ? "sk-abcdefghijklmnop" : `line ${i}`, prompt: "SECRET PROMPT" }
  }));
  events.splice(2, 0, { parseError: true, line: 3, message: "bad json" });
  const seen = {};
  const result = await showOpsRun({
    homeDir: "/tmp/h",
    runId: GOOD_RUN_ID,
    eventLimit: 3,
    readState: async (home, id) => {
      seen.state = [home, id];
      return {
        runId: id,
        agentId: "cursor",
        provider: "cursor",
        model: null,
        state: "completed",
        taskDigest: "abcd1234abcd1234",
        taskLength: 42,
        task: "RAW TASK TEXT",
        startedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:01:00Z",
        error: null,
        env: { OPENAI_API_KEY: "sk-leak" }
      };
    },
    readEvents: async (home, id, opts) => {
      seen.events = opts;
      return events;
    }
  });
  assert.deepEqual(seen.state, ["/tmp/h", GOOD_RUN_ID]);
  assert.equal(result.ok, true);
  assert.equal(result.run.runId, GOOD_RUN_ID);
  assert.equal(result.run.state, "completed");
  assert.equal(result.run.taskDigest, "abcd1234abcd1234");
  assert.equal(result.run.taskLength, 42);
  assert.equal(result.events.length, 3);
  assert.equal(result.eventsTruncated, true);
  const wire = JSON.stringify(result);
  assert.ok(!wire.includes("SECRET PROMPT"));
  assert.ok(!wire.includes("RAW TASK TEXT"));
  assert.ok(!wire.includes("sk-abcdefghijklmnop"));
  assert.ok(!wire.includes("sk-leak"));
  assert.ok(result.events.some((e) => e.summary === "[REDACTED]"));
});

test("showOpsRun reports parse errors in events without crashing", async () => {
  const result = await showOpsRun({
    homeDir: "/tmp/h",
    runId: GOOD_RUN_ID,
    readState: async () => ({ runId: GOOD_RUN_ID, state: "failed" }),
    readEvents: async () => [{ parseError: true, line: 2, message: "oops" }]
  });
  assert.equal(result.ok, true);
  assert.equal(result.events[0].parseError, true);
  assert.equal(result.events[0].line, 2);
  assert.equal(result.eventsTruncated, false);
});

test("showOpsRun is honest about not_found, invalid_id and read errors", async () => {
  const missing = await showOpsRun({
    homeDir: "/tmp/h",
    runId: GOOD_RUN_ID,
    readState: async () => null,
    readEvents: async () => []
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "not_found");
  assert.match(missing.error, /not found/i);

  for (const bad of ["", undefined, "../etc", "a/b", "run id", "x".repeat(200)]) {
    let touched = false;
    const r = await showOpsRun({
      homeDir: "/tmp/h",
      runId: bad,
      readState: async () => {
        touched = true;
        return null;
      }
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_id");
    assert.equal(touched, false);
  }

  const broken = await showOpsRun({
    homeDir: "/tmp/h",
    runId: GOOD_RUN_ID,
    readState: async () => {
      throw new Error("Invalid run state at x");
    }
  });
  assert.equal(broken.ok, false);
  assert.equal(broken.reason, "read_failed");
  assert.match(broken.error, /Invalid run state/);
});

test("showOpsReview returns read-only receipt fields", async () => {
  const result = await showOpsReview({
    homeDir: "/tmp/h",
    receiptId: GOOD_REVIEW_ID,
    loadReceipt: async (id, opts) => {
      assert.equal(id, GOOD_REVIEW_ID);
      assert.equal(opts.homeDir, "/tmp/h");
      return {
        version: 1,
        reviewId: id,
        agentId: "codex",
        model: "m",
        state: "completed",
        createdAt: "2026-01-01T00:00:00Z",
        cliVersion: "1.0.0",
        snapshot: { mode: "staged", headSha: "abc", totals: { files: 2 }, files: [{ path: "a" }, { path: "b" }] },
        findings: [
          { id: "f1", severity: "high", title: "T", path: "a.js", line: 3, problem: "P", recommendation: "R" }
        ],
        warnings: ["w1"],
        usage: { tokens: 5 },
        timings: { durationMs: 12 },
        approval: "granted",
        authority: "admin"
      };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.review.reviewId, GOOD_REVIEW_ID);
  assert.equal(result.review.state, "completed");
  assert.equal(result.review.findings.length, 1);
  assert.equal(result.review.findings[0].severity, "high");
  assert.equal(result.review.snapshot.fileCount, 2);
  assert.deepEqual(result.review.warnings, ["w1"]);
  assert.equal(result.review.readOnly, true);
  const wire = JSON.stringify(result);
  assert.ok(!wire.includes("approval"));
  assert.ok(!wire.includes("authority"));
});

test("showOpsReview is honest about not_found, invalid_id and read errors", async () => {
  const missing = await showOpsReview({
    homeDir: "/tmp/h",
    receiptId: GOOD_REVIEW_ID,
    loadReceipt: async (id) => {
      throw new Error(`Review receipt not found: ${id}`);
    }
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "not_found");

  const invalid = await showOpsReview({ homeDir: "/tmp/h", receiptId: "../x" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "invalid_id");
  const empty = await showOpsReview({ homeDir: "/tmp/h" });
  assert.equal(empty.reason, "invalid_id");

  const broken = await showOpsReview({
    homeDir: "/tmp/h",
    receiptId: GOOD_REVIEW_ID,
    loadReceipt: async () => {
      throw new Error("Unexpected token in JSON");
    }
  });
  assert.equal(broken.ok, false);
  assert.equal(broken.reason, "read_failed");
});

test("cancelOpsRun rejects run ids that could escape the runs directory before stopping anything", async () => {
  for (const runId of ["../../x", "..", "a/b", "a\\b", ".hidden", "run id", "x".repeat(200)]) {
    const result = await cancelOpsRun({
      homeDir: "/tmp/h",
      runId,
      stop: async () => {
        throw new Error(`must not stop for ${JSON.stringify(runId)}`);
      },
      readState: async () => {
        throw new Error(`must not read state for ${JSON.stringify(runId)}`);
      }
    });
    assert.equal(result.ok, false, JSON.stringify(runId));
    assert.equal(result.reason, "invalid_id", JSON.stringify(runId));
    assert.equal(result.wrote, false);
  }
});

test("cancelOpsRun refuses a run that is not cancellable instead of reporting it cancelled", async () => {
  for (const state of ["completed", "failed", "cancelled", "interrupted", "weird"]) {
    const result = await cancelOpsRun({
      homeDir: "/tmp/h",
      runId: "run-1",
      readState: async () => ({ runId: "run-1", state }),
      stop: async () => {
        throw new Error(`must not stop a ${state} run`);
      }
    });
    assert.equal(result.ok, false, state);
    assert.equal(result.reason, "not-cancellable", state);
    assert.equal(result.state, state);
  }

  for (const state of ["pending", "starting", "running"]) {
    let stopped = false;
    const result = await cancelOpsRun({
      homeDir: "/tmp/h",
      runId: "run-1",
      readState: async () => ({ runId: "run-1", state }),
      stop: async (_home, runId) => {
        stopped = true;
        return { runId, state: "cancelled" };
      }
    });
    assert.equal(result.ok, true, state);
    assert.equal(stopped, true, state);
  }
});

test("listOpsRuns never returns the task text of a run", async () => {
  const listed = await listOpsRuns({
    buildDashboard: async () => ({
      activeRuns: [{ runId: "run-1", state: "running", agentId: "codex", task: "use token sk-LIVE-SECRET-123" }],
      recentRuns: [{ runId: "run-2", state: "completed", agentId: "claude", task: "another private prompt" }]
    })
  });
  assert.equal(listed.ok, true);
  assert.equal(listed.runs.length, 2);
  for (const run of listed.runs) {
    assert.equal("task" in run, false, `run ${run.runId} must not carry task text`);
  }
  assert.doesNotMatch(JSON.stringify(listed), /sk-LIVE-SECRET|private prompt/);
});
