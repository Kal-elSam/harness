import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { availabilityFingerprint } from "../src/global/conversation/availability-fingerprint.js";
import {
  readAvailabilityRecovery, writeAvailabilityRecovery, availabilityRecoveryPath
} from "../src/global/conversation/availability-recovery-store.js";

const limited = (provider, window, remainingPercent = 2, resetsAt = "2026-09-30T00:00:00.000Z") => ({
  ok: false, reason: `${provider} ${window} window is limited`, limit: { provider, window, remainingPercent, resetsAt }
});

test("fingerprint states each provider as ok, limited:<window>, or unavailable — sorted and stable", () => {
  const fingerprint = availabilityFingerprint({
    "opencode-go": limited("opencode-go", "monthly"),
    codex: { ok: true, reason: null },
    "opencode-zen": { ok: false, reason: "OpenCode Zen is excluded from automatic routing (PAYG risk)" },
    claude: limited("claude", "Current session")
  });
  assert.equal(fingerprint.key, "claude=limited:Current session|codex=ok|opencode-go=limited:monthly|opencode-zen=unavailable");
  assert.deepEqual(fingerprint.providers, {
    claude: "limited:Current session", codex: "ok", "opencode-go": "limited:monthly", "opencode-zen": "unavailable"
  });
});

test("fingerprint ignores remaining percent and reset time, so plain refreshes never look like a change", () => {
  const before = availabilityFingerprint({ codex: limited("codex", "weekly", 4, "2026-09-30T00:00:00.000Z") });
  const after = availabilityFingerprint({ codex: limited("codex", "weekly", 1, "2026-09-30T00:05:00.000Z") });
  assert.equal(before.key, after.key);
});

test("fingerprint changes when a provider becomes limited, recovers, or hits a different window", () => {
  const ok = availabilityFingerprint({ codex: { ok: true, reason: null } }).key;
  const weekly = availabilityFingerprint({ codex: limited("codex", "weekly") }).key;
  const fiveHour = availabilityFingerprint({ codex: limited("codex", "5h") }).key;
  assert.notEqual(ok, weekly);
  assert.notEqual(weekly, fiveHour);
  assert.equal(availabilityFingerprint({ codex: { ok: true, reason: null } }).key, ok);
});

test("a limit without a window name is still a limit, and missing eligibility is an empty fingerprint", () => {
  assert.equal(availabilityFingerprint({ codex: { ok: false, reason: "x", limit: { provider: "codex", window: null } } }).key, "codex=limited:usage");
  assert.deepEqual(availabilityFingerprint(undefined), { key: "", providers: {} });
});

test("recovery store round-trips the last fingerprint acted on, per project", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-recovery-"));
  const projectRoot = "/work/project-a";
  assert.equal(await readAvailabilityRecovery(homeDir, projectRoot), null);

  await writeAvailabilityRecovery(homeDir, projectRoot, { fingerprint: "codex=limited:weekly", outcome: "activated" });
  const record = await readAvailabilityRecovery(homeDir, projectRoot);
  assert.equal(record.fingerprint, "codex=limited:weekly");
  assert.equal(record.outcome, "activated");
  assert.equal(record.schema, "kairo.availability-recovery/v1");
  assert.equal(typeof record.updatedAt, "string");

  assert.equal(await readAvailabilityRecovery(homeDir, "/work/project-b"), null, "records are per project");
});

test("recovery store treats a malformed or foreign file as no record", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-recovery-"));
  const path = availabilityRecoveryPath(homeDir, "/work/project-a");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "{not json");
  assert.equal(await readAvailabilityRecovery(homeDir, "/work/project-a"), null);
  await writeFile(path, JSON.stringify({ schema: "other/v1", fingerprint: "x" }));
  assert.equal(await readAvailabilityRecovery(homeDir, "/work/project-a"), null);
});

test("recovery store refuses a record without a fingerprint", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-recovery-"));
  await assert.rejects(writeAvailabilityRecovery(homeDir, "/work/project-a", { outcome: "activated" }), /fingerprint/);
});
