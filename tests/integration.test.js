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
  saveConfig,
  getState,
  saveState,
  getHistory,
  saveTelegramCredentials,
  exportHistoryAsCsv,
  __resetMockStore
} from '../lib/storage.js';
import {
  ObservationState,
  MonitoringStatus,
  Confidence,
  NotificationStatus
} from '../lib/constants.js';
import { sendTelegramMessage } from '../lib/telegram.js';

test('Integration: Full Observation and Transition Lifecycle', async () => {
  __resetMockStore();

  // 1. Initialize configuration and Telegram credentials
  await saveConfig({
    targetUsername: 'instagram',
    targetUrl: 'https://www.instagram.com/instagram/',
    intervalMinutes: 3,
    telegramNotificationsEnabled: true
  });
  await saveTelegramCredentials({
    botToken: '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567',
    chatId: '987654321'
  });

  // 2. Start monitoring
  const startState = await startMonitoring(3, { skipImmediateCheck: true });
  assert.equal(startState.monitoringStatus, MonitoringStatus.RUNNING);

  // 3. First check: Visible profile snapshot (Baseline)
  const visibleSnapshot = {
    url: 'https://www.instagram.com/instagram/',
    title: 'Instagram (@instagram) • Instagram photos and videos',
    headings: ['instagram'],
    bodyText: 'Profile bio content',
    meta: { 'og:title': 'Instagram (@instagram)' }
  };

  const check1 = await performObservationCheck({ mockSnapshot: visibleSnapshot });
  assert.equal(check1.observation.state, ObservationState.VISIBLE);
  assert.equal(check1.evaluation.isBaseline, true);
  assert.equal(check1.evaluation.isTransition, false);

  const stateAfter1 = await getState();
  assert.equal(stateAfter1.lastReliableState, ObservationState.VISIBLE);

  // 4. Second check: Still Visible (Unchanged)
  const check2 = await performObservationCheck({ mockSnapshot: visibleSnapshot });
  assert.equal(check2.observation.state, ObservationState.VISIBLE);
  assert.equal(check2.evaluation.isTransition, false);

  // 5. Third check: Unavailable profile snapshot (Transition from VISIBLE to UNAVAILABLE)
  const unavailableSnapshot = {
    url: 'https://www.instagram.com/instagram/',
    title: 'Page Not Found • Instagram',
    headings: ["Sorry, this page isn't available."],
    bodyText: 'The link you followed may be broken, or the page may have been removed.',
    meta: {}
  };

  const check3 = await performObservationCheck({ mockSnapshot: unavailableSnapshot });
  assert.equal(check3.observation.state, ObservationState.UNAVAILABLE);
  assert.equal(check3.evaluation.isTransition, true);
  assert.equal(check3.evaluation.transitionEvent.previousReliableState, ObservationState.VISIBLE);
  assert.equal(check3.evaluation.transitionEvent.newObservation, ObservationState.UNAVAILABLE);

  // 6. Fourth check: Intervening Login Challenge (UNKNOWN)
  const challengeSnapshot = {
    url: 'https://www.instagram.com/challenge/',
    title: 'Instagram',
    headings: ['Security Check'],
    bodyText: 'checkpoint_required confirm identity',
    meta: {}
  };

  const check4 = await performObservationCheck({ mockSnapshot: challengeSnapshot });
  assert.equal(check4.observation.state, ObservationState.UNKNOWN);
  assert.equal(check4.evaluation.isTransition, false);

  // Last reliable state remains UNAVAILABLE despite UNKNOWN check
  const stateAfter4 = await getState();
  assert.equal(stateAfter4.lastReliableState, ObservationState.UNAVAILABLE);
  assert.equal(stateAfter4.consecutiveUnknownCount, 1);

  // 7. Fifth check: Profile Visible again (Transition UNAVAILABLE -> VISIBLE with gap note)
  const check5 = await performObservationCheck({ mockSnapshot: visibleSnapshot });
  assert.equal(check5.observation.state, ObservationState.VISIBLE);
  assert.equal(check5.evaluation.isTransition, true);
  assert.equal(check5.evaluation.transitionEvent.previousReliableState, ObservationState.UNAVAILABLE);
  assert.equal(check5.evaluation.transitionEvent.newObservation, ObservationState.VISIBLE);
  assert.equal(check5.evaluation.transitionEvent.hadInterveningUnknowns, true);

  // 8. Verify Event History
  const history = await getHistory();
  assert.equal(history.length, 5);

  const transitions = await getHistory({ transitionOnly: true });
  assert.equal(transitions.length, 2);

  // 9. Export CSV
  const csv = exportHistoryAsCsv(history);
  assert.match(csv, /"Event ID","Timestamp \(UTC\)"/);
  assert.match(csv, /"instagram","VISIBLE"/);
  assert.match(csv, /"instagram","UNAVAILABLE"/);
  assert.equal(csv.includes('123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567'), false);
});

test('Integration: Failure Scenario A - Network disconnect produces UNKNOWN without false deactivation', async () => {
  __resetMockStore();

  await saveState({
    lastReliableState: ObservationState.VISIBLE,
    currentObservation: ObservationState.VISIBLE
  });

  const networkErrorSnapshot = {
    url: 'https://www.instagram.com/instagram/',
    title: '',
    headings: [],
    bodyText: '', // Empty unhydrated DOM due to offline
    meta: {}
  };

  const check = await performObservationCheck({ mockSnapshot: networkErrorSnapshot });
  assert.equal(check.observation.state, ObservationState.UNKNOWN);
  assert.equal(check.evaluation.isTransition, false);

  const state = await getState();
  assert.equal(state.lastReliableState, ObservationState.VISIBLE);
  assert.notEqual(state.lastReliableState, ObservationState.UNAVAILABLE);
});

test('Integration: Failure Scenario D - Telegram delivery failure preserves underlying observation', async () => {
  __resetMockStore();

  const mockFailingFetch = async () => ({
    status: 500,
    json: async () => ({ ok: false, description: 'Internal Telegram Server Error' })
  });

  const res = await sendTelegramMessage(
    '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567',
    '987654321',
    'Test transition alert',
    { fetchImpl: mockFailingFetch }
  );

  assert.equal(res.ok, false);
  assert.equal(res.status, NotificationStatus.FAILED);
  assert.match(res.error, /Internal Telegram Server Error/);
});

test('Integration: Scenario E - Browser restart restores persisted state without false transitions', async () => {
  __resetMockStore();

  // Simulate prior session state
  await saveState({
    monitoringStatus: MonitoringStatus.RUNNING,
    lastReliableState: ObservationState.VISIBLE,
    lastReliableObservedAt: '2026-11-09T12:00:00.000Z',
    currentAccount: 'instagram'
  });

  // Re-read state on simulated startup
  const restored = await getState();
  assert.equal(restored.monitoringStatus, MonitoringStatus.RUNNING);
  assert.equal(restored.lastReliableState, ObservationState.VISIBLE);

  // Subsequent check of same state does NOT trigger a transition
  const check = await performObservationCheck({
    mockSnapshot: {
      url: 'https://www.instagram.com/instagram/',
      title: 'Instagram (@instagram) • Instagram photos and videos',
      headings: ['instagram'],
      bodyText: 'Bio content',
      meta: { 'og:title': 'Instagram (@instagram)' }
    }
  });

  assert.equal(check.evaluation.isTransition, false);
});
