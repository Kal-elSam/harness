/**
 * Simulated-Pi evidence: approval -> Architect -> set_model -> engine state.
 *
 * Everything here uses a FAKE instrumented Pi child (scripts/fixtures/fake-pi-child.mjs),
 * a temp HARNESS_HOME and a temp git repo. No real provider, no real Pi, no network.
 * Assertions read the RECORDED protocol (fake-pi-requests.jsonl and the sidecar
 * stdout records), never screen text.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { runKairoUiRpcStdio } from "../src/global/host/kairo-ui-rpc-stdio.js";
import { readProjectStrategy } from "../src/global/conversation/project-strategy-store.js";
import {
  ARCHITECT_MODEL_ID,
  FAKE_PI_REQUESTS,
  SCENARIOS,
  buildSimulatedHostOptions,
  seedSuggestedTeam
} from "../scripts/fixtures/simulated-pi-host.mjs";
import { parseJsonl } from "../scripts/fixtures/sidecar-evidence.mjs";

const NO_ROUTES_REASON = "No active strategy with automatic launchable projectTeam routes";
const NO_ARCHITECT_REASON =
  "No Architect assignment with automatic access and a launchable adapter in projectTeam";

async function pollUntil(pred, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 15));
  }
  return pred();
}

/** Start the real sidecar loop with the simulated-Pi host options in temp dirs. */
async function startHost(scenario, { seedStatus = "suggested", connectTimeoutMs = 400 } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "sim-pi-connect-")));
  const home = join(base, "home");
  const proj = join(base, "proj");
  const evidence = join(base, "evidence");
  for (const d of [home, proj, evidence]) mkdirSync(d, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: proj });

  const savedHome = process.env.HARNESS_HOME;
  process.env.HARNESS_HOME = home;
  const restore = () => {
    if (savedHome === undefined) delete process.env.HARNESS_HOME;
    else process.env.HARNESS_HOME = savedHome;
  };

  const seeded = await seedSuggestedTeam({ homeDir: home, cwd: proj, scenario, status: seedStatus });
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const records = [];
  let buffer = "";
  stdout.on("data", (chunk) => {
    buffer += String(chunk);
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines.filter(Boolean)) records.push(JSON.parse(line));
  });
  const options = buildSimulatedHostOptions({
    cwd: proj,
    evidenceDir: evidence,
    scenario,
    connectTimeoutMs,
    env: { ...process.env, HARNESS_HOME: home, HOME: home }
  });
  const started = Date.now();
  const run = runKairoUiRpcStdio({ stdin, stdout, ...options });
  return {
    base,
    home,
    proj,
    seeded,
    records,
    started,
    send: (op) => stdin.write(`${JSON.stringify(op)}\n`),
    requests: () => {
      const file = join(evidence, FAKE_PI_REQUESTS);
      return existsSync(file) ? parseJsonl(readFileSync(file, "utf8")).records : [];
    },
    ofType: (type) => records.filter((r) => r.type === type),
    async stop() {
      stdin.write(`${JSON.stringify({ op: "stop" })}\n`);
      stdin.end();
      await run;
      restore();
      rmSync(base, { recursive: true, force: true });
    }
  };
}

const setModels = (host) => host.requests().filter((r) => r.type === "set_model");

test("positive: approval re-applies the Architect via set_model and an explicit connected engine record follows", async () => {
  const host = await startHost("positive");
  try {
    assert.ok(await pollUntil(() => host.ofType("ready").length === 1), "ready record");
    const ready = host.ofType("ready")[0];
    // Before approval the engine is NOT required to be connected; record what is true.
    assert.equal(ready.engine.status, "no_model");
    assert.equal(ready.engine.reason, NO_ROUTES_REASON);
    assert.equal(setModels(host).length, 0, "no set_model before approval (no active team)");

    host.send({ op: "team.approve" });
    assert.ok(await pollUntil(() => host.ofType("engine").length >= 1), "engine record after approval");

    const sets = setModels(host);
    assert.equal(sets.length, 1);
    assert.equal(sets[0].params.provider, "kairo");
    assert.equal(sets[0].params.modelId, ARCHITECT_MODEL_ID);

    const engine = host.ofType("engine").at(-1);
    assert.equal(engine.engine.status, "connected");
    assert.equal(engine.engine.reason, null);
    assert.equal(engine.engine.model.provider, "kairo");
    assert.equal(engine.engine.model.id, ARCHITECT_MODEL_ID, "model identity coherent with set_model");
    assert.equal(engine.modelLabel, ARCHITECT_MODEL_ID);

    // Ordering from the recorded protocol: get_state(s) ... set_model ... get_state.
    const types = host.requests().map((r) => r.type);
    assert.ok(types.lastIndexOf("get_state") > types.indexOf("set_model"), types.join(","));

    const strategy = await readProjectStrategy(host.home, host.seeded.projectRoot);
    assert.equal(strategy.status, "active", "approval went through the real service");
    assert.ok(host.ofType("team").length >= 1 || host.ofType("notice").some((r) => /Team active/.test(r.message)));
  } finally {
    await host.stop();
  }
});

