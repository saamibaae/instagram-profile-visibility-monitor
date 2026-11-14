import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  acquireDaemonLock,
  releaseDaemonLock,
  checkDaemonRunning,
  isPidAlive,
  getDaemonState,
  saveDaemonState,
  appendDaemonEvent,
  readDaemonEvents,
  exportDaemonEventsToCsv,
  pruneDaemonEventsOlderThanWindow
} from '../daemon/storage.js';
import { ObservationState, MonitoringStatus } from '../lib/constants.js';

const TEST_DIR = path.resolve('data/test_storage');
const TEST_STATE = path.join(TEST_DIR, 'state.json');
const TEST_EVENTS = path.join(TEST_DIR, 'events.jsonl');
const TEST_LOCK = path.join(TEST_DIR, 'daemon.lock');
const TEST_CSV = path.join(TEST_DIR, 'history.csv');

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

test('Daemon Storage: isPidAlive detects active process', () => {
  assert.equal(isPidAlive(process.pid), true);
  // High PID that shouldn't exist
  assert.equal(isPidAlive(9999999), false);
  assert.equal(isPidAlive(null), false);
});

test('Daemon Storage: acquireDaemonLock and duplicate prevention', () => {
  cleanup();
  acquireDaemonLock(process.pid, TEST_LOCK);

  const status = checkDaemonRunning(TEST_LOCK);
  assert.equal(status.running, true);
  assert.equal(status.pid, process.pid);

  // Trying to acquire lock again should throw
  assert.throws(() => {
    acquireDaemonLock(process.pid, TEST_LOCK);
  }, /Daemon is already running/);

  releaseDaemonLock(TEST_LOCK);
  const statusAfter = checkDaemonRunning(TEST_LOCK);
  assert.equal(statusAfter.running, false);
  cleanup();
});

test('Daemon Storage: state.json atomic persistence and retrieval', () => {
  cleanup();
  const initial = getDaemonState(TEST_STATE);
  assert.equal(initial.monitoringStatus, MonitoringStatus.STOPPED);

  const saved = saveDaemonState({
    monitoringStatus: MonitoringStatus.RUNNING,
    lastReliableState: ObservationState.VISIBLE
  }, TEST_STATE);

  assert.equal(saved.monitoringStatus, MonitoringStatus.RUNNING);

  const reloaded = getDaemonState(TEST_STATE);
  assert.equal(reloaded.monitoringStatus, MonitoringStatus.RUNNING);
  assert.equal(reloaded.lastReliableState, ObservationState.VISIBLE);
  cleanup();
});

test('Daemon Storage: events.jsonl append and read with filtering', () => {
  cleanup();

  appendDaemonEvent({
    observedState: ObservationState.VISIBLE,
    isTransition: false,
    reason: 'Initial load'
  }, TEST_EVENTS);

  appendDaemonEvent({
    observedState: ObservationState.UNAVAILABLE,
    isTransition: true,
    reason: 'Page not found'
  }, TEST_EVENTS);

  appendDaemonEvent({
    observedState: ObservationState.UNKNOWN,
    isTransition: false,
    reason: 'Challenge checkpoint'
  }, TEST_EVENTS);

  const all = readDaemonEvents({}, TEST_EVENTS);
  assert.equal(all.length, 3);
  assert.equal(all[0].observedState, ObservationState.VISIBLE);
  assert.equal(all[1].observedState, ObservationState.UNAVAILABLE);

  const transitionsOnly = readDaemonEvents({ transitionOnly: true }, TEST_EVENTS);
  assert.equal(transitionsOnly.length, 1);
  assert.equal(transitionsOnly[0].isTransition, true);

  const visibleOnly = readDaemonEvents({ stateFilter: ObservationState.VISIBLE }, TEST_EVENTS);
  assert.equal(visibleOnly.length, 1);
  cleanup();
});

