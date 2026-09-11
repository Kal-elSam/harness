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