test("absent Architect route: no_model with the existing reason and set_model never sent", async () => {
  const host = await startHost("no-architect-route");
  try {
    assert.ok(await pollUntil(() => host.ofType("ready").length === 1));
    host.send({ op: "team.approve" });
    assert.ok(await pollUntil(() => host.ofType("engine").length >= 1));
    const engine = host.ofType("engine").at(-1).engine;
    assert.equal(engine.status, "no_model");
    assert.equal(engine.reason, NO_ARCHITECT_REASON);
    assert.equal(setModels(host).length, 0, "fake Pi must not receive set_model");
  } finally {
    await host.stop();
  }
});

test("empty model list (adapter not launchable): no_model with the existing reason and set_model never sent", async () => {
  const host = await startHost("unlaunchable-route");
  try {
    assert.ok(await pollUntil(() => host.ofType("ready").length === 1));
    host.send({ op: "team.approve" });
    assert.ok(await pollUntil(() => host.ofType("engine").length >= 1));
    const engine = host.ofType("engine").at(-1).engine;
    assert.equal(engine.status, "no_model");
    assert.equal(engine.reason, NO_ROUTES_REASON);
    assert.equal(setModels(host).length, 0);
    assert.deepEqual(host.ofType("kairoModels").at(-1).kairoModels, []);
  } finally {
    await host.stop();
  }
});

test("set_model failure: no_model with the set_model failed cause; the request WAS sent", async () => {
  const host = await startHost("set-model-fails");
  try {
    assert.ok(await pollUntil(() => host.ofType("ready").length === 1));
    host.send({ op: "team.approve" });
    assert.ok(await pollUntil(() => host.ofType("engine").length >= 1));
    const engine = host.ofType("engine").at(-1).engine;
    assert.equal(engine.status, "no_model");
    assert.match(engine.reason, /set_model failed/);
    assert.match(engine.reason, /simulated set_model failure/);
    assert.equal(setModels(host).length, 1);
    assert.equal(setModels(host)[0].params.modelId, ARCHITECT_MODEL_ID);
  } finally {
    await host.stop();
  }
});

test("placeholder model reported by Pi after set_model: no_model, never connected", async () => {
  const host = await startHost("placeholder-model");
  try {
    assert.ok(await pollUntil(() => host.ofType("ready").length === 1));
    host.send({ op: "team.approve" });
    assert.ok(await pollUntil(() => host.ofType("engine").length >= 1));
    const engine = host.ofType("engine").at(-1);
    assert.equal(engine.engine.status, "no_model");
    assert.equal(engine.engine.reason, "No model selected");
    assert.equal(engine.engine.model, null);
    assert.equal(setModels(host).length, 1, "set_model was sent; the placeholder came back from Pi");
  } finally {
    await host.stop();
  }
});

test("missing protocol (Pi never answers get_state): ready is explicit unavailable within the bounded timeout", async () => {
  const host = await startHost("silent-get-state", { connectTimeoutMs: 300 });
  try {
    assert.ok(await pollUntil(() => host.ofType("ready").length === 1, 4000), "ready still arrives");
    const elapsed = Date.now() - host.started;
    const ready = host.ofType("ready")[0];
    assert.equal(ready.engine.status, "unavailable");
    assert.match(ready.engine.reason, /timed out waiting for get_state/);
    assert.ok(elapsed < 3000, `bounded: ${elapsed}ms`);
    assert.deepEqual(host.requests().map((r) => r.type), ["get_state"], "request recorded though unanswered");
  } finally {
    await host.stop();
  }
});

test("timeout on set_model (active team at startup): no_model naming the set_model timeout", async () => {
  const host = await startHost("silent-set-model", { seedStatus: "active", connectTimeoutMs: 300 });
  try {
    assert.ok(await pollUntil(() => host.ofType("ready").length === 1, 4000));
    const ready = host.ofType("ready")[0];
    assert.equal(ready.engine.status, "no_model");
    assert.match(ready.engine.reason, /set_model failed/);
    assert.match(ready.engine.reason, /timed out waiting for set_model/);
    assert.equal(setModels(host).length, 1);
  } finally {
    await host.stop();
  }
});

test("scenario table covers the documented cases", () => {
  assert.deepEqual(Object.keys(SCENARIOS).sort(), [
    "no-architect-route",
    "placeholder-model",
    "positive",
    "set-model-fails",
    "silent-get-state",
    "silent-set-model",
    "unlaunchable-route"
  ]);
});
