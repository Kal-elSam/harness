import test from "node:test";
import assert from "node:assert/strict";
import { redactSecrets, scanTextForSecrets } from "../src/global/conversation/secret-scanner.js";

test("scanTextForSecrets detects a real AWS access key id shape", () => {
  const findings = scanTextForSecrets("const key = \"AKIAABCDEFGHIJKLMNOP\";");
  assert.ok(findings.some((f) => f.name === "aws-access-key-id"));
});

test("scanTextForSecrets detects a generic hardcoded credential assignment — the real shape the crm finding had", () => {
  const findings = scanTextForSecrets('const AZURE_OPENAI_API_KEY = "abcd1234efgh5678ijkl9012mnop3456";');
  assert.ok(findings.some((f) => f.name === "generic-credential-assignment"));
});

test("scanTextForSecrets detects a real PEM private key block", () => {
  const pem = "-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEA\n-----END PRIVATE KEY-----";
  const findings = scanTextForSecrets(pem);
  assert.ok(findings.some((f) => f.name === "private-key-block"));
});

test("scanTextForSecrets never flags plain, real, non-secret code", () => {
  const findings = scanTextForSecrets("export function add(a, b) { return a + b; }\nconst name = \"crm\";");
  assert.deepEqual(findings, []);
});

test("redactSecrets replaces every real matched secret with a fixed marker, never the real value, and preserves surrounding real code", () => {
  const { text, redactedCount } = redactSecrets('const AZURE_OPENAI_API_KEY = "abcd1234efgh5678ijkl9012mnop3456";\nconst x = 1;');
  assert.equal(redactedCount, 1);
  assert.doesNotMatch(text, /abcd1234efgh5678ijkl9012mnop3456/);
  assert.match(text, /\[REDACTED-SECRET\]/);
  assert.match(text, /const x = 1;/, "real, non-secret code around the redaction must survive untouched");
});

test("redactSecrets handles multiple real secrets in the same file without corrupting the text between them", () => {
  const input = 'const a = "AKIAABCDEFGHIJKLMNOP";\nconst b = "AKIAZZZZZZZZZZZZZZZZ";\nconst safe = "hello";';
  const { text, redactedCount } = redactSecrets(input);
  assert.equal(redactedCount, 2);
  assert.match(text, /const safe = "hello";/);
  assert.doesNotMatch(text, /AKIAABCDEFGHIJKLMNOP|AKIAZZZZZZZZZZZZZZZZ/);
});

test("redactSecrets is a no-op (returns the same text, redactedCount 0) for real content with no secrets", () => {
  const input = "export const Button = () => <button>Click</button>;";
  const { text, redactedCount } = redactSecrets(input);
  assert.equal(text, input);
  assert.equal(redactedCount, 0);
});
