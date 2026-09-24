import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isValidPiSessionId,
  lookupPiBinding,
  PI_BINDINGS_SCHEMA,
  recordPiBinding
} from "../src/global/conversation/pi-session-bindings.js";

const KAIRO_ID_A = "aaaaaaaa-0000-4000-8000-000000000001";
const KAIRO_ID_B = "bbbbbbbb-0000-4000-8000-000000000002";
const PI_ID_A = "01912e2b-6a3e-7b3e-9a3e-6a3e9a3e6a3e";

async function tempHome() {
  return mkdtemp(join(tmpdir(), "kairo-pi-bindings-"));
}

test("isValidPiSessionId accepts Pi's own contract and rejects malformed ids", () => {
  assert.equal(isValidPiSessionId(PI_ID_A), true);
  assert.equal(isValidPiSessionId("abc"), true);
  assert.equal(isValidPiSessionId(""), false);
  assert.equal(isValidPiSessionId("-leading-dash"), false);
  assert.equal(isValidPiSessionId("trailing-dash-"), false);
  assert.equal(isValidPiSessionId("has/slash"), false);
  assert.equal(isValidPiSessionId("../../etc"), false);
  assert.equal(isValidPiSessionId(null), false);
  assert.equal(isValidPiSessionId(undefined), false);
});

test("lookupPiBinding returns null when no bindings file exists yet — never throws", async () => {
  const homeDir = await tempHome();
  const result = await lookupPiBinding(homeDir, "/repo", PI_ID_A);
  assert.equal(result, null);
});

test("lookupPiBinding returns null on a malformed bindings file — never throws", async () => {
  const homeDir = await tempHome();
  const path = join(homeDir, ".harness", "sessions", "some-project", "pi-bindings.json");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(homeDir, ".harness", "sessions", "some-project"), { recursive: true });
  await writeFile(path, "{ not valid json");
  const result = await lookupPiBinding(homeDir, "/repo", PI_ID_A, {
    readFile: async () => "{ not valid json"
  });
  assert.equal(result, null);
});

test("record then lookup round-trips a real binding on real disk", async () => {
  const homeDir = await tempHome();
  const projectRoot = "/repo/one";
  const recorded = await recordPiBinding(homeDir, projectRoot, PI_ID_A, KAIRO_ID_A);
  assert.equal(recorded.kairoSessionId, KAIRO_ID_A);
  assert.equal(typeof recorded.boundAt, "string");

  const found = await lookupPiBinding(homeDir, projectRoot, PI_ID_A);
  assert.equal(found, KAIRO_ID_A);
});

test("recording a new binding for the same Pi session replaces the previous one", async () => {
  const homeDir = await tempHome();
  const projectRoot = "/repo/replace";
  await recordPiBinding(homeDir, projectRoot, PI_ID_A, KAIRO_ID_A);
  await recordPiBinding(homeDir, projectRoot, PI_ID_A, KAIRO_ID_B);
  const found = await lookupPiBinding(homeDir, projectRoot, PI_ID_A);
  assert.equal(found, KAIRO_ID_B);
});

test("bindings are isolated per project — the same Pi session id in another project is unbound", async () => {
  const homeDir = await tempHome();
  await recordPiBinding(homeDir, "/repo/project-a", PI_ID_A, KAIRO_ID_A);
  const foundInOther = await lookupPiBinding(homeDir, "/repo/project-b", PI_ID_A);
  assert.equal(foundInOther, null);
});

test("recordPiBinding refuses an invalid Pi session id", async () => {
  const homeDir = await tempHome();
  await assert.rejects(
    () => recordPiBinding(homeDir, "/repo", "../../etc", KAIRO_ID_A),
    /Invalid Pi session id/
  );
});

test("recordPiBinding refuses an invalid Kairo session id", async () => {
  const homeDir = await tempHome();
  await assert.rejects(
    () => recordPiBinding(homeDir, "/repo", PI_ID_A, "not-a-real-kairo-id"),
    /Invalid Kairo session id/
  );
});

test("lookupPiBinding fails closed on a stored entry with a corrupted Kairo session id", async () => {
  const homeDir = await tempHome();
  const found = await lookupPiBinding(homeDir, "/repo", PI_ID_A, {
    readFile: async () => JSON.stringify({
      schema: PI_BINDINGS_SCHEMA,
      [PI_ID_A]: { kairoSessionId: "corrupted", boundAt: "2026-01-01T00:00:00.000Z" }
    })
  });
  assert.equal(found, null);
});

test("recordPiBinding writes atomically through the injected writeAtomicJson dep", async () => {
  const calls = [];
  const homeDir = await tempHome();
  await recordPiBinding(homeDir, "/repo", PI_ID_A, KAIRO_ID_A, {
    readFile: async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); },
    writeAtomicJson: async (path, value) => { calls.push({ path, value }); }
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /pi-bindings\.json$/);
  assert.equal(calls[0].value.schema, PI_BINDINGS_SCHEMA);
  assert.equal(calls[0].value[PI_ID_A].kairoSessionId, KAIRO_ID_A);
});
