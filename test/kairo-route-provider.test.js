import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { buildKairoProviderModels, createKairoRouteProvider } from "../src/global/host/kairo-route-provider.js";

const strategy = {
  status: "active",
  projectTeam: [
    { role: "Builder", model: { adapterId: "codex", modelId: "gpt-6-astra", displayName: "GPT-6 Astra", accessMode: "automatic" } },
    { role: "Reviewer", model: { adapterId: "opencode-go", modelId: "deepseek-v4.1", displayName: "DeepSeek V4.1", accessMode: "automatic" } },
    { role: "Architect", model: { adapterId: "claude", modelId: "fable", displayName: "Claude Fable", accessMode: "manual" } },
    { role: "Tester", model: { adapterId: "cursor", modelId: "gemini", displayName: "Gemini", accessMode: "automatic" } }
  ]
};

function resolveAdapter(id) {
  return {
    id,
    availability() {
      return id === "cursor"
        ? { launchable: false, reason: "Cursor access is not verified." }
        : { launchable: true, reason: null };
    },
    buildLaunch({ task, cwd, model }) {
      return { command: id, args: ["--model", model, task], cwd, env: {} };
    }
  };
}

test("buildKairoProviderModels exposes only active automatic and launchable project routes", () => {
  const models = buildKairoProviderModels({ strategy, cwd: "/workspace", resolveAdapter });

  assert.deepEqual(models.map((model) => [model.id, model.name]), [
    ["codex::gpt-6-astra", "GPT-6 Astra · Builder"],
    ["opencode-go::deepseek-v4.1", "DeepSeek V4.1 · Reviewer"]
  ]);
});

test("buildKairoProviderModels fails closed when a strategy is not active", () => {
  assert.deepEqual(
    buildKairoProviderModels({ strategy: { ...strategy, status: "suggested" }, cwd: "/workspace", resolveAdapter }),
    []
  );
});

test("Kairo provider runs the selected native route and returns Pi text events", async () => {
  const models = buildKairoProviderModels({ strategy, resolveAdapter });
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let launch;
  const provider = createKairoRouteProvider({
    models,
    cwd: "/workspace",
    resolveAdapter,
    spawnImpl(command, args, options) {
      launch = { command, args, options };
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from('{"type":"assistant","content":"Kairo result"}\n'));
        child.emit("close", 0);
      });
      return child;
    }
  });

  const stream = provider.streamSimple(
    { id: "codex::gpt-6-astra" },
    { messages: [{ role: "user", content: [{ type: "text", text: "Explain this project" }] }] }
  );
  const events = [];
  for await (const event of stream) events.push(event);

  assert.equal(launch.command, "codex");
  assert.match(launch.args.at(-1), /Explain this project/);
  assert.equal(events.at(-1).type, "done");
  assert.equal(events.at(-1).message.content[0].text, "Kairo result");
});
