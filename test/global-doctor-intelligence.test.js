import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGlobalDoctorChecks } from "../src/global/global-doctor.js";
import { BACKEND_IDS, ENTITLEMENT_STATES } from "../src/global/intelligence/index.js";

async function fakeHome() {
  const homeDir = await mkdtemp(join(tmpdir(), "kairo-doctor-intel-"));
  await mkdir(join(homeDir, ".cursor"), { recursive: true });
  return homeDir;
}

function findIntel(checks) {
  return checks.find((check) => check.name === "intelligence providers");
}

test("doctor intelligence advisory stays ok with no providers", async () => {
  const homeDir = await fakeHome();
  const { checks, ok } = await runGlobalDoctorChecks(homeDir, {
    packageRoot: null,
    inspectBackends: async () => []
  });
  const intel = findIntel(checks);
  assert.equal(intel.status, "ok");
  assert.equal(intel.category, "intelligence");
  assert.match(intel.detail, /Optional|Ollama|OPENCODE_API_KEY|OPENROUTER/i);
  assert.equal(ok, false); // missing state.json — intel warning would never flip this
});

test("doctor distinguishes Go/Zen configured vs authenticated", async () => {
  const homeDir = await fakeHome();
  const { checks, ok } = await runGlobalDoctorChecks(homeDir, {
    packageRoot: null,
    inspectBackends: async () => [
      {
        id: BACKEND_IDS.OPENCODE_GO,
        configured: true,
        authenticated: false,
        hasApiKey: true,
        entitlement: ENTITLEMENT_STATES.UNVERIFIED
      },
      {
        id: BACKEND_IDS.OPENCODE_ZEN,
        configured: true,
        authenticated: true,
        hasApiKey: true,
        entitlement: ENTITLEMENT_STATES.UNVERIFIED
      }
    ]
  });
  const intel = findIntel(checks);
  assert.equal(intel.status, "ok");
  assert.match(intel.detail, /OpenCode Go \(configured/);
  assert.match(intel.detail, /OpenCode Zen \(authenticated/);
  assert.match(intel.detail, /never prove subscription|entitlement/i);
  assert.ok(!/sk-|OPENCODE_API_KEY=/.test(intel.detail));
  assert.equal(ok, false);
});

test("doctor reports runtime installed without claiming authentication", async () => {
  const homeDir = await fakeHome();
  const { checks } = await runGlobalDoctorChecks(homeDir, {
    packageRoot: null,
    inspectBackends: async () => [
      {
        id: BACKEND_IDS.OPENCODE,
        available: true,
        detected: true,
        configured: true,
        authenticated: false,
        evidence: { authProviders: ["Anthropic"] }
      }
    ]
  });
  const intel = findIntel(checks);
  assert.equal(intel.status, "ok");
  assert.match(intel.detail, /OpenCode CLI runtime/);
  assert.match(intel.detail, /Anthropic/);
  assert.match(intel.detail, /not authenticated by Kairo/);
});

test("doctor inspector failure is non-blocking warning", async () => {
  const homeDir = await fakeHome();
  const { checks, ok } = await runGlobalDoctorChecks(homeDir, {
    packageRoot: null,
    inspectBackends: async () => {
      throw new Error("probe down");
    }
  });
  const intel = findIntel(checks);
  assert.equal(intel.status, "warning");
  assert.match(intel.detail, /probe down/);
  assert.match(intel.detail, /unchanged/i);
  assert.equal(ok, false);
  assert.ok(!checks.some((check) => check.name === "intelligence providers" && ["missing", "stale"].includes(check.status)));
});