test('Daemon Storage: CSV export formatting and special characters', () => {
  cleanup();
  const events = [
    {
      id: 'evt-1',
      timestampUtc: '2026-11-09T12:00:00.000Z',
      username: 'instagram',
      observedState: ObservationState.VISIBLE,
      previousReliableState: null,
      confidence: 'HIGH',
      isTransition: false,
      notificationStatus: 'SKIPPED',
      checkDurationMs: 1200,
      reason: 'Contains "quotes", commas, and\nnewlines'
    }
  ];

  exportDaemonEventsToCsv(events, TEST_CSV);
  assert.equal(fs.existsSync(TEST_CSV), true);

  const content = fs.readFileSync(TEST_CSV, 'utf-8');
  assert.match(content, /"Event ID","Timestamp \(UTC\)"/);
  assert.match(content, /"Contains ""quotes"", commas, and\nnewlines"/);
  cleanup();
});

test('Daemon Storage: pruneDaemonEventsOlderThanWindow strictly keeps all events within 24 hours without count limit', () => {
  cleanup();

  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;

  // Append 30 events within 24h (from now - 21h to now - 0.7h)
  for (let i = 1; i <= 30; i++) {
    const eventTime = new Date(now - (i * 0.7 * ONE_HOUR)).toISOString();
    appendDaemonEvent({
      id: `evt-recent-${i}`,
      timestampUtc: eventTime,
      observedState: ObservationState.VISIBLE,
      isTransition: false,
      reason: `Recent event ${i}`
    }, TEST_EVENTS);
  }

  // Append 10 events strictly older than 24h (26h to 44h ago)
  for (let i = 1; i <= 10; i++) {
    const oldTime = new Date(now - ((24 + i * 2) * ONE_HOUR)).toISOString();
    appendDaemonEvent({
      id: `evt-old-${i}`,
      timestampUtc: oldTime,
      observedState: ObservationState.UNAVAILABLE,
      isTransition: true,
      reason: `Old event ${i}`
    }, TEST_EVENTS);
  }

  // Before pruning: 40 total events
  const beforePrune = readDaemonEvents({}, TEST_EVENTS);
  assert.equal(beforePrune.length, 40);

  // Prune events older than 24 hours
  const result = pruneDaemonEventsOlderThanWindow(TEST_EVENTS, 24);
  assert.equal(result.totalBefore, 40);
  assert.equal(result.keptCount, 30);
  assert.equal(result.prunedCount, 10);

  // Verify all 30 recent events are kept
  const afterPrune = readDaemonEvents({}, TEST_EVENTS);
  assert.equal(afterPrune.length, 30);
  for (const e of afterPrune) {
    assert.equal(e.id.startsWith('evt-recent-'), true);
  }

  cleanup();
});

test('Daemon Storage: readDaemonEvents filters by rolling withinHours without count caps', () => {
  cleanup();

  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;

  // 15 events within 12 hours
  for (let i = 1; i <= 15; i++) {
    appendDaemonEvent({
      id: `evt-12h-${i}`,
      timestampUtc: new Date(now - (i * 0.5 * ONE_HOUR)).toISOString(),
      observedState: ObservationState.VISIBLE
    }, TEST_EVENTS);
  }

  // 15 events between 13h and 22h ago
  for (let i = 1; i <= 15; i++) {
    appendDaemonEvent({
      id: `evt-24h-${i}`,
      timestampUtc: new Date(now - ((13 + i * 0.5) * ONE_HOUR)).toISOString(),
      observedState: ObservationState.VISIBLE
    }, TEST_EVENTS);
  }

  // 10 events older than 30h ago
  for (let i = 1; i <= 10; i++) {
    appendDaemonEvent({
      id: `evt-old-${i}`,
      timestampUtc: new Date(now - ((30 + i) * ONE_HOUR)).toISOString(),
      observedState: ObservationState.VISIBLE
    }, TEST_EVENTS);
  }

  // withinHours: 12 should return exactly 15 events
  const events12h = readDaemonEvents({ withinHours: 12 }, TEST_EVENTS);
  assert.equal(events12h.length, 15);

  // withinHours: 24 should return exactly 30 events (15 + 15), preserving all without truncation
  const events24h = readDaemonEvents({ withinHours: 24 }, TEST_EVENTS);
  assert.equal(events24h.length, 30);

  // No withinHours should return all 40
  const eventsAll = readDaemonEvents({}, TEST_EVENTS);
  assert.equal(eventsAll.length, 40);

  cleanup();
});
