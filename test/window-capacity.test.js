import test from 'node:test';
import assert from 'node:assert/strict';

const HOUR = 3600000;
const now = Date.parse('2026-10-22T12:00:00Z');
const window = (remainingPercent, hours) => ({ remainingPercent, resetsAt: now + hours * HOUR });
function reading(timestamp, five, week, burstReset = now + 5 * HOUR, weekReset = now + 100 * HOUR, provider = 'codex') {
  return [
    { provider, window: '5h', remainingPercent: five, resetsAt: burstReset, timestamp },
    { provider, window: 'weekly', remainingPercent: week, resetsAt: weekReset, timestamp }
  ];
}

test('conversion uses median adjacent intervals, excludes five-hour and weekly reset crossings', async () => {
  const { weeklyCostPerBurst } = await import('../src/global/intelligence/window-capacity.js');
  const samples = [
    ...reading(now, 90, 90), ...reading(now + HOUR, 70, 88),
    ...reading(now + 2 * HOUR, 50, 86), ...reading(now + 3 * HOUR, 30, 83),
    ...reading(now + 5 * HOUR, 100, 82, now + 10 * HOUR),
    ...reading(now + 6 * HOUR, 80, 99, now + 10 * HOUR, now + 168 * HOUR)
  ].reverse();
  const original = structuredClone(samples);
  assert.equal(weeklyCostPerBurst(samples), 10);
  assert.deepEqual(samples, original);
});

test('conversion remains unknown with fewer than three usable intervals, duplicate polls or flat/rising usage', async () => {
  const { weeklyCostPerBurst } = await import('../src/global/intelligence/window-capacity.js');
  const samples = [...reading(now, 100, 90), ...reading(now + HOUR, 80, 88), ...reading(now + 2 * HOUR, 60, 86)];
  assert.equal(weeklyCostPerBurst(samples), null);
  assert.equal(weeklyCostPerBurst([...samples, ...samples, ...reading(now + 3 * HOUR, 70, 85)]), null);
  assert.equal(weeklyCostPerBurst([...samples, ...reading(now + 3 * HOUR, 40, 86)]), null);
  assert.equal(weeklyCostPerBurst([...samples, ...reading(now + 3 * HOUR, 40, 84, undefined, undefined, 'claude')]), null);
});

test('Codex 18 percent with reset in 16 minutes includes refills before horizon', async () => {
  const { capacityUntil } = await import('../src/global/intelligence/window-capacity.js');
  const result = capacityUntil({ fiveHour: window(18, 16 / 60), weekly: window(87, 100), conversion: 10, now, horizon: now + 6 * HOUR });
  assert.equal(result.fiveHourUnits, 2.18);
  assert.equal(result.refills, 2);
  assert.equal(result.sustainableFiveHourUnitsPerHour, .087);
  assert.equal(result.unit, 'five-hour-window');
});

test('Claude weekly 17 percent caps 80 percent burst and future refills', async () => {
  const { capacityUntil } = await import('../src/global/intelligence/window-capacity.js');
  const result = capacityUntil({ fiveHour: window(80, 1), weekly: window(17, 100), conversion: 25, now, horizon: now + 20 * HOUR });
  assert.equal(result.fiveHourUnits, .68);
  assert.equal(result.weeklyCapUnits, .68);
});

test('horizon excludes a refill exactly at its boundary and never projects past weekly reset', async () => {
  const { capacityUntil } = await import('../src/global/intelligence/window-capacity.js');
  const args = { fiveHour: window(18, 1), weekly: window(87, 6), conversion: 10, now };
  assert.equal(capacityUntil({ ...args, horizon: now + HOUR }).fiveHourUnits, .18);
  assert.equal(capacityUntil({ ...args, horizon: now + 20 * HOUR }).fiveHourUnits, 1.18);
  assert.equal(capacityUntil({ ...args, horizon: now }).fiveHourUnits, 0);
});

test('unknown conversion reports weekly-only fallback without fabricated five-hour units', async () => {
  const { capacityUntil } = await import('../src/global/intelligence/window-capacity.js');
  for (const conversion of [null, undefined, 0, -1, Infinity]) {
    const result = capacityUntil({ fiveHour: window(18, .25), weekly: window(87, 100), conversion, now, horizon: now + 6 * HOUR });
    assert.equal(result.fallback, 'weekly-only');
    assert.equal(result.fiveHourUnits, null);
    assert.equal(result.spendAvailable, 87);
    assert.equal(result.unit, 'weekly-percent');
    assert.equal(result.sustainableFiveHourUnitsPerHour, null);
    assert.equal(result.weeklyPercentPerHour, .87);
  }
});

test('missing or expired windows remain explicit unknown, never refill guessed quota', async () => {
  const { capacityUntil } = await import('../src/global/intelligence/window-capacity.js');
  assert.equal(capacityUntil({ fiveHour: window(80, 1), weekly: null, conversion: 10, now, horizon: now + HOUR }).spendAvailable, null);
  assert.equal(capacityUntil({ fiveHour: window(80, 1), weekly: window(17, -1), conversion: 10, now, horizon: now + HOUR }).spendAvailable, null);
});

test('sustainable rate is also bounded by five-hour refills before weekly reset', async () => {
  const { capacityUntil } = await import('../src/global/intelligence/window-capacity.js');
  const result = capacityUntil({ fiveHour: window(18, .25), weekly: window(87, 1), conversion: 10, now, horizon: now + HOUR });
  assert.equal(result.sustainableFiveHourUnitsPerHour, 1.18);
});
