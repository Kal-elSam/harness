import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildProfileJson,
  getGlobalProfilePath,
  getProjectProfilePath,
  isForbiddenSecretKey,
  normalizeProfileKey,
  resolveProfile,
  resolveProfileAgents,
  saveGlobalProfile
} from "../src/global/profile.js";

test("global and project profile precedence favors project", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-profile-home-"));
  const workspaceRoot = await mkdtemp(join(tmpdir(), "kairo-profile-workspace-"));

  await saveGlobalProfile(homeDir, {
    coordinator: "codex",
    defaultAgents: "all",
    defaultComponents: ["orchestrator"],
    applyMode: "prompt"
  });

  await mkdir(join(workspaceRoot, ".harness"), { recursive: true });
  await writeFile(
    getProjectProfilePath(workspaceRoot),
    `${JSON.stringify({ coordinator: "cursor", defaultAgents: ["cursor"] })}\n`,
    "utf8"
  );

  const resolved = await resolveProfile({ homeDir, workspaceRoot });
  const json = buildProfileJson(resolved);

  assert.equal(resolved.profile.coordinator, "cursor");
  assert.deepEqual(resolved.profile.defaultAgents, ["cursor"]);
  assert.deepEqual(resolved.profile.defaultComponents, ["orchestrator"]);
  assert.equal(json.sources.project, getProjectProfilePath(workspaceRoot));
  assert.equal(json.sources.global, getGlobalProfilePath(homeDir));
});

test("resolveProfileAgents honors detected agents", () => {
  const agents = resolveProfileAgents({ defaultAgents: "detected" }, ["cursor", "codex"]);
  assert.deepEqual(agents, ["cursor", "codex"]);
});

test("profile files never include credential fields", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-profile-creds-"));
  await saveGlobalProfile(homeDir, {
    coordinator: null,
    defaultAgents: "detected",
    defaultComponents: null,
    applyMode: "prompt"
  });

  const resolved = await resolveProfile({ homeDir, workspaceRoot: homeDir });
  const keys = Object.keys(resolved.profile);
  assert.equal(keys.includes("token"), false);
  assert.equal(keys.includes("apiKey"), false);
});

test("profile rejects embedded secrets and apiKey fields", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-profile-reject-"));

  await assert.rejects(
    () => saveGlobalProfile(homeDir, {
      coordinator: null,
      defaultAgents: "detected",
      defaultComponents: null,
      applyMode: "prompt",
      apiKey: "sk-or-secret"
    }),
    /credentials|environment/i
  );

  await assert.rejects(
    () => saveGlobalProfile(homeDir, {
      coordinator: null,
      defaultAgents: "detected",
      defaultComponents: null,
      applyMode: "prompt",
      customProviders: [{
        baseUrl: "https://example.com/v1",
        apiKey: "sk-secret"
      }]
    }),
    /apiKeyEnv|secrets|environment/i
  );

  await assert.rejects(
    () => saveGlobalProfile(homeDir, {
      coordinator: null,
      defaultAgents: "detected",
      defaultComponents: null,
      applyMode: "prompt",
      metadata: { nested: { token: "sk-or-nested-secret" } }
    }),
    /credentials|environment/i
  );

  await assert.rejects(
    () => saveGlobalProfile(homeDir, {
      coordinator: null,
      defaultAgents: "detected",
      defaultComponents: null,
      applyMode: "prompt",
      customProviders: [{
        baseUrl: "https://provider.example/v1",
        modelId: "remote-model",
        apiKeyEnv: "REMOTE_KEY"
      }]
    }),
    /remote custom providers.*apiKeyEnv|local endpoint/i
  );
});

test("profile intelligence overrides merge with defaults", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-profile-intel-"));
  await saveGlobalProfile(homeDir, {
    coordinator: null,
    defaultAgents: "detected",
    defaultComponents: null,
    applyMode: "prompt",
    preferredBackend: "ollama",
    preferredModel: "llama3.2",
    cloudConsent: false,
    tokenBudget: 8000,
    customProviders: [{
      id: "my-proxy",
      label: "My proxy",
      baseUrl: "http://127.0.0.1:8080/v1",
      modelId: "local-model",
      apiKeyEnv: "MY_PROXY_KEY",
      local: true
    }]
  });

  const resolved = await resolveProfile({ homeDir, workspaceRoot: homeDir });
  const json = buildProfileJson(resolved);

  assert.equal(resolved.profile.preferredBackend, "ollama");
  assert.equal(resolved.profile.tokenBudget, 8000);
  assert.equal(json.customProviders[0].apiKeyEnv, "MY_PROXY_KEY");
  assert.equal("apiKey" in json.customProviders[0], false);
});

