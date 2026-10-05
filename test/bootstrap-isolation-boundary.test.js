/**
 * Contract cases for Bootstrap isolation docs:
 * - writes outside the snapshot are not in the SBPL write allowlist
 * - incompatible configs never claim a held verified/restricted boundary
 *
 * Orthogonal to native RDD assess (persistence may still be high/due without approval).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexSandboxProfile } from "../src/global/conversation/codex-sandbox.js";
import { buildCursorSandboxProfile } from "../src/global/conversation/cursor-sandbox.js";
import {
  createBootstrapAnalyzerAdapter,
  createClaudeBootstrapAnalyzerAdapter,
  createCodexBootstrapAnalyzerAdapter,
  createCursorBootstrapAnalyzerAdapter
} from "../src/global/conversation/bootstrap-analyzer-adapters.js";

const OUTSIDE_WORKSPACE = "/Users/someone/other-repo/secret.txt";
const OUTSIDE_HOME = "/etc/passwd";

function writeAllowBlock(profile) {
  const parts = profile.split("(allow file-write*");
  assert.equal(parts.length >= 2, true, "profile must declare file-write allow");
  return parts[1];
}

test("Codex SBPL write allowlist excludes paths outside the snapshot workspace", async () => {
  const snapshotRoot = "/tmp/kairo-snap-outside-1";
  const profile = await buildCodexSandboxProfile(
    { snapshotRoot, codexHome: "/Users/kal-el/.codex" },
    { realpath: async (p) => p }
  );
  const writeBlock = writeAllowBlock(profile);
  assert.match(writeBlock, new RegExp(`\\(subpath "${snapshotRoot}"\\)`));
  assert.doesNotMatch(writeBlock, new RegExp(OUTSIDE_WORKSPACE.replaceAll("/", "\\/")));
  assert.doesNotMatch(writeBlock, /\(subpath "\/etc"\)/);
  assert.doesNotMatch(writeBlock, /\(subpath "\/Users\/someone\/other-repo"\)/);
  assert.match(profile, /\(deny default\)/);
});

test("Cursor SBPL write allowlist excludes paths outside the snapshot workspace", async () => {
  const snapshotRoot = "/tmp/kairo-cursor-snap-outside-1";
  const profile = await buildCursorSandboxProfile(
    {
      snapshotRoot,
      cursorHome: "/Users/kal-el/.cursor",
      cursorLocalHome: "/Users/kal-el/.local",
      keychainsHome: "/Users/kal-el/Library/Keychains"
    },
    { realpath: async (p) => p }
  );
  const writeBlock = writeAllowBlock(profile);
  assert.match(writeBlock, new RegExp(`\\(subpath "${snapshotRoot}"\\)`));
  assert.doesNotMatch(writeBlock, new RegExp(OUTSIDE_HOME.replaceAll("/", "\\/")));
  assert.doesNotMatch(writeBlock, /\(subpath "\/Users\/someone\/other-repo"\)/);
  assert.doesNotMatch(writeBlock, /\(subpath "\/etc"\)/);
  // ~/.local is read+exec for the binary tree, not a general write root
  assert.doesNotMatch(writeBlock, /\(subpath "\/Users\/kal-el\/\.local"\)/);
});

test("incompatible: Codex off macOS never claims verified isolation", async () => {
  const adapter = createCodexBootstrapAnalyzerAdapter({
    modelId: "codex-model",
    deps: {
      getCodexIsolationStatus: async () => ({
        available: false,
        platform: "linux",
        boundaryVerified: false,
        reason: "OS-level read confinement for Codex (sandbox-exec) is only implemented for macOS"
      })
    }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.isolation, "unverified");
  assert.equal(eligibility.canaryTested, false);
  assert.match(eligibility.reason, /macOS/);
});

test("incompatible: Cursor without sandbox-exec never claims verified isolation", async () => {
  const adapter = createCursorBootstrapAnalyzerAdapter({
    modelId: "cursor:auto",
    deps: {
      probeCursorAuth: async () => ({ authenticated: true, status: "measured", source: "test", reason: null }),
      getCursorIsolationStatus: async () => ({
        available: false,
        platform: "darwin",
        boundaryVerified: false,
        reason: "sandbox-exec missing"
      })
    }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.isolation, "unverified");
  assert.equal(eligibility.canaryTested, false);
  assert.match(eligibility.reason, /sandbox-exec/);
});

test("incompatible: Claude stays restricted, never verified, even when eligible", async () => {
  const adapter = createClaudeBootstrapAnalyzerAdapter({
    modelId: "claude-sonnet-5",
    deps: {
      verifyClaudeSubscriptionAuth: async () => ({ mode: "subscription", subscriptionType: "pro" }),
      readClaudeModels: () => ({
        status: "documented",
        source: "test",
        models: [{ id: "claude-sonnet-5" }],
        error: null
      })
    }
  });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.isolation, "restricted");
  assert.notEqual(eligibility.isolation, "verified");
  assert.equal(eligibility.canaryTested, true);
});

test("incompatible: unknown adapter never falls through to another provider boundary", async () => {
  const adapter = createBootstrapAnalyzerAdapter("opencode", { modelId: "any" });
  const eligibility = await adapter.checkEligibility();
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.isolation, "unverified");
  assert.equal(eligibility.canaryTested, false);
  assert.match(eligibility.reason, /No Bootstrap Analyzer adapter/);
  await assert.rejects(() => adapter.analyze({ question: "q", snapshotRoot: "/tmp/x" }), /No Bootstrap Analyzer adapter/);
});
