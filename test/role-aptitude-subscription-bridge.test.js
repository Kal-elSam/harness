import test from "node:test";
import assert from "node:assert/strict";
import { createSubscriptionBridge } from "../src/global/intelligence/role-aptitude-subscription-bridge.js";

const EMAIL = "marker.person@example.test";
const ORG = "Marker Org Name";
const claudeSub = { loggedIn: true, authMethod: "claude.ai", email: EMAIL, orgId: "org-1", orgName: ORG, subscriptionType: "pro" };
const codexChatGpt = "Logged in using ChatGPT\n";
const now = () => 1_700_000_000_000;

function bridge(overrides = {}) {
  return createSubscriptionBridge({
    readClaudeAuthStatus: async () => claudeSub,
    readCodexLoginStatus: async () => codexChatGpt,
    env: {},
    now,
    ...overrides
  });
}
const claim = (provider) => ({ provider, accountKey: "acct", billingCertainty: "no_additional_charge" });

test("Claude subscription login passes billing", async () => {
  const result = await bridge().verifyBilling(claim("claude"));
  assert.equal(result.ok, true);
  assert.equal(result.billingCertainty, "no_additional_charge");
  assert.match(result.receiptId, /^[0-9a-f]{16,}$/);
});

test("Claude api-key login is refused", async () => {
  const b = bridge({ readClaudeAuthStatus: async () => ({ loggedIn: true, authMethod: "api_key" }) });
  const result = await b.verifyBilling(claim("claude"));
  assert.equal(result.ok, false);
});

test("Claude logged out is refused", async () => {
  const b = bridge({ readClaudeAuthStatus: async () => ({ loggedIn: false, authMethod: "claude.ai" }) });
  assert.equal((await b.verifyBilling(claim("claude"))).ok, false);
});

test("Codex ChatGPT login passes billing", async () => {
  const result = await bridge().verifyBilling(claim("codex"));
  assert.equal(result.ok, true);
  assert.equal(result.billingCertainty, "no_additional_charge");
});

test("Codex non-ChatGPT login is refused", async () => {
  const b = bridge({ readCodexLoginStatus: async () => "Logged in using an API key - sk-***" });
  assert.equal((await b.verifyBilling(claim("codex"))).ok, false);
});

for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "CODEX_API_KEY"]) {
  for (const provider of ["claude", "codex"]) {
    test(`${key} refuses ${provider} even with subscription login`, async () => {
      const result = await bridge({ env: { [key]: "secret-value" } }).verifyBilling(claim(provider));
      assert.equal(result.ok, false);
      assert.equal(result.code, "api_key_present");
      assert.doesNotMatch(JSON.stringify(result), /secret-value/);
    });
  }
}

test("empty API key env value does not refuse", async () => {
  const result = await bridge({ env: { ANTHROPIC_API_KEY: "  ", OPENAI_API_KEY: "" } }).verifyBilling(claim("claude"));
  assert.equal(result.ok, true);
});

test("unreadable or unparsable status is billing_unverifiable", async () => {
  for (const [provider, overrides] of [
    ["claude", { readClaudeAuthStatus: async () => null }],
    ["claude", { readClaudeAuthStatus: async () => { throw new Error("boom"); } }],
    ["claude", { readClaudeAuthStatus: async () => ({ weird: true }) }],
    ["codex", { readCodexLoginStatus: async () => null }],
    ["codex", { readCodexLoginStatus: async () => { throw new Error("boom"); } }],
    ["other", {}]
  ]) {
    const result = await bridge(overrides).verifyBilling(claim(provider));
    assert.equal(result.ok, false, provider);
    assert.equal(result.code, "billing_unverifiable", provider);
  }
});

test("identity never blocks and never exposes email or org", async () => {
  const b = bridge();
  const outputs = [];
  for (const provider of ["claude", "codex"]) {
    outputs.push(await b.verifyIdentity({ provider, modelId: "m1", accountKey: "acct" }));
    outputs.push(await b.verifyBilling(claim(provider)));
  }
  const claudeIdentity = outputs[0];
  assert.equal(claudeIdentity.ok, true);
  assert.deepEqual(claudeIdentity.verifiedIdentity, { provider: "claude", modelId: "m1", accountKey: "acct" });
  assert.equal(typeof claudeIdentity.receipt.accountFingerprint, "string");
  assert.equal(claudeIdentity.receipt.loginMethod, "claude.ai");
  assert.equal(claudeIdentity.receipt.plan, "pro");
  const codexIdentity = outputs[2];
  assert.equal(codexIdentity.ok, true);
  assert.equal(codexIdentity.receipt.accountFingerprint, null);
  const serialized = JSON.stringify(outputs);
  assert.ok(!serialized.includes(EMAIL));
  assert.ok(!serialized.includes(ORG));
});

test("identity stays ok when status is unreadable", async () => {
  const b = bridge({ readClaudeAuthStatus: async () => null });
  const result = await b.verifyIdentity({ provider: "claude", modelId: "m", accountKey: "a" });
  assert.equal(result.ok, true);
  assert.equal(result.receipt.accountFingerprint, null);
});
