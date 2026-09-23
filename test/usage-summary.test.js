import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSubscriptionUsageSegments, quotaWarnSuffix } from "../src/global/conversation/usage-summary.js";

test("formatSubscriptionUsageSegments formats Codex/Claude primary+secondary windows and Go windows in the legacy cockpit's exact order and wording", () => {
  const segments = formatSubscriptionUsageSegments({
    usage: {
      codex: { primary: { remainingPercent: 58 }, secondary: { remainingPercent: 86 } },
      claude: { primary: { remainingPercent: 34 }, secondary: { remainingPercent: 65 } },
      opencode: { go: { windows: [{ remainingPercent: 100 }, { remainingPercent: 100 }, { remainingPercent: 96 }] } }
    },
    providers: {}
  });

  assert.deepEqual(segments, [
    "Codex 5h 58% / W 86%",
    "Claude S 34% / W 65%",
    "Go 100% / 100% / 96%"
  ]);
});

test("formatSubscriptionUsageSegments flags a window LOW once it drops below the shared warning threshold, never at/above it", () => {
  const segments = formatSubscriptionUsageSegments({
    usage: {
      codex: { primary: { remainingPercent: 99 }, secondary: { remainingPercent: 10 } },
      claude: { primary: { remainingPercent: 100 }, secondary: { remainingPercent: 31 } }
    },
    providers: {}
  });

  assert.equal(segments[0], "Codex 5h 99% / W 10% LOW");
  assert.equal(segments[1], "Claude S 100% / W 31%");
});

test("formatSubscriptionUsageSegments tags an already rate-limited Go window LIMITED, never a redundant LOW alongside it", () => {
  const segments = formatSubscriptionUsageSegments({
    usage: { opencode: { go: { windows: [{ remainingPercent: 100 }, { remainingPercent: 0, status: "rate-limited" }] } } },
    providers: {}
  });

  assert.equal(segments[2], "Go 100% / 0% LIMITED");
});

test("formatSubscriptionUsageSegments falls back to provider status, then honest unknown, when a provider has no measured usage", () => {
  const segments = formatSubscriptionUsageSegments({
    usage: {},
    providers: { claude: { status: "Pro · usage unknown" } }
  });

  assert.equal(segments[0], "Codex usage unknown");
  assert.equal(segments[1], "Claude Pro · usage unknown");
  assert.equal(segments[2], "Go usage unknown");
});

test("quotaWarnSuffix stays the shared, single source for the LOW threshold", () => {
  assert.equal(quotaWarnSuffix(19), " LOW");
  assert.equal(quotaWarnSuffix(20), "");
  assert.equal(quotaWarnSuffix(20, true), "");
  assert.equal(quotaWarnSuffix(null), "");
});
