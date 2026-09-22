import { spawn as defaultSpawn } from "node:child_process";
import { resolveProjectRoot as defaultResolveProjectRoot } from "../architect/architect-store.js";
import { readProjectStrategy as defaultReadProjectStrategy } from "../conversation/project-strategy-store.js";
import { resolveHomeDir as defaultResolveHomeDir } from "../paths.js";
import { resolveExecutionAdapter as defaultResolveAdapter } from "../runtime/execution-adapters/index.js";
import { formatTranscriptEventText } from "../runtime/run-events.js";
import { toRuntimeModelRef } from "../intelligence/transport-registry.js";

const PROVIDER_ID = "kairo";
const API_ID = "kairo-cli";

function routeId(adapterId, modelId) {
  return `${adapterId}::${modelId}`;
}

function launchModelRef(adapterId, modelId) {
  if (adapterId === "opencode-go") return toRuntimeModelRef("go", modelId);
  if (adapterId === "opencode-zen") return toRuntimeModelRef("zen", modelId);
  return modelId;
}

function routeModel(entry, adapter) {
  const model = entry?.model;
  if (!model || model.accessMode !== "automatic") return null;
  const availability = adapter.availability({});
  if (!availability?.launchable) return null;
  const modelId = String(model.modelId ?? "").trim();
  if (!modelId) return null;
  const adapterId = String(model.adapterId ?? "").trim();
  if (!adapterId) return null;
  return {
    id: routeId(adapterId, modelId),
    name: `${model.displayName ?? modelId} · ${entry.role ?? "Kairo route"}`,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 16384,
    kairoRoute: { adapterId, modelId, role: entry.role ?? "Unknown role" }
  };
}

/**
 * The Pi model picker gets only active, automatic Kairo assignments whose
 * real execution adapter is launchable. Manual/PAYG and unavailable routes
 * are intentionally absent rather than rendered as selectable fiction.
 */
export function buildKairoProviderModels({
  strategy,
  resolveAdapter = defaultResolveAdapter
} = {}) {
  if (strategy?.status !== "active" || !Array.isArray(strategy.projectTeam)) return [];
  const seen = new Set();
  const models = [];
  for (const entry of strategy.projectTeam) {
    const adapterId = entry?.model?.adapterId;
    if (typeof adapterId !== "string" || !adapterId) continue;
    let adapter;
    try {
      adapter = resolveAdapter(adapterId);
    } catch {
      continue;
    }
    const candidate = routeModel(entry, adapter);
    if (!candidate || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    models.push(candidate);
  }
  return models;
}

/** Reads only Kairo's persisted strategy and local adapter facts. */
export async function loadKairoProviderModels({ cwd = process.cwd() } = {}, deps = {}) {
  const projectRoot = await (deps.resolveProjectRoot ?? defaultResolveProjectRoot)(cwd);
  const homeDir = (deps.resolveHomeDir ?? defaultResolveHomeDir)();
  const strategy = await (deps.readProjectStrategy ?? defaultReadProjectStrategy)(homeDir, projectRoot);
  return buildKairoProviderModels({ strategy, resolveAdapter: deps.resolveAdapter ?? defaultResolveAdapter });
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

export function promptFromPiContext(context) {
  const messages = Array.isArray(context?.messages) ? context.messages : [];
  const lines = messages
    .filter((message) => message?.role === "system" || message?.role === "user" || message?.role === "assistant")
    .map((message) => `${String(message.role).toUpperCase()}: ${textFromContent(message.content)}`)
    .filter((line) => line.trim().length > 0);
  return lines.join("\n\n").slice(-24_000);
}

function emptyUsage() {
  return {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}

function assistantMessage(model, content = [], errorMessage = null) {
  return {
    role: "assistant",
    content,
    api: API_ID,
    provider: PROVIDER_ID,
    model: model.id,
    usage: emptyUsage(),
    stopReason: errorMessage ? "error" : "stop",
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now()
  };
}

class KairoAssistantEventStream {
  #events = [];
  #waiters = [];
  #closed = false;
  #result;
  #resolveResult;

  constructor() {
    this.#result = new Promise((resolve) => { this.#resolveResult = resolve; });
  }

  push(event) {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.#events.push(event);
  }

  finish(event) {
    if (this.#closed) return;
    this.push(event);
    this.#closed = true;
    this.#resolveResult(event.type === "done" ? event.message : event.error);
    for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  result() {
    return this.#result;
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      if (this.#events.length) yield this.#events.shift();
      else if (this.#closed) return;
      else {
        const next = await new Promise((resolve) => this.#waiters.push(resolve));
        if (next.done) return;
        yield next.value;
      }
    }
  }
}

function textFromOutput(stdout) {
  const parts = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const text = formatTranscriptEventText(JSON.parse(line));
      if (text && !text.startsWith("{")) parts.push(text);
    } catch {
      parts.push(line);
    }
  }
  return parts.join("\n").trim();
}

function streamRoute({ model, route, context, options, cwd, resolveAdapter, spawnImpl }) {
  const stream = new KairoAssistantEventStream();
  queueMicrotask(() => {
    let child;
    let stdout = "";
    let stderr = "";
    const fail = (error) => stream.finish({ type: "error", reason: "error", error: assistantMessage(model, [], String(error?.message ?? error)) });
    try {
      const adapter = resolveAdapter(route.adapterId);
      const availability = adapter.availability({ cwd });
      if (!availability?.launchable) throw new Error(availability?.reason ?? `${route.adapterId} is not launchable.`);
      const launch = adapter.buildLaunch({
        task: promptFromPiContext(context),
        cwd,
        model: launchModelRef(route.adapterId, route.modelId),
        permissions: []
      });
      child = spawnImpl(launch.command, launch.args, { cwd: launch.cwd, env: launch.env, stdio: ["ignore", "pipe", "pipe"] });
      options?.signal?.addEventListener?.("abort", () => child?.kill?.(), { once: true });
      child.once?.("error", fail);
      child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
      child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
      child.once?.("close", (code) => {
        const text = textFromOutput(stdout);
        if (code !== 0) return fail(stderr.trim() || text || `${route.adapterId} exited with code ${code}.`);
        const message = assistantMessage(model, [{ type: "text", text }]);
        stream.push({ type: "start", partial: message });
        stream.push({ type: "text_start", contentIndex: 0, partial: message });
        stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
        stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
        stream.finish({ type: "done", reason: "stop", message });
      });
    } catch (error) {
      fail(error);
    }
  });
  return stream;
}

/**
 * Pi provider config backed by Kairo's own CLI adapters. No API credential is
 * copied into Pi: execution remains in the already-authenticated native CLI.
 */
export function createKairoRouteProvider({
  models,
  cwd = process.cwd(),
  resolveAdapter = defaultResolveAdapter,
  spawnImpl = defaultSpawn
} = {}) {
  const routes = new Map((models ?? []).map((model) => [model.id, model.kairoRoute]));
  return {
    name: "Kairo Routes",
    baseUrl: "kairo://local",
    api: API_ID,
    apiKey: "kairo-local",
    models: (models ?? []).map(({ kairoRoute: _route, ...model }) => model),
    streamSimple(model, context, options) {
      const route = routes.get(model?.id);
      if (!route) {
        const stream = new KairoAssistantEventStream();
        queueMicrotask(() => stream.finish({ type: "error", reason: "error", error: assistantMessage(model ?? { id: "unknown" }, [], "Unknown Kairo route.") }));
        return stream;
      }
      return streamRoute({ model, route, context, options, cwd, resolveAdapter, spawnImpl });
    }
  };
}
