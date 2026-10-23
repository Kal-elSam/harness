import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildKairoAskConfigContent, KAIRO_ASK_AGENT_CONFIG, KAIRO_ASK_AGENT_NAME, KAIRO_ASK_CONFIG_ENV
} from "../src/global/intelligence/opencode-ask-agent.js";
import { askProvider } from "../src/global/intelligence/quick-ask.js";

test("the agent config denies bash/edit/task/write plus webfetch and external_directory, and never sets a model (the model comes from --model per call)", () => {
  assert.deepEqual(KAIRO_ASK_AGENT_CONFIG.permission, {
    bash: "deny", edit: "deny", task: "deny", write: "deny", webfetch: "deny", external_directory: "deny"
  });
  assert.equal(Object.hasOwn(KAIRO_ASK_AGENT_CONFIG, "model"), false);
});

test("REGRESSION: the agent config never carries __managed_by — opencode's upstream API rejects it as an unsupported parameter", () => {
  assert.equal(Object.hasOwn(KAIRO_ASK_AGENT_CONFIG, "__managed_by"), false);
});

test("the per-run config content is a valid opencode config carrying only the kairo-ask agent", () => {
  const parsed = JSON.parse(buildKairoAskConfigContent());
  assert.equal(parsed.$schema, "https://opencode.ai/config.json");
  assert.deepEqual(Object.keys(parsed.agent), [KAIRO_ASK_AGENT_NAME]);
  assert.deepEqual(parsed.agent[KAIRO_ASK_AGENT_NAME], KAIRO_ASK_AGENT_CONFIG);
});

test("the config env var is opencode's inline-config variable (highest user-level precedence: beats global and project opencode.json)", () => {
  assert.equal(KAIRO_ASK_CONFIG_ENV, "OPENCODE_CONFIG_CONTENT");
});

function okChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setTimeout(() => {
    child.stdout.emit("data", JSON.stringify({ type: "text", part: { text: "ok" } }) + "\n");
    child.emit("close", 0);
  }, 0);
  return child;
}

test("an ask run injects the isolated config through the env and never touches the user's global opencode.json (temp HOME)", async () => {
  const home = await mkdtemp(join(tmpdir(), "kairo-ask-home-"));
  try {
    const configDir = join(home, ".config", "opencode");
    await mkdir(configDir, { recursive: true });
    const globalFile = join(configDir, "opencode.json");
    const original = JSON.stringify({ $schema: "https://opencode.ai/config.json", agent: { explore: { mode: "subagent" } } }, null, 2);
    await writeFile(globalFile, original, "utf8");

    const seen = [];
    const result = await askProvider({
      provider: "opencode-go", question: "q", model: "kimi-k3", cwd: home,
      sourceEnv: { PATH: "/usr/bin", HOME: home, OPENCODE_CONFIG_CONTENT: "{\"malicious\":true}" },
      spawn: (cmd, args, options) => { seen.push({ cmd, args, options }); return okChild(); }
    });

    assert.equal(result.status, "answered");
    assert.equal(await readFile(globalFile, "utf8"), original, "global opencode.json must stay byte-identical");
    assert.deepEqual(await readdir(configDir), ["opencode.json"], "no extra file is created in the user's config dir");
    const env = seen[0].options.env;
    assert.equal(env.OPENCODE_CONFIG_CONTENT, buildKairoAskConfigContent(), "the caller's own inline config must never leak into the ask run");
    assert.ok(seen[0].args.includes(KAIRO_ASK_AGENT_NAME));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
