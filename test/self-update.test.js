import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGlobalInstallSpec,
  compareSemver,
  detectInstallPackageManager,
  runSelfUpdate
} from "../src/global/self-update.js";

test("compareSemver orders patch/minor/major", () => {
  assert.equal(compareSemver("0.13.1", "0.13.1"), 0);
  assert.equal(compareSemver("0.13.1", "0.13.2"), -1);
  assert.equal(compareSemver("0.14.0", "0.13.2"), 1);
  assert.equal(compareSemver("bad", "0.1.0"), null);
});

test("detectInstallPackageManager reads user agent", () => {
  assert.equal(detectInstallPackageManager({}), "npm");
  assert.equal(detectInstallPackageManager({ npm_config_user_agent: "pnpm/10.0.0" }), "pnpm");
  assert.equal(detectInstallPackageManager({ npm_execpath: "/x/yarn.js" }), "yarn");
});

test("buildGlobalInstallSpec prefers npm install -g by default", () => {
  assert.deepEqual(buildGlobalInstallSpec("@kal-elsam/kairo-runtime", "0.14.0", "npm"), {
    command: "npm",
    args: ["install", "-g", "@kal-elsam/kairo-runtime@0.14.0"],
    display: "npm install -g @kal-elsam/kairo-runtime@0.14.0"
  });
  assert.match(buildGlobalInstallSpec("@kal-elsam/kairo-runtime", "0.14.0", "pnpm").display, /pnpm add -g/);
});

test("runSelfUpdate reports current without installing", async () => {
  const calls = [];
  const report = await runSelfUpdate({
    packageName: "@kal-elsam/kairo-runtime",
    cliVersion: "0.13.1",
    json: true,
    fetchVersion: async () => "0.13.1",
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: "", stderr: "" };
    }
  });
  assert.equal(report.state, "current");
  assert.equal(report.applied, false);
  assert.equal(calls.length, 0);
});

test("runSelfUpdate with --yes installs when behind", async () => {
  const calls = [];
  const report = await runSelfUpdate({
    packageName: "@kal-elsam/kairo-runtime",
    cliVersion: "0.13.1",
    yes: true,
    json: true,
    fetchVersion: async () => "0.14.0",
    detectManager: () => "npm",
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: "ok", stderr: "" };
    }
  });
  assert.equal(report.state, "behind");
  assert.equal(report.applied, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["install", "-g", "@kal-elsam/kairo-runtime@0.14.0"]);
});

test("runSelfUpdate without --yes does not install when behind", async () => {
  const calls = [];
  const report = await runSelfUpdate({
    packageName: "@kal-elsam/kairo-runtime",
    cliVersion: "0.13.1",
    yes: false,
    json: true,
    fetchVersion: async () => "0.14.0",
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: "", stderr: "" };
    }
  });
  assert.equal(report.state, "behind");
  assert.equal(report.applied, false);
  assert.equal(calls.length, 0);
  assert.match(report.nextAction, /update --yes|npm install -g/);
});
