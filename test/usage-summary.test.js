import assert from "node:assert/strict";
import { test } from "node:test";
import { buildUsageModel, formatSubscriptionUsageSegments, quotaWarnSuffix } from "../src/global/conversation/usage-summary.js";

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

test("buildUsageModel exposes a structured providers -> windows shape (label, remainingPercent, level) the widget can bar-render without re-parsing text", () => {
  const model = buildUsageModel({
    usage: {
      codex: { primary: { remainingPercent: 58 }, secondary: { remainingPercent: 10 } },
      claude: { primary: { remainingPercent: 34 } },
      opencode: { go: { windows: [{ remainingPercent: 100 }, { remainingPercent: 0, status: "rate-limited" }] } }
    },
    providers: {}
  });

  assert.deepEqual(model, [
    {
      name: "Codex",
      windows: [
        { label: "5h", remainingPercent: 58, level: "normal" },
        { label: "W", remainingPercent: 10, level: "low" }
      ],
      fallbackStatus: "usage unknown"
    },
    {
      name: "Claude",
      windows: [{ label: "S", remainingPercent: 34, level: "normal" }],
      fallbackStatus: "usage unknown"
    },
    {
      name: "Go",
      windows: [
        { label: null, remainingPercent: 100, level: "normal" },
        { label: null, remainingPercent: 0, level: "limited" }
      ],
      fallbackStatus: "usage unknown"
    }
  ]);
});

test("buildUsageModel reports an empty windows array plus the real provider status (or honest unknown) when a provider has no measured usage", () => {
  const model = buildUsageModel({ usage: {}, providers: { claude: { status: "Pro · usage unknown" } } });

  assert.deepEqual(model[0], { name: "Codex", windows: [], fallbackStatus: "usage unknown" });
  assert.deepEqual(model[1], { name: "Claude", windows: [], fallbackStatus: "Pro · usage unknown" });
  assert.deepEqual(model[2], { name: "Go", windows: [], fallbackStatus: "usage unknown" });
});

test("buildUsageModel and formatSubscriptionUsageSegments agree: the text formatter is built from the same structured model", () => {
  const args = {
    usage: {
      codex: { primary: { remainingPercent: 58 }, secondary: { remainingPercent: 86 } },
      claude: { primary: { remainingPercent: 34 }, secondary: { remainingPercent: 65 } },
      opencode: { go: { windows: [{ remainingPercent: 100 }, { remainingPercent: 100 }, { remainingPercent: 96 }] } }
    },
    providers: {}
  };

  assert.deepEqual(formatSubscriptionUsageSegments(args), [
    "Codex 5h 58% / W 86%",
    "Claude S 34% / W 65%",
    "Go 100% / 100% / 96%"
  ]);
  assert.deepEqual(buildUsageModel(args).map((p) => p.name), ["Codex", "Claude", "Go"]);
});
