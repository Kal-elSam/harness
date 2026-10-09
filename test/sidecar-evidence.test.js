import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  SIDECAR_JSONL,
  SIDECAR_STDERR_LOG,
  createStdoutTee,
  createRedactedStderrLog,
  parseJsonl,
  findReady,
  recordsOfType
} from "../scripts/fixtures/sidecar-evidence.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "sidecar-evidence-"));

test("stdout tee passes bytes through unchanged and copies the same bytes to sidecar.jsonl", () => {
  const dir = tmp();
  const seen = [];
  const sink = { write: (chunk) => (seen.push(Buffer.from(chunk)), true) };
  const tee = createStdoutTee(sink, join(dir, SIDECAR_JSONL));
  const chunks = [
    Buffer.from('{"type":"ready","engine":{"status":"connected"}}\n'),
    // Split mid-line and multi-byte UTF-8 across the boundary: bytes must survive.
    Buffer.from('{"type":"notice","message":"caf'),
    Buffer.from([0xc3]),
    Buffer.from([0xa9, 0x22, 0x7d, 0x0a])
  ];
  for (const chunk of chunks) tee.write(chunk);
  const sunk = Buffer.concat(seen);
  const copied = readFileSync(join(dir, SIDECAR_JSONL));
  assert.deepEqual(copied, sunk, "tee file must be byte-identical to what the host saw");
  assert.deepEqual(sunk, Buffer.concat(chunks), "downstream stdout must be unchanged");
});

test("stdout tee never contaminates stdout even when the evidence file cannot be written", () => {
  const seen = [];
  const sink = { write: (chunk) => (seen.push(String(chunk)), true) };
  const tee = createStdoutTee(sink, "/nonexistent-dir-for-tee/sidecar.jsonl");
  assert.doesNotThrow(() => tee.write("hello\n"));
  assert.deepEqual(seen, ["hello\n"]);
});

test("stderr log is separate and redacts secrets", () => {
  const dir = tmp();
  const log = createRedactedStderrLog(join(dir, SIDECAR_STDERR_LOG));
  log.write("boot ok\n");
  log.write("auth sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 leaked\n");
  const text = readFileSync(join(dir, SIDECAR_STDERR_LOG), "utf8");
  assert.match(text, /boot ok/);
  assert.doesNotMatch(text, /sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789/);
  assert.equal(existsSync(join(dir, SIDECAR_JSONL)), false, "stderr must not land in sidecar.jsonl");
});

test("parseJsonl keeps order, skips blank and malformed lines and reports them", () => {
  const text = [
    '{"type":"ready","engine":{"status":"no_model"}}',
    "",
    "not json",
    '{"type":"engine","engine":{"status":"connected"},"modelLabel":"m"}',
    '{"type":"notice"' // truncated trailing line (no newline yet)
  ].join("\n");
  const { records, malformed } = parseJsonl(text);
  assert.deepEqual(records.map((r) => r.type), ["ready", "engine"]);
  assert.equal(malformed, 2);
});

test("findReady returns the first real ready record and null when absent", () => {
  const { records } = parseJsonl(
    '{"type":"mode","mode":"ask"}\n{"type":"ready","engine":{"status":"no_model"}}\n{"type":"ready","engine":{"status":"connected"}}\n'
  );
  assert.equal(findReady(records)?.engine.status, "no_model");
  assert.equal(findReady([{ type: "engine" }]), null);
  assert.deepEqual(recordsOfType(records, "mode").length, 1);
});
