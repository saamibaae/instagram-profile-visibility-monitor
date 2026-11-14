import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ScheduleMode,
  FIXED_INTERVAL_MIN_MINUTES,
  FIXED_INTERVAL_MAX_MINUTES,
  RANDOM_RANGE_MIN_SECONDS,
  RANDOM_RANGE_MAX_SECONDS
} from '../lib/constants.js';
import {
  validateFixedInterval,
  validateRandomRange,
  validateScheduleConfig
} from '../lib/validation.js';
import {
  calculateNextDelayMs,
  setSchedulerRngSource
} from '../daemon/scheduler.js';

test('Scheduling Modes: Fixed mode bounds validation (3 to 60 minutes)', () => {
  // Valid bounds
  assert.equal(validateFixedInterval(3), true);
  assert.equal(validateFixedInterval(5), true);
  assert.equal(validateFixedInterval(30), true);
  assert.equal(validateFixedInterval(60), true);

  // Invalid bounds
  assert.equal(validateFixedInterval(0), false);
  assert.equal(validateFixedInterval(1), false);
  assert.equal(validateFixedInterval(2), false);
  assert.equal(validateFixedInterval(61), false);
  assert.equal(validateFixedInterval(100), false);
  assert.equal(validateFixedInterval(3.5), false); // must be whole integer
  assert.equal(validateFixedInterval('3'), false); // must be number
  assert.equal(validateFixedInterval(null), false);
});

test('Scheduling Modes: Random range bounds validation (60 to 180 seconds)', () => {
  // Valid bounds
  assert.equal(validateRandomRange(60, 180).valid, true);
  assert.equal(validateRandomRange(60, 120).valid, true);
  assert.equal(validateRandomRange(90, 150).valid, true);
  assert.equal(validateRandomRange(120, 180).valid, true);

  // Equal min and max are valid
  assert.equal(validateRandomRange(90, 90).valid, true);
  assert.equal(validateRandomRange(60, 60).valid, true);
  assert.equal(validateRandomRange(180, 180).valid, true);

  // Invalid: min > max
  const reversed = validateRandomRange(150, 100);
  assert.equal(reversed.valid, false);
  assert.match(reversed.error, /cannot be greater than maximum/i);

  // Invalid: min below 60
  const tooLow = validateRandomRange(30, 120);
  assert.equal(tooLow.valid, false);
  assert.match(tooLow.error, /cannot be less than 60/i);

  // Invalid: max above 180
  const tooHigh = validateRandomRange(60, 240);
  assert.equal(tooHigh.valid, false);
  assert.match(tooHigh.error, /cannot exceed 180/i);

  // Invalid types
  assert.equal(validateRandomRange('60', 120).valid, false);
  assert.equal(validateRandomRange(60.5, 120).valid, false);
});

test('Scheduling Modes: validateScheduleConfig validates composite object', () => {
  // Valid Fixed
  assert.equal(validateScheduleConfig({
    scheduleMode: ScheduleMode.FIXED,
    fixedIntervalMinutes: 5
  }).valid, true);

  // Invalid Fixed
  assert.equal(validateScheduleConfig({
    scheduleMode: ScheduleMode.FIXED,
    fixedIntervalMinutes: 2
  }).valid, false);

  // Valid Random Range
  assert.equal(validateScheduleConfig({
    scheduleMode: ScheduleMode.RANDOM_RANGE,
    randomMinSeconds: 90,
    randomMaxSeconds: 150
  }).valid, true);

  // Invalid Random Range
  assert.equal(validateScheduleConfig({
    scheduleMode: ScheduleMode.RANDOM_RANGE,
    randomMinSeconds: 150,
    randomMaxSeconds: 90
  }).valid, false);

  // Invalid Mode
  assert.equal(validateScheduleConfig({
    scheduleMode: 'INVALID_MODE'
  }).valid, false);
});

test('Scheduling Modes: calculateNextDelayMs with Fixed mode', () => {
  const cfg = {
    scheduleMode: ScheduleMode.FIXED,
    fixedIntervalMinutes: 5
  };
  const result = calculateNextDelayMs(cfg);
  assert.equal(result.scheduleMode, ScheduleMode.FIXED);
  assert.equal(result.delaySeconds, 300);
  assert.equal(result.delayMs, 300000);
});

test('Scheduling Modes: calculateNextDelayMs with Random Range and deterministic RNG', () => {
  const cfg = {
    scheduleMode: ScheduleMode.RANDOM_RANGE,
    randomMinSeconds: 60,
    randomMaxSeconds: 120
  };

  // RNG returning 0 -> exactly minimum bound (60s)
  const atMin = calculateNextDelayMs(cfg, () => 0.0);
  assert.equal(atMin.delaySeconds, 60);
  assert.equal(atMin.delayMs, 60000);

  // RNG returning 0.9999 -> exactly maximum bound (120s)
  const atMax = calculateNextDelayMs(cfg, () => 0.9999);
  assert.equal(atMax.delaySeconds, 120);
  assert.equal(atMax.delayMs, 120000);

  // RNG returning 0.5 -> middle of range (90s)
  const atMid = calculateNextDelayMs(cfg, () => 0.5);
  assert.equal(atMid.delaySeconds, 90);
  assert.equal(atMid.delayMs, 90000);

  // Equal min and max yields constant delay
  const equalCfg = {
    scheduleMode: ScheduleMode.RANDOM_RANGE,
    randomMinSeconds: 100,
    randomMaxSeconds: 100
  };
  assert.equal(calculateNextDelayMs(equalCfg, () => 0.1).delaySeconds, 100);
  assert.equal(calculateNextDelayMs(equalCfg, () => 0.9).delaySeconds, 100);
});

test('Scheduling Modes: Delay values always stay strictly within bounds across 500 samples', () => {
  const cfg = {
    scheduleMode: ScheduleMode.RANDOM_RANGE,
    randomMinSeconds: 75,
    randomMaxSeconds: 145
  };

  for (let i = 0; i < 500; i++) {
    const res = calculateNextDelayMs(cfg);
    assert.equal(res.delaySeconds >= 75 && res.delaySeconds <= 145, true);
    assert.equal(Number.isInteger(res.delaySeconds), true);
  }
});
