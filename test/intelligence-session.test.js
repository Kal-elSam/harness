import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli.js";
import { resolveSessionOverride } from "../src/global/intelligence-session.js";
import {
  BACKEND_IDS,
  resolveRoutingDecision
} from "../src/global/intelligence/index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const kairoBin = join(packageRoot, "bin/kairo.js");

function runKairo(args, { env = process.env, cwd = packageRoot } = {}) {
  return spawnSync(process.execPath, [kairoBin, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...env,
      HARNESS_INK: "0",
      OPENROUTER_API_KEY: "",
      OPENCODE_API_KEY: "",
      OLLAMA_HOST: "http://127.0.0.1:9"
    }
  });
}

test("parseArgs accepts --backend VALUE and --backend=VALUE", () => {
  const spaced = parseArgs(["intelligence", "route", "--backend", "opencode-go", "--model", "kimi-k2.7-code"]);
  assert.equal(spaced.options.intelligenceBackend, "opencode-go");
  assert.equal(spaced.options.model, "kimi-k2.7-code");

  const equals = parseArgs(["intelligence", "models", "--backend=opencode"]);
  assert.equal(equals.options.intelligenceBackend, "opencode");
  assert.equal(equals.options.model, null);
});

test("resolveSessionOverride handles backend, model-only, invalid, and empty", () => {
  assert.deepEqual(
    resolveSessionOverride({ intelligenceBackend: "opencode-zen", model: "big-pickle" }),
    { preferredBackend: "opencode-zen", preferredModel: "big-pickle" }
  );
  assert.deepEqual(
    resolveSessionOverride({ model: "llama3.2" }),
    { preferredBackend: null, preferredModel: "llama3.2" }
  );
  assert.equal(resolveSessionOverride({}), null);
  assert.throws(
    () => resolveSessionOverride({ intelligenceBackend: "nope" }),
    /Unknown --backend/
  );
  assert.throws(
    () => resolveSessionOverride({ intelligenceBackend: "" }),
    /Missing --backend value/
  );
  assert.throws(
    () => resolveSessionOverride({ intelligenceBackend: "   " }),
    /Missing --backend value/
  );
});

test("CLI override beats profile and automatic selection", () => {
  const decision = resolveRoutingDecision({
    backends: [
      {
        id: BACKEND_IDS.OLLAMA,
        available: true,
        models: [{
          provider: BACKEND_IDS.OLLAMA,
          modelId: "llama3.2",
          local: true,
          privacyClass: "local"
        }]
      },
      {
        id: BACKEND_IDS.OPENCODE_GO,
        available: true,
        hasApiKey: true,
        models: [{
          provider: BACKEND_IDS.OPENCODE_GO,
          modelId: "kimi-k2.7-code",
          local: false,
          privacyClass: "cloud"
        }]
      }
    ],
    profile: { preferredBackend: BACKEND_IDS.OLLAMA, preferredModel: "llama3.2" },
    sessionOverride: {
      preferredBackend: BACKEND_IDS.OPENCODE_GO,
      preferredModel: "kimi-k2.7-code"
    },
    cloudConsent: true
  });
  assert.equal(decision.backendId, BACKEND_IDS.OPENCODE_GO);
  assert.match(decision.reason, /^CLI override:/);
});

test("intelligence status JSON exposes ephemeral sessionOverride", () => {
  const result = runKairo([
    "intelligence", "status", "--json", "--backend", "opencode-go", "--model", "kimi-k2.7-code"
  ]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.readOnly, true);
  assert.deepEqual(payload.sessionOverride, {
    preferredBackend: "opencode-go",
    preferredModel: "kimi-k2.7-code"
  });
  assert.ok(Array.isArray(payload.backends));
});

test("intelligence models filters by --backend", () => {
  const result = runKairo(["intelligence", "models", "--json", "--backend=opencode"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.sessionOverride.preferredBackend, "opencode");
  assert.ok(payload.backends.every((entry) => entry.id === "opencode"));
  assert.ok(payload.models.every((model) => model.provider === "opencode"));
});

test("invalid or empty --backend fails before inspect", () => {
  const unknown = runKairo(["intelligence", "status", "--json", "--backend", "nope"]);
  assert.notEqual(unknown.status, 0);
  assert.match(`${unknown.stderr}${unknown.stdout}`, /Unknown --backend/);

  const empty = runKairo(["intelligence", "route", "--json", "--backend="]);
  assert.notEqual(empty.status, 0);
  assert.match(`${empty.stderr}${empty.stdout}`, /Missing --backend value/);
});

test("ephemeral overrides do not write profiles or credentials", async () => {
  const home = await mkdtemp(join(tmpdir(), "kairo-intel-ovr-"));
  const profilePath = join(home, ".harness", "profile.json");
  try {
    const before = await readFile(profilePath, "utf8").catch(() => null);
    const result = runKairo(
      ["intelligence", "status", "--json", "--backend=opencode-zen", "--model=big-pickle"],
      { env: { ...process.env, HOME: home, HARNESS_HOME: home } }
    );
    assert.equal(result.status, 0, result.stderr);
    const after = await readFile(profilePath, "utf8").catch(() => null);
    assert.equal(after, before);
    assert.equal(await readFile(join(home, ".harness", "credentials.json"), "utf8").catch(() => null), null);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.readOnly, true);
    assert.ok(!JSON.stringify(payload).includes("OPENCODE_API_KEY="));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
