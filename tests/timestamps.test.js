import test from 'node:test';
import assert from 'node:assert/strict';

import {
  nowUtc,
  formatDhakaDateTime,
  formatDhakaTime,
  formatDuration,
  isCheckOverdue,
  calculateGapMinutes
} from '../lib/timestamps.js';

test('Timestamps: nowUtc returns valid ISO 8601 string', () => {
  const ts = nowUtc();
  assert.equal(typeof ts, 'string');
  assert.equal(Number.isNaN(Date.parse(ts)), false);
  assert.equal(ts.endsWith('Z'), true);
});

test('Timestamps: formatDhakaDateTime formats in Asia/Dhaka (+06:00)', () => {
  // 12:00:00 UTC = 18:00:00 (06:00 PM) in Dhaka
  const utc = '2026-11-09T12:00:00.000Z';
  const formatted = formatDhakaDateTime(utc);
  assert.match(formatted, /09 Nov 2026/);
  assert.match(formatted, /06:00/i);
  assert.match(formatted, /pm/i);

  assert.equal(formatDhakaDateTime(null), '—');
  assert.equal(formatDhakaDateTime('invalid'), '—');
});

test('Timestamps: formatDhakaTime formats hours and minutes in Asia/Dhaka', () => {
  const utc = '2026-11-09T12:03:00.000Z';
  const formatted = formatDhakaTime(utc);
  assert.match(formatted, /06:03/);
  assert.match(formatted, /pm/i);

  assert.equal(formatDhakaTime(null), '—');
});

test('Timestamps: formatDuration calculates elapsed strings', () => {
  const t0 = '2026-11-09T12:00:00.000Z';
  const t1 = '2026-11-09T12:00:45.000Z';
  const t2 = '2026-11-09T12:03:15.000Z';
  const t3 = '2026-11-09T13:05:00.000Z';

  assert.equal(formatDuration(t0, t1), '45s');
  assert.equal(formatDuration(t0, t2), '3m 15s');
  assert.equal(formatDuration(t0, t3), '1h 5m');
  assert.equal(formatDuration('invalid', t1), '—');
});

test('Timestamps: isCheckOverdue identifies overdue checks', () => {
  const now = Date.now();
  const pastScheduled = new Date(now - 120000).toISOString(); // 2 mins ago (grace is 1 min)
  const futureScheduled = new Date(now + 60000).toISOString(); // 1 min in future

  assert.equal(isCheckOverdue(pastScheduled, 60000), true);
  assert.equal(isCheckOverdue(futureScheduled, 60000), false);
  assert.equal(isCheckOverdue(null), false);
});

test('Timestamps: calculateGapMinutes calculates accurate minute intervals', () => {
  const t0 = '2026-11-09T12:00:00.000Z';
  const t1 = '2026-11-09T12:06:00.000Z';
  assert.equal(calculateGapMinutes(t0, t1), 6);
  assert.equal(calculateGapMinutes(t0, 'invalid'), 0);
});
