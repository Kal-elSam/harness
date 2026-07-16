import test from "node:test";
import assert from "node:assert/strict";
import { TRANSPORT_KINDS } from "../src/global/intelligence/types.js";
import {
  invokeChatCompletions,
  invokeResponses,
  invokeViaTransport
} from "../src/global/intelligence/backends/opencode-http.js";

function mockFetchSequence(handlers) {
  let index = 0;
  return async (url, init = {}) => {
    const handler = handlers[Math.min(index, handlers.length - 1)];
    index += 1;
    return handler(String(url), init);
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    }
  };
}

test("chat completions normalizes content and usage", async () => {
  const fetchImpl = mockFetchSequence([
    async (url, init) => {
      assert.match(url, /\/chat\/completions$/);
      const body = JSON.parse(init.body);
      assert.equal(body.model, "kimi-k2.7-code");
      assert.equal(body.stream, false);
      assert.equal(body.messages[0].role, "system");
      assert.equal(body.messages[1].role, "user");
      assert.equal(init.headers.Authorization, "Bearer sk-test");
      return jsonResponse(200, {
        model: "kimi-k2.7-code",
        choices: [{ message: { content: "go answer" } }],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 3,
          prompt_tokens_details: { cached_tokens: 2 }
        }
      });
    }
  ]);

  const result = await invokeChatCompletions({
    baseUrl: "https://opencode.ai/zen/go/v1",
    apiKey: "sk-test",
    modelId: "kimi-k2.7-code",
    contextPack: { systemPrompt: "sys" },
    request: { prompt: "hi" },
    fetchImpl
  });

  assert.equal(result.ok, true);
  assert.equal(result.content, "go answer");
  assert.equal(result.usage.inputTokens, 11);
  assert.equal(result.usage.outputTokens, 3);
  assert.equal(result.usage.cachedTokens, 2);
});

test("responses transport normalizes output_text and usage", async () => {
  const fetchImpl = mockFetchSequence([
    async (url, init) => {
      assert.match(url, /\/responses$/);
      const body = JSON.parse(init.body);
      assert.equal(body.model, "gpt-5.5");
      assert.equal(body.input[0].role, "user");
      return jsonResponse(200, {
        model: "gpt-5.5",
        output_text: "zen answer",
        usage: { input_tokens: 4, output_tokens: 2 }
      });
    }
  ]);

  const result = await invokeResponses({
    baseUrl: "https://opencode.ai/zen/v1",
    apiKey: "sk-test",
    modelId: "gpt-5.5",
    contextPack: null,
    request: { prompt: "hi" },
    fetchImpl
  });

  assert.equal(result.ok, true);
  assert.equal(result.content, "zen answer");
  assert.equal(result.usage.inputTokens, 4);
  assert.equal(result.usage.outputTokens, 2);
});

test("responses transport extracts alternate output array format", async () => {
  const result = await invokeResponses({
    baseUrl: "https://opencode.ai/zen/v1",
    apiKey: "sk-test",
    modelId: "gpt-5.5",
    contextPack: null,
    request: { prompt: "hi" },
    fetchImpl: async () => jsonResponse(200, {
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "part-a" },
            { type: "output_text", text: "-part-b" }
          ]
        }
      ],
      usage: { input_tokens: 1, output_tokens: 2 }
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.content, "part-a-part-b");
});

test("invokeViaTransport selects chat vs responses by TRANSPORT_KINDS", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (String(url).endsWith("/responses")) {
      return jsonResponse(200, { output_text: "responses", usage: {} });
    }
    return jsonResponse(200, {
      choices: [{ message: { content: "chat" } }],
      usage: {}
    });
  };

  const base = {
    baseUrl: "https://example.test/v1",
    apiKey: "sk-test",
    modelId: "model",
    contextPack: null,
    request: { prompt: "hi" },
    fetchImpl
  };

  const chat = await invokeViaTransport(TRANSPORT_KINDS.CHAT_COMPLETIONS, base);
  const responses = await invokeViaTransport(TRANSPORT_KINDS.RESPONSES, base);
  assert.equal(chat.content, "chat");
  assert.equal(responses.content, "responses");
  assert.match(calls[0], /\/chat\/completions$/);
  assert.match(calls[1], /\/responses$/);
});

test("HTTP errors surface without leaking API keys", async () => {
  const secret = "sk-oc-leaky-secret";
  const result = await invokeChatCompletions({
    baseUrl: "https://opencode.ai/zen/go/v1",
    apiKey: secret,
    modelId: "kimi-k2.7-code",
    contextPack: null,
    request: { prompt: "hi" },
    fetchImpl: async () => jsonResponse(401, {
      error: { message: `unauthorized key ${secret}` }
    })
  });

  assert.equal(result.ok, false);
  assert.ok(!String(result.error).includes(secret));
  assert.match(result.error, /REDACTED|unauthorized/i);
  assert.equal(result.content, undefined);
  assert.equal(result.raw, undefined);
});

test("timeouts map to actionable transport errors", async () => {
  const result = await invokeResponses({
    baseUrl: "https://opencode.ai/zen/v1",
    apiKey: "sk-test",
    modelId: "gpt-5.5",
    contextPack: null,
    request: { prompt: "hi", timeoutMs: 5 },
    fetchImpl: async (_url, init) => {
      await new Promise((_, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/i);
});
