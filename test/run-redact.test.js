import test from "node:test";
import assert from "node:assert/strict";
import {
  redactEnv,
  redactObject,
  redactString,
  shouldPersistTranscript
} from "../src/global/runtime/run-redact.js";

test("redactString masks credential-like values", () => {
  assert.equal(redactString("sk-1234567890abcdefghijklmnop"), "[REDACTED]");
  assert.equal(redactString("hello"), "hello");
});

test("redactObject masks nested secret keys", () => {
  const result = redactObject({
    task: "ok",
    apiKey: "value",
    nested: { accessToken: "abc" }
  });

  assert.equal(result.apiKey, "[REDACTED]");
  assert.equal(result.nested.accessToken, "[REDACTED]");
});

test("redactObject keeps transcript content only with opt-in", () => {
  const denied = redactObject({ content: "secret transcript" });
  const allowed = redactObject({ content: "secret transcript" }, { allowTranscript: true });

  assert.equal(denied.content, "[REDACTED]");
  assert.equal(allowed.content, "secret transcript");
});

test("redactEnv masks sensitive environment variables", () => {
  const env = redactEnv({
    PATH: "/usr/bin",
    ANTHROPIC_API_KEY: "sk-1234567890abcdefghijklmnop",
    OPENAI_API_KEY: "sk-abcdef1234567890"
  });

  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.ANTHROPIC_API_KEY, "[REDACTED]");
  assert.equal(env.OPENAI_API_KEY, "[REDACTED]");
});

test("shouldPersistTranscript requires explicit true", () => {
  assert.equal(shouldPersistTranscript(false), false);
  assert.equal(shouldPersistTranscript(true), true);
  assert.equal(shouldPersistTranscript(undefined), false);
});
