import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  acquireDaemonLock,
  releaseDaemonLock,
  checkDaemonRunning,
  appendDaemonAuditEvent,
  readDaemonAuditEvents,
  appendDaemonEvent,
  readDaemonEvents,
  rotateDaemonLog
} from '../daemon/storage.js';
import { AuditEventType, ObservationState } from '../lib/constants.js';

const TEST_DIR = path.resolve('data/test_reliability');
const TEST_LOCK = path.join(TEST_DIR, 'test.lock');
const TEST_AUDIT = path.join(TEST_DIR, 'audit.jsonl');
const TEST_EVENTS = path.join(TEST_DIR, 'events.jsonl');
const TEST_LOG = path.join(TEST_DIR, 'test.log');

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

test('Reliability: Single-instance lock prevents duplicate daemons with active PID', () => {
  cleanup();
  acquireDaemonLock(process.pid, TEST_LOCK);

  // Second acquire with same running PID must throw
  assert.throws(() => {
    acquireDaemonLock(process.pid, TEST_LOCK);
  }, /already running/);

  releaseDaemonLock(TEST_LOCK);
  assert.equal(checkDaemonRunning(TEST_LOCK).running, false);
  cleanup();
});

test('Reliability: Stale lock recovery when recorded PID is dead', () => {
  cleanup();
  // PID 99999999 is extraordinarily unlikely to exist
  acquireDaemonLock(99999999, TEST_LOCK);

  const status = checkDaemonRunning(TEST_LOCK);
  assert.equal(status.running, false);
  assert.equal(status.stalePid, 99999999);

  // New active PID can acquire over stale lock without throwing
  acquireDaemonLock(process.pid, TEST_LOCK);
  assert.equal(checkDaemonRunning(TEST_LOCK).running, true);

  releaseDaemonLock(TEST_LOCK);
  cleanup();
});

test('Reliability: Operational audit log records and reads system events', () => {
  cleanup();
  appendDaemonAuditEvent(AuditEventType.TARGET_CHANGED, { newUsername: 'target_one' }, TEST_AUDIT);
  appendDaemonAuditEvent(AuditEventType.SCHEDULE_CHANGED, { mode: 'RANDOM_RANGE' }, TEST_AUDIT);
  appendDaemonAuditEvent(AuditEventType.MONITORING_PAUSED, { reason: 'User paused' }, TEST_AUDIT);

  const audits = readDaemonAuditEvents({}, TEST_AUDIT);
  assert.equal(audits.length, 3);
  assert.equal(audits[0].eventType, AuditEventType.TARGET_CHANGED);
  assert.equal(audits[0].details.newUsername, 'target_one');
  assert.equal(audits[1].eventType, AuditEventType.SCHEDULE_CHANGED);
  assert.equal(audits[2].eventType, AuditEventType.MONITORING_PAUSED);
  cleanup();
});

test('Reliability: Observation event filtering by username and state', () => {
  cleanup();
  appendDaemonEvent({
    username: 'user_a',
    observedState: ObservationState.VISIBLE,
    isTransition: false
  }, TEST_EVENTS);

  appendDaemonEvent({
    username: 'user_a',
    observedState: ObservationState.UNAVAILABLE,
    isTransition: true
  }, TEST_EVENTS);

  appendDaemonEvent({
    username: 'user_b',
    observedState: ObservationState.VISIBLE,
    isTransition: false
  }, TEST_EVENTS);

  // Filter by username
  const userAEvents = readDaemonEvents({ usernameFilter: 'user_a' }, TEST_EVENTS);
  assert.equal(userAEvents.length, 2);

  const userBEvents = readDaemonEvents({ usernameFilter: 'user_b' }, TEST_EVENTS);
  assert.equal(userBEvents.length, 1);

  // Filter by transitions only
  const transitions = readDaemonEvents({ transitionOnly: true }, TEST_EVENTS);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].observedState, ObservationState.UNAVAILABLE);

  // Filter by state
  const visibleOnly = readDaemonEvents({ stateFilter: ObservationState.VISIBLE }, TEST_EVENTS);
  assert.equal(visibleOnly.length, 2);

  cleanup();
});

test('Reliability: Log rotation rotates log file exceeding size limit', () => {
  cleanup();
  fs.mkdirSync(TEST_DIR, { recursive: true });

  // Create a 200KB mock log file
  const chunk = 'A'.repeat(1024) + '\n';
  const fd = fs.openSync(TEST_LOG, 'w');
  for (let i = 0; i < 200; i++) {
    fs.writeSync(fd, chunk);
  }
  fs.closeSync(fd);

  // Rotate with 100KB threshold
  rotateDaemonLog(TEST_LOG, 100 * 1024);

  // Original log rotated to .1, and new clean log created
  assert.equal(fs.existsSync(`${TEST_LOG}.1`), true);
  assert.equal(fs.existsSync(TEST_LOG), true);

  const newLogContent = fs.readFileSync(TEST_LOG, 'utf-8');
  assert.match(newLogContent, /Log rotated/);

  cleanup();
});
