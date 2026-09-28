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
  previewOpsSync
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
