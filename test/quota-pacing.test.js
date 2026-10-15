import test from "node:test";
import assert from "node:assert/strict";
import { buildProviderCapacity } from "../src/global/intelligence/subscription-pressure-source.js";
import { resolveModelCost } from "../src/global/intelligence/model-cost.js";
import { parseClaudeUsageText } from "../src/global/observability/claude-usage.js";

const now = Date.parse("2026-12-31T23:00:00Z");
const model = adapterId => ({ adapterId, priceInputPerMTok: 1, priceOutputPerMTok: 1 });
const window = (remainingPercent, hours) => ({ name: "5h", remainingPercent, resetsAt: (now + hours * 3600000) / 1000 });
test("Codex primary and secondary numeric durations produce timed pacing without labels", () => {
  const codexWindow = (remainingPercent, windowDurationMins, hours) => ({
    usedPercent: 100 - remainingPercent, remainingPercent,
    used: 100 - remainingPercent, remaining: remainingPercent, windowDurationMins,
    resetsAt: (now + hours * 3600000) / 1000,
    resetsAtIso: new Date(now + hours * 3600000).toISOString()
  });
  const capacity = buildProviderCapacity({ codex: 30 }, { codex: {
    status: "measured", ordinaryUsageAllowed: true,
    primary: codexWindow(30, 300, 4.5), secondary: codexWindow(90, 10080, 84)
  } }, now).codex;
  assert.equal(capacity.quotaWindows[0].timeLeftFraction, .9);
  assert.equal(capacity.quotaWindows[0].paceFactor, .3 / .9);
  assert.equal(capacity.quotaWindows[1].timeLeftFraction, .5);
  assert.equal(capacity.quotaWindows[1].paceFactor, 1.8);
  assert.equal(capacity.quotaPaceFactor, .3 / .9);
});
test("numeric duration overrides labels; invalid durations retain Claude label inference", () => {
  for (const windowDurationMins of [300, null, 0, -1, Infinity, NaN, "300"]) {
    const capacity = buildProviderCapacity({ claude: 40 }, { claude: {
      primary: { ...window(40, 4), windowDurationMins, label: "Current session" }
    } }, now).claude;
    assert.equal(capacity.quotaPaceFactor, .5);
  }
  const capacity = buildProviderCapacity({ codex: 40 }, { codex: {
    primary: { ...window(40, 4), windowDurationMins: 600 }
  } }, now).codex;
  assert.equal(capacity.quotaWindows[0].timeLeftFraction, .4);
  assert.equal(capacity.quotaPaceFactor, 1);
});
test("Claude model-specific weekly windows do not become provider-wide pressure", () => {
  const capacity = buildProviderCapacity({ claude: 80 }, { claude: { windows: [
    { label: "Current session", remainingPercent: 80, resetsAt: (now + 3600000) / 1000 },
    { label: "Current week (all models)", remainingPercent: 80, resetsAt: (now + 86400000) / 1000 },
    { label: "Current week (Sonnet only)", remainingPercent: 0, resetsAt: (now + 86400000) / 1000 }
  ] } }, now).claude;
  assert.equal(capacity.quotaWindows.length, 2);
  assert.equal(capacity.quotaPaceFactor, 4);
});
test("pace reverses raw quota comparison for fast burn versus surplus", () => {
  const capacity = buildProviderCapacity({ codex: 40, claude: 20 }, {
    codex: { primary: window(40, 4) }, claude: { primary: window(20, .5) }
  }, now);
  assert.ok(resolveModelCost(model("codex"), capacity).weight > resolveModelCost(model("claude"), capacity).weight);
  assert.ok(resolveModelCost(model("claude"), capacity).weight < resolveModelCost(model("claude"), { claude: { quotaRemainingPercent: 20 } }).weight);
  assert.equal(capacity.codex.quotaRemainingPercent, 40);
  assert.equal(capacity.codex.quotaPaceFactor, .5);
});
test("Claude timezone reset parses across year rollover with a fixed clock", () => {
  const capacity = buildProviderCapacity({ claude: 50 }, { claude: { windows: [
    { label: "Current session", remainingPercent: 50, resetsAt: "Dec 31 at 7:00pm (America/Mexico_City)" },
    { label: "Current week (all models)", remainingPercent: 70, resetsAt: "Jan 2 at 7:00am (America/Mexico_City)" }
  ] } }, now);
  assert.equal(capacity.claude.quotaWindows[0].resetsAtIso, "2027-01-01T01:00:00.000Z");
  assert.equal(capacity.claude.quotaWindows[1].resetsAtIso, "2027-01-02T13:00:00.000Z");
  assert.equal(capacity.claude.quotaWindows[0].paceFactor, 1.25);
});
for (const [resetsAt, expectedIso] of [
  ["Oct 18 at 8am (America/Mexico_City)", "2026-10-18T14:00:00.000Z"],
  ["Oct 18 at 8:00am (America/Mexico_City)", "2026-10-18T14:00:00.000Z"],
  ["Oct 18 at 12pm (America/Mexico_City)", "2026-10-18T18:00:00.000Z"],
  ["Oct 18 at 12am (America/Mexico_City)", "2026-10-18T06:00:00.000Z"]
]) {
  test(`Claude weekly reset supports ${resetsAt}`, () => {
    const fixedNow = Date.parse("2026-10-15T21:15:00Z");
    const windows = parseClaudeUsageText(`Current week (all models): 60% used · resets ${resetsAt}`);
    const capacity = buildProviderCapacity({ claude: 40 }, { claude: { windows } }, fixedNow).claude;
    const timeLeftFraction = (Date.parse(expectedIso) - fixedNow) / (7 * 24 * 3600000);
    assert.equal(capacity.quotaWindows[0].resetsAtIso, expectedIso);
    assert.equal(capacity.quotaWindows[0].timeLeftFraction, timeLeftFraction);
    assert.equal(capacity.quotaWindows[0].paceFactor, .4 / timeLeftFraction);
    assert.equal(capacity.quotaPaceFactor, .4 / timeLeftFraction);
  });
}
for (const [line, fixedClock, expectedIso, remaining, durationHours] of [
  ["Current session: 0% used · resets Sep 11 at 7:09pm (America/Mexico_City)",
    "2026-09-12T00:00:00Z", "2026-09-12T01:09:00.000Z", 1, 5],
  ["Current week (all models): 7% used · resets Sep 13 at 7:59am (America/Mexico_City)",
    "2026-09-12T00:00:00Z", "2026-09-13T13:59:00.000Z", .93, 168],
  ["Current session: 0% used · resets Oct 15 at 6:50pm (America/Mexico_City)",
    "2026-10-15T21:15:00Z", "2026-10-16T00:50:00.000Z", 1, 5]
]) {
  test(`Claude minute-bearing usage line remains timed: ${line}`, () => {
    const fixedNow = Date.parse(fixedClock);
    const windows = parseClaudeUsageText(line);
    const capacity = buildProviderCapacity({ claude: remaining * 100 }, { claude: { windows } }, fixedNow).claude;
    const timeLeftFraction = (Date.parse(expectedIso) - fixedNow) / (durationHours * 3600000);
    assert.equal(capacity.quotaWindows[0].resetsAtIso, expectedIso);
    assert.equal(capacity.quotaWindows[0].timeLeftFraction, timeLeftFraction);
    assert.equal(capacity.quotaPaceFactor, Math.min(4, remaining / timeLeftFraction));
  });
}
test("missing, invalid, expired resets and unknown windows retain raw percent behavior", () => {
  for (const resetsAt of [null, "not a reset", "Feb 31 at 7:00pm (America/Mexico_City)", (now - 1000) / 1000]) {
    const capacity = buildProviderCapacity({ codex: 25 }, { codex: { primary: { name: "5h", remainingPercent: 25, resetsAt } } }, now);
    assert.equal(capacity.codex.quotaPaceFactor, .25);
    assert.equal(resolveModelCost(model("codex"), capacity).weight, 8);
  }
});
test("worst window wins; exhaustion remains infinite even immediately before reset", () => {
  const capacity = buildProviderCapacity({ codex: 0 }, { codex: { primary: window(90, .1), secondary: { name: "weekly", remainingPercent: 0, resetsAt: (now + 3600000) / 1000 } } }, now);
  assert.equal(capacity.codex.quotaPaceFactor, 0);
  assert.equal(resolveModelCost(model("codex"), capacity).weight, Infinity);
});