test("normalizeProfileKey converts camelCase secret names", () => {
  assert.equal(normalizeProfileKey("clientSecret"), "client_secret");
  assert.equal(normalizeProfileKey("apiToken"), "api_token");
  assert.equal(normalizeProfileKey("authorizationHeader"), "authorization_header");
  assert.equal(normalizeProfileKey("privateKey"), "private_key");
  assert.equal(normalizeProfileKey("apiKeyEnv"), "api_key_env");
  assert.equal(normalizeProfileKey("tokenBudget"), "token_budget");
});

test("camelCase credential keys are forbidden except apiKeyEnv", () => {
  assert.equal(isForbiddenSecretKey("clientSecret"), true);
  assert.equal(isForbiddenSecretKey("apiToken"), true);
  assert.equal(isForbiddenSecretKey("authorizationHeader"), true);
  assert.equal(isForbiddenSecretKey("privateKey"), true);
  assert.equal(isForbiddenSecretKey("apiKey"), true);
  assert.equal(isForbiddenSecretKey("apiKeyEnv"), false);
  assert.equal(isForbiddenSecretKey("tokenBudget"), false);
});

test("profile rejects camelCase and nested secret keys", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-profile-camel-"));
  const base = {
    coordinator: null,
    defaultAgents: "detected",
    defaultComponents: null,
    applyMode: "prompt"
  };

  for (const key of ["clientSecret", "apiToken", "authorizationHeader", "privateKey"]) {
    await assert.rejects(
      () => saveGlobalProfile(homeDir, { ...base, [key]: "not-a-secret-shape" }),
      /credentials|rejected key/i,
      `expected rejection for ${key}`
    );
  }

  await assert.rejects(
    () => saveGlobalProfile(homeDir, {
      ...base,
      extensions: { oauth: { clientSecret: "plain-value" } }
    }),
    /credentials|rejected key/i
  );

  await assert.rejects(
    () => saveGlobalProfile(homeDir, {
      ...base,
      notes: { hint: "sk-or-hidden-under-unknown-key" }
    }),
    /credential-like values|environment/i
  );
});

test("apiKeyEnv remains allowed only as an environment variable name", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-profile-apikeyenv-"));

  await saveGlobalProfile(homeDir, {
    coordinator: null,
    defaultAgents: "detected",
    defaultComponents: null,
    applyMode: "prompt",
    customProviders: [{
      baseUrl: "http://127.0.0.1:9000/v1",
      modelId: "local",
      apiKeyEnv: "LOCAL_PROXY_KEY"
    }]
  });

  await assert.rejects(
    () => saveGlobalProfile(homeDir, {
      coordinator: null,
      defaultAgents: "detected",
      defaultComponents: null,
      applyMode: "prompt",
      customProviders: [{
        baseUrl: "http://127.0.0.1:9000/v1",
        modelId: "local",
        apiKeyEnv: "sk-or-not-an-env-name"
      }]
    }),
    /environment variable name|credential-like/i
  );
});

test("resolveProfile rewrites lying customProviders.local from baseUrl", async () => {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-profile-local-lie-"));
  const workspaceRoot = await mkdtemp(join(tmpdir(), "kairo-profile-local-ws-"));
  await mkdir(join(workspaceRoot, ".harness"), { recursive: true });
  await writeFile(
    getProjectProfilePath(workspaceRoot),
    `${JSON.stringify({
      customProviders: [{
        id: "evil",
        baseUrl: "https://evil.example/v1",
        modelId: "x",
        local: true
      }]
    })}\n`,
    "utf8"
  );

  const resolved = await resolveProfile({ homeDir, workspaceRoot });
  assert.equal(resolved.profile.customProviders[0].local, false);
  assert.equal(buildProfileJson(resolved).customProviders[0].local, false);
});
