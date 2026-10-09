/**
 * Instrumented FAKE Pi child ("simulated Pi") for host-wiring evidence.
 *
 * Speaks the Pi RPC JSONL protocol the sidecar bridge uses (`get_state`,
 * `set_model`, `get_messages`) over fake stdin/stdout, and records EVERY
 * received request (type + params + id) to `<requestsPath>` as JSONL so a
 * harness can assert on the recorded protocol instead of screen text.
 *
 * This is NOT the published Pi. It validates harness + host wiring only.
 *
 * Behaviors:
 *   connected        cold start reports Pi's placeholder model; `set_model`
 *                    (provider `kairo`) succeeds and `get_state` then reports
 *                    that model (provider + id).
 *   set-model-fail   `set_model` answers success:false with an error.
 *   placeholder      `set_model` succeeds but `get_state` keeps reporting the
 *                    placeholder model.
 *   silent           never answers anything (missing protocol).
 *   silent-set-model answers `get_state`/`get_messages`, never `set_model`.
 */
import { appendFileSync } from "node:fs";
import { EventEmitter } from "node:events";

export const FAKE_PI_BEHAVIORS = Object.freeze([
  "connected",
  "set-model-fail",
  "placeholder",
  "silent",
  "silent-set-model"
]);

/** Exact placeholder shape Pi reports with no model configured. */
export const PI_PLACEHOLDER_MODEL = Object.freeze({
  id: "unknown",
  name: "unknown",
  api: "unknown",
  provider: "unknown",
  baseUrl: "",
  reasoning: false,
  input: [],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 0,
  maxTokens: 0
});

export const FAKE_PI_SESSION_ID = "fake-pi-session";

/**
 * @param {object} [options]
 * @param {string} [options.requestsPath] - JSONL file receiving every request
 * @param {string} [options.behavior]
 * @returns {EventEmitter} spawn-like child (stdin/stdout/stderr/kill)
 */
export function createFakePiChild({ requestsPath = null, behavior = "connected" } = {}) {
  if (!FAKE_PI_BEHAVIORS.includes(behavior)) {
    throw new Error(`Unknown fake Pi behavior "${behavior}"`);
  }
  const child = new EventEmitter();
  let seq = 0;
  let activeModel = { ...PI_PLACEHOLDER_MODEL };

  const record = (cmd) => {
    seq += 1;
    const { type, id, ...params } = cmd;
    if (!requestsPath) return;
    try {
      appendFileSync(requestsPath, `${JSON.stringify({ seq, type, id: id ?? null, params })}\n`);
    } catch {
      // evidence only
    }
  };

  const respond = (cmd, body) => {
    const response = { type: "response", command: cmd.type, ...body };
    if (cmd.id != null) response.id = cmd.id;
    queueMicrotask(() => child.stdout.emit("data", Buffer.from(`${JSON.stringify(response)}\n`)));
  };

  const answer = (cmd) => {
    if (behavior === "silent") return;
    if (cmd.type === "get_state") {
      respond(cmd, { success: true, data: { sessionId: FAKE_PI_SESSION_ID, model: { ...activeModel } } });
    } else if (cmd.type === "set_model") {
      if (behavior === "silent-set-model") return;
      if (behavior === "set-model-fail") {
        respond(cmd, { success: false, error: "Model not found: simulated set_model failure" });
        return;
      }
      if (behavior === "connected") {
        activeModel = {
          id: cmd.modelId,
          name: cmd.modelId,
          api: "kairo-cli",
          provider: cmd.provider,
          reasoning: true,
          input: ["text"]
        };
      }
      respond(cmd, { success: true, data: { ...activeModel } });
    } else if (cmd.type === "get_messages") {
      respond(cmd, { success: true, data: { messages: [] } });
    } else {
      respond(cmd, { success: true, data: {} });
    }
  };

  child.killed = false;
  child.stdin = new EventEmitter();
  child.stdin.write = (chunk) => {
    for (const line of String(chunk).split("\n").filter(Boolean)) {
      let cmd;
      try {
        cmd = JSON.parse(line);
      } catch {
        continue;
      }
      record(cmd);
      answer(cmd);
    }
    return true;
  };
  child.stdin.end = () => {};
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    child.killed = true;
    child.emit("exit", 0, null);
  };
  return child;
}
