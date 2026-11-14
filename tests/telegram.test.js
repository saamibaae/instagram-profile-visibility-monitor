import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatTransitionMessage,
  formatTestMessage,
  sendTelegramMessage,
  testTelegramConnection
} from '../lib/telegram.js';
import { ObservationState, NotificationStatus } from '../lib/constants.js';

const VALID_TOKEN = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567';
const VALID_CHAT_ID = '987654321';

test('Telegram: formatTransitionMessage formats visible transition correctly', () => {
  const event = {
    username: 'instagram',
    newObservation: ObservationState.VISIBLE,
    previousReliableState: ObservationState.UNAVAILABLE,
    previousObservationAt: '2026-11-09T12:00:00.000Z', // 6:00 PM Dhaka
    currentObservationAt: '2026-11-09T12:03:00.000Z',  // 6:03 PM Dhaka
    detectedAt: '2026-11-09T12:03:00.000Z',
    hadInterveningUnknowns: false,
    monitoringGapMinutes: 0
  };

  const text = formatTransitionMessage(event);
  assert.match(text, /Instagram Visibility Monitor/);
  assert.match(text, /Account: @instagram/);
  assert.match(text, /Observation: PROFILE VISIBLE/);
  assert.match(text, /Previous reliable state:\s+UNAVAILABLE/);
  assert.match(text, /Previous observation:\s+06:00 pm/i);
  assert.match(text, /Current observation:\s+06:03 pm/i);
  assert.match(text, /09 Nov 2026, 06:03 pm/i);
  assert.match(text, /Asia\/Dhaka/);
  assert.match(text, /observed visibility change/);
});

test('Telegram: formatTransitionMessage formats unavailable transition with gap note', () => {
  const event = {
    username: 'instagram',
    newObservation: ObservationState.UNAVAILABLE,
    previousReliableState: ObservationState.VISIBLE,
    previousObservationAt: '2026-11-09T12:00:00.000Z',
    currentObservationAt: '2026-11-09T12:12:00.000Z',
    detectedAt: '2026-11-09T12:12:00.000Z',
    hadInterveningUnknowns: true,
    monitoringGapMinutes: 12
  };

  const text = formatTransitionMessage(event);
  assert.match(text, /Observation: PROFILE UNAVAILABLE/);
  assert.match(text, /Intervening monitoring gap:\s+~12 minutes/);
  assert.match(text, /Deactivation is unverified/);
});

test('Telegram: sendTelegramMessage delivers successfully with mock fetch', async () => {
  let calledEndpoint = '';
  let calledBody = null;

  const mockFetch = async (url, opts) => {
    calledEndpoint = url;
    calledBody = JSON.parse(opts.body);
    return {
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 42 } })
    };
  };

  const res = await sendTelegramMessage(VALID_TOKEN, VALID_CHAT_ID, 'Hello Test', {
    fetchImpl: mockFetch
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, NotificationStatus.SENT);
  assert.equal(calledEndpoint.includes(VALID_TOKEN), true);
  assert.equal(calledBody.chat_id, VALID_CHAT_ID);
  assert.equal(calledBody.text, 'Hello Test');
});

test('Telegram: rejects invalid token format without network call', async () => {
  let called = false;
  const mockFetch = async () => {
    called = true;
    return { status: 200 };
  };

  const res = await sendTelegramMessage('bad_token', VALID_CHAT_ID, 'Hello', {
    fetchImpl: mockFetch
  });

  assert.equal(res.ok, false);
  assert.equal(res.status, NotificationStatus.FAILED);
  assert.match(res.error, /Invalid Telegram bot token/);
  assert.equal(called, false);
});

test('Telegram: handles 401 Unauthorized properly', async () => {
  const mockFetch = async () => ({
    status: 401,
    json: async () => ({ ok: false, error_code: 401, description: 'Unauthorized' })
  });

  const res = await sendTelegramMessage(VALID_TOKEN, VALID_CHAT_ID, 'Hello', {
    fetchImpl: mockFetch
  });

  assert.equal(res.ok, false);
  assert.match(res.error, /Unauthorized/);
});

test('Telegram: handles 400 Bad Request chat not found with actionable advice', async () => {
  const mockFetch = async () => ({
    status: 400,
    json: async () => ({ ok: false, error_code: 400, description: 'Bad Request: chat not found' })
  });

  const res = await sendTelegramMessage(VALID_TOKEN, VALID_CHAT_ID, 'Hello', {
    fetchImpl: mockFetch
  });

  assert.equal(res.ok, false);
  assert.match(res.error, /Chat not found: You must open a chat with your bot/);
});

test('Telegram: handles 429 Rate Limit with retry_after', async () => {
  const mockFetch = async () => ({
    status: 429,
    json: async () => ({
      ok: false,
      error_code: 429,
      description: 'Too Many Requests',
      parameters: { retry_after: 45 }
    })
  });

  const res = await sendTelegramMessage(VALID_TOKEN, VALID_CHAT_ID, 'Hello', {
    fetchImpl: mockFetch
  });

  assert.equal(res.ok, false);
  assert.equal(res.retryAfter, 45);
  assert.match(res.error, /Rate limited.*45s/);
});

test('Telegram: testTelegramConnection sends formatted test message', async () => {
  let deliveredText = '';
  const mockFetch = async (url, opts) => {
    deliveredText = JSON.parse(opts.body).text;
    return {
      status: 200,
      json: async () => ({ ok: true })
    };
  };

  const res = await testTelegramConnection(VALID_TOKEN, VALID_CHAT_ID, 'instagram', {
    fetchImpl: mockFetch
  });

  assert.equal(res.ok, true);
  assert.match(deliveredText, /Test Message/);
  assert.match(deliveredText, /@instagram/);
});
