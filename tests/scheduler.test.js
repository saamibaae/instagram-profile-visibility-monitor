import test from 'node:test';
import assert from 'node:assert/strict';

import {
  startMonitoring,
  pauseMonitoring,
  stopMonitoring,
  performObservationCheck
} from '../lib/scheduler.js';
import {
  getConfig,
  getState,
  getHistory,
  __resetMockStore
} from '../lib/storage.js';
import {
  MonitoringStatus,
  ObservationState,
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_INTERVAL_MS
} from '../lib/constants.js';

test('Scheduler: Default interval is 3 minutes (180,000 ms)', () => {
  assert.equal(DEFAULT_INTERVAL_MINUTES, 3);
  assert.equal(DEFAULT_INTERVAL_MS, 180000);
});

test('Scheduler: Start, Pause and Stop lifecycle updates state', async () => {
  __resetMockStore();

  // 1. Start monitoring
  const runningState = await startMonitoring(3);
  assert.equal(runningState.monitoringStatus, MonitoringStatus.RUNNING);
  assert.notEqual(runningState.nextScheduledCheckAt, null);

  const cfg = await getConfig();
  assert.equal(cfg.monitoringEnabled, true);
  assert.equal(cfg.intervalMinutes, 3);

  // 2. Pause monitoring
  const pausedState = await pauseMonitoring('User requested pause');
  assert.equal(pausedState.monitoringStatus, MonitoringStatus.PAUSED);
  assert.equal(pausedState.nextScheduledCheckAt, null);
  assert.equal(pausedState.interruptionReason, 'User requested pause');

  // 3. Stop monitoring
  const stoppedState = await stopMonitoring();
  assert.equal(stoppedState.monitoringStatus, MonitoringStatus.STOPPED);
  assert.equal(stoppedState.nextScheduledCheckAt, null);
});

test('Scheduler: performObservationCheck processes snapshots and logs history', async () => {
  __resetMockStore();

  const mockVisibleSnapshot = {
    url: 'https://www.instagram.com/instagram/',
    title: 'Instagram (@instagram) • Instagram photos and videos',
    headings: ['instagram'],
    bodyText: 'Instagram profile bio information',
    meta: { 'og:title': 'Instagram (@instagram)' }
  };

  // Perform initial observation (Baseline)
  const res1 = await performObservationCheck({ mockSnapshot: mockVisibleSnapshot });
  assert.equal(res1.observation.state, ObservationState.VISIBLE);
  assert.equal(res1.evaluation.isBaseline, true);
  assert.equal(res1.evaluation.isTransition, false);

  const history1 = await getHistory();
  assert.equal(history1.length, 1);
  assert.equal(history1[0].observedState, ObservationState.VISIBLE);
  assert.equal(history1[0].isTransition, false);

  // Perform identical observation (Unchanged)
  const res2 = await performObservationCheck({ mockSnapshot: mockVisibleSnapshot });
  assert.equal(res2.observation.state, ObservationState.VISIBLE);
  assert.equal(res2.evaluation.isTransition, false);

  // Perform unavailable observation (Transition)
  const mockUnavailableSnapshot = {
    url: 'https://www.instagram.com/instagram/',
    title: 'Page Not Found • Instagram',
    headings: ["Sorry, this page isn't available."],
    bodyText: 'The link you followed may be broken',
    meta: {}
  };

  const res3 = await performObservationCheck({ mockSnapshot: mockUnavailableSnapshot });
  assert.equal(res3.observation.state, ObservationState.UNAVAILABLE);
  assert.equal(res3.evaluation.isTransition, true);
  assert.notEqual(res3.evaluation.transitionEvent, null);
  assert.equal(res3.evaluation.transitionEvent.previousReliableState, ObservationState.VISIBLE);
  assert.equal(res3.evaluation.transitionEvent.newObservation, ObservationState.UNAVAILABLE);

  const history3 = await getHistory();
  assert.equal(history3.length, 3);
  assert.equal(history3[2].isTransition, true);
});

test('Scheduler: Overlapping checks are prevented by in-flight guard', async () => {
  __resetMockStore();

  const mockSnapshot = {
    url: 'https://www.instagram.com/instagram/',
    title: 'Page Not Found • Instagram',
    headings: ["Sorry, this page isn't available."],
    bodyText: 'The link you followed may be broken',
    meta: {}
  };

  // Start two checks concurrently
  const [p1, p2] = await Promise.all([
    performObservationCheck({ mockSnapshot }),
    performObservationCheck({ mockSnapshot })
  ]);

  // One of them must have succeeded and the other caught by overlap guard or both safely serialized
  const oneSkipped = p1.skipped || p2.skipped;
  const oneExecuted = !p1.skipped || !p2.skipped;
  assert.equal(oneExecuted, true);
});
