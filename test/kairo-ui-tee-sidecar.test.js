/**
 * The wrapper sidecar must be transparent: the bytes the host (Ratatui) reads
 * on stdout are byte-identical to sidecar.jsonl, and stderr is logged
 * separately. Simulated Pi only (fake child, temp dirs, no network/providers).
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { seedSuggestedTeam } from "../scripts/fixtures/simulated-pi-host.mjs";
import {
  SIDECAR_JSONL,
  SIDECAR_STDERR_LOG,
  findReady,
  parseJsonl
} from "../scripts/fixtures/sidecar-evidence.mjs";

const WRAPPER = join(dirname(fileURLToPath(import.meta.url)), "../scripts/fixtures/kairo-ui-tee-sidecar.mjs");

function sandbox() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "tee-sidecar-")));
  const home = join(base, "home");
  const proj = join(base, "proj");
  const evidence = join(base, "evidence");
  for (const d of [home, proj, evidence]) mkdirSync(d, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: proj });
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: home,
    HARNESS_HOME: home,
    KAIRO_EVIDENCE_DIR: evidence
  };
  return { base, home, proj, evidence, env };
}

function runWrapper({ proj, env }, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WRAPPER, "--cwd", proj], { env, stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    child.stdout.on("data", (c) => out.push(Buffer.from(c)));
    child.stderr.on("data", (c) => err.push(Buffer.from(c)));
    child.on("close", (code) => resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err) }));
    child.stdin.write(input);
    child.stdin.end();
  });
}

test("wrapper stdout is byte-identical to sidecar.jsonl and carries the real ready record", async () => {
  const sb = sandbox();
  try {
    await seedSuggestedTeam({ homeDir: sb.home, cwd: sb.proj, scenario: "positive" });
    const result = await runWrapper(
      { ...sb, env: { ...sb.env, KAIRO_SIM_PI_SCENARIO: "positive" } },
      `${JSON.stringify({ op: "stop" })}\n`
    );
    assert.equal(result.code, 0, result.stderr.toString());
    const teed = readFileSync(join(sb.evidence, SIDECAR_JSONL));
    assert.ok(teed.length > 0, "sidecar.jsonl not empty");
    assert.deepEqual(teed, result.stdout, "tee must be byte-identical to host-visible stdout");
    const { records, malformed } = parseJsonl(result.stdout.toString("utf8"));
    assert.equal(malformed, 0, "stdout carries protocol JSONL only");
    const ready = findReady(records);
    assert.ok(ready, "ready record present");
    assert.equal(ready.engine.status, "no_model", "suggested team: no active Architect route yet");
  } finally {
    rmSync(sb.base, { recursive: true, force: true });
  }
});

test("wrapper reports startup errors on stderr and logs them separately, redacted", async () => {
  const sb = sandbox();
  try {
    const result = await runWrapper(
      {
        ...sb,
        env: { ...sb.env, KAIRO_SIM_PI_SCENARIO: "bogus sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" }
      },
      ""
    );
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout.length, 0, "nothing on stdout");
    assert.match(result.stderr.toString(), /Unknown simulated-Pi scenario/);
    const log = readFileSync(join(sb.evidence, SIDECAR_STDERR_LOG), "utf8");
    assert.match(log, /Unknown simulated-Pi scenario/);
    assert.doesNotMatch(log, /sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789/);
    assert.equal(existsSync(join(sb.evidence, SIDECAR_JSONL)) ? readFileSync(join(sb.evidence, SIDECAR_JSONL)).length : 0, 0);
  } finally {
    rmSync(sb.base, { recursive: true, force: true });
  }
});
