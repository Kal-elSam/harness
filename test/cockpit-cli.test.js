import test from "node:test";
import assert from "node:assert/strict";
import { runCockpitCli } from "../src/global/cockpit/cli.js";

test("kairo start refuses to run outside a TTY", async () => {
  await assert.rejects(
    () => runCockpitCli({ cwd: "/repo" }, { interactive: false }),
    /requires an interactive terminal/
  );
});

test("kairo start boots the cockpit app and waits for it to finish", async () => {
  let stopped = false;
  let resolveDone;
  const done = new Promise((resolvePromise) => { resolveDone = resolvePromise; });
  const app = {
    stop: () => { stopped = true; resolveDone(); },
    done
  };
  let receivedCwd = null;
  const runCockpitApp = async ({ cwd }) => { receivedCwd = cwd; return app; };

  const promise = runCockpitCli({ cwd: "/repo" }, { interactive: true, runCockpitApp });
  app.stop();
  await promise;

  assert.equal(receivedCwd, "/repo");
  assert.equal(stopped, true);
});

test("REGRESSION: a real sessionId (from kairo start/resume) is forwarded to the cockpit app factory", async () => {
  let received = null;
  const app = { stop: () => {}, done: Promise.resolve() };
  const runCockpitApp = async (args) => { received = args; return app; };

  await runCockpitCli({ cwd: "/repo", sessionId: "real-session-id" }, { interactive: true, runCockpitApp });

  assert.deepEqual(received, { cwd: "/repo", sessionId: "real-session-id" });
});
