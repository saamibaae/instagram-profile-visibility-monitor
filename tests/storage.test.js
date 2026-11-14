import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getConfig,
  saveConfig,
  resetConfig,
  getState,
  saveState,
  resetState,
  addHistoryEvent,
  getHistory,
  clearHistory,
  saveTelegramCredentials,
  getTelegramCredentials,
  clearTelegramCredentials,
  exportHistoryAsCsv,
  __resetMockStore
} from '../lib/storage.js';
import { ObservationState, MonitoringStatus, NotificationStatus } from '../lib/constants.js';

test('Storage: Config save, get and reset', async () => {
  __resetMockStore();
  const initial = await getConfig();
  assert.equal(initial.targetUsername, 'instagram');
  assert.equal(initial.intervalMinutes, 3);

  const updated = await saveConfig({ intervalMinutes: 5, targetUsername: 'test_user' });
  assert.equal(updated.intervalMinutes, 5);
  assert.equal(updated.targetUsername, 'test_user');

  const reloaded = await getConfig();
  assert.equal(reloaded.intervalMinutes, 5);
  assert.equal(reloaded.targetUsername, 'test_user');

  await resetConfig();
  const reset = await getConfig();
  assert.equal(reset.targetUsername, 'instagram');
  assert.equal(reset.intervalMinutes, 3);
});

test('Storage: State save, get and reset', async () => {
  __resetMockStore();
  const initial = await getState();
  assert.equal(initial.monitoringStatus, MonitoringStatus.STOPPED);

  await saveState({
    monitoringStatus: MonitoringStatus.RUNNING,
    lastReliableState: ObservationState.VISIBLE
  });

  const saved = await getState();
  assert.equal(saved.monitoringStatus, MonitoringStatus.RUNNING);
  assert.equal(saved.lastReliableState, ObservationState.VISIBLE);

  await resetState();
  const reset = await getState();
  assert.equal(reset.monitoringStatus, MonitoringStatus.STOPPED);
  assert.equal(reset.lastReliableState, null);
});

test('Storage: Event history addition, filtering and pruning', async () => {
  __resetMockStore();
  // Set small limit for testing pruning
  await saveConfig({ historyRetentionLimit: 3 });

  await addHistoryEvent({
    observedState: ObservationState.VISIBLE,
    isTransition: false,
    timestampUtc: '2026-11-09T12:00:00.000Z'
  });
  await addHistoryEvent({
    observedState: ObservationState.UNAVAILABLE,
    isTransition: true,
    timestampUtc: '2026-11-09T12:03:00.000Z'
  });
  await addHistoryEvent({
    observedState: ObservationState.UNAVAILABLE,
    isTransition: false,
    timestampUtc: '2026-11-09T12:06:00.000Z'
  });

  let history = await getHistory();
  assert.equal(history.length, 3);

  // Add 4th event, should prune oldest (12:00:00)
  await addHistoryEvent({
    observedState: ObservationState.VISIBLE,
    isTransition: true,
    timestampUtc: '2026-11-09T12:09:00.000Z'
  });

  history = await getHistory();
  assert.equal(history.length, 3);
  assert.equal(history[0].timestampUtc, '2026-11-09T12:03:00.000Z');
  assert.equal(history[2].timestampUtc, '2026-11-09T12:09:00.000Z');

  // Filter transition only
  const transitionsOnly = await getHistory({ transitionOnly: true });
  assert.equal(transitionsOnly.length, 2);

  // Filter by state
  const visibleOnly = await getHistory({ stateFilter: ObservationState.VISIBLE });
  assert.equal(visibleOnly.length, 1);

  await clearHistory();
  const cleared = await getHistory();
  assert.equal(cleared.length, 0);
});

test('Storage: CSV Export escaping special characters', () => {
  const events = [
    {
      id: 'evt-1',
      timestampUtc: '2026-11-09T12:00:00.000Z',
      username: 'instagram',
      observedState: ObservationState.VISIBLE,
      previousReliableState: null,
      confidence: 'HIGH',
      isTransition: false,
      notificationStatus: NotificationStatus.SKIPPED,
      checkDurationMs: 1450,
      reason: 'Normal load, contains "quotes" and, commas\nand newlines'
    },
    {
      id: 'evt-2',
      timestampUtc: '2026-11-09T12:03:00.000Z',
      username: 'instagram',
      observedState: ObservationState.UNAVAILABLE,
      previousReliableState: ObservationState.VISIBLE,
      confidence: 'HIGH',
      isTransition: true,
      notificationStatus: NotificationStatus.SENT,
      checkDurationMs: 2100,
      reason: 'Page not found response'
    }
  ];

  const csv = exportHistoryAsCsv(events);

  // Check CSV headers
  assert.match(csv, /"Event ID","Timestamp \(UTC\)","Timestamp \(Asia\/Dhaka\)"/);
  // Check proper escaping of quotes
  assert.match(csv, /"Normal load, contains ""quotes"" and, commas\nand newlines"/);
  // Check row count (1 header + 2 rows = 3 rows)
  const rows = csv.split('\r\n');
  assert.equal(rows.length, 3);
});

test('Storage: Telegram credentials isolation', async () => {
  __resetMockStore();
  await saveTelegramCredentials({
    botToken: '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567',
    chatId: '-100987654321'
  });

  const creds = await getTelegramCredentials();
  assert.equal(creds.botToken, '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567');
  assert.equal(creds.chatId, '-100987654321');

  // Verify credentials are NEVER present in history export
  await addHistoryEvent({
    observedState: ObservationState.VISIBLE,
    isTransition: false
  });
  const history = await getHistory();
  const csv = exportHistoryAsCsv(history);
  assert.equal(csv.includes('123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567'), false);

  await clearTelegramCredentials();
  const cleared = await getTelegramCredentials();
  assert.equal(cleared.botToken, '');
  assert.equal(cleared.chatId, '');
});
