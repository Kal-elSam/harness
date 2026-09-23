import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWorkRequest,
  isWorkRequest
} from "../src/global/kernel/contracts.js";
import { createKernelService, normalizeWorkerLine } from "../src/global/kernel/service.js";
import { requestKernelSnapshot } from "../src/global/host/extension/index.js";
import { PROJECT_ROUTE_DECISION } from "../src/global/conversation/project-router.js";

test("createWorkRequest requires role, task, projectRoot, and sessionId", () => {
  const request = createWorkRequest({
    role: "Builder",
    task: "Add host launch",
    projectRoot: "/repo",
    sessionId: "11111111-1111-4111-8111-111111111111"
  });
  assert.equal(isWorkRequest(request), true);
  assert.equal(request.role, "Builder");
});

test("isWorkRequest rejects a missing sessionId", () => {
  assert.equal(isWorkRequest({ role: "Builder", task: "x", projectRoot: "/repo" }), false);
});

test("kernel snapshot does not import ink or cockpit", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/global/kernel/service.js"), "utf8");
  assert.doesNotMatch(src, /global\/ink\/|global\/cockpit\//);
  const snapshot = createKernelService({
    readStrategy: () => null,
    readAvailability: () => ({})
  }).snapshot();
  assert.equal(snapshot.strategy, null);
  assert.deepEqual(snapshot.availability, {});
});

test("route without an active strategy is WAIT_FOR_PROJECT_TEAM", () => {
  const request = createWorkRequest({
    role: "Builder",
    task: "Ship kernel",
    projectRoot: "/repo",
    sessionId: "11111111-1111-4111-8111-111111111111"
  });
  const decision = createKernelService({ readStrategy: () => null }).route(request);
  assert.equal(decision.decision, PROJECT_ROUTE_DECISION.WAIT_FOR_PROJECT_TEAM);
});

test("unknown worker lines become opaque events and do not fabricate tools tests or diffs", () => {
  const event = normalizeWorkerLine("not-json noise", "worker-1");
  assert.equal(event.type, "opaque");
  assert.equal(event.workerId, "worker-1");
  assert.equal(event.payload.raw, "not-json noise");
  assert.equal(event.type === "tool_call", false);
});

test("extension requests snapshots through the in-process kernel API", () => {
  const snapshot = requestKernelSnapshot({
    readStrategy: () => ({ status: "active" }),
    readAvailability: () => ({ claude: { ok: true } })
  });
  assert.equal(snapshot.strategy.status, "active");
  assert.equal(snapshot.availability.claude.ok, true);
});
