import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { loadDaemonConfig, saveDaemonConfig, DEFAULT_DAEMON_CONFIG } from '../daemon/config.js';
import { normalizeUsername, validateUsername, buildProfileUrl } from '../lib/validation.js';
import { processObservation, createInitialStateMachine } from '../lib/state-machine.js';
import { ObservationState, Confidence } from '../lib/constants.js';

const TEST_CONFIG = path.resolve('data/test_config.json');

function cleanup() {
  if (fs.existsSync(TEST_CONFIG)) {
    fs.unlinkSync(TEST_CONFIG);
  }
}

test('Daemon Config: loads default values when missing', () => {
  cleanup();
  const cfg = loadDaemonConfig(TEST_CONFIG);
  assert.equal(cfg.targetUsername, DEFAULT_DAEMON_CONFIG.targetUsername);
  assert.equal(cfg.intervalMinutes, 3);
  assert.equal(cfg.telegramNotificationsEnabled, false);
  cleanup();
});

test('Daemon Config: saves and updates atomically', () => {
  cleanup();
  saveDaemonConfig({
    targetUsername: 'test_account',
    intervalMinutes: 5,
    telegramNotificationsEnabled: true
  }, TEST_CONFIG);

  const reloaded = loadDaemonConfig(TEST_CONFIG);
  assert.equal(reloaded.targetUsername, 'test_account');
  assert.equal(reloaded.intervalMinutes, 5);
  assert.equal(reloaded.telegramNotificationsEnabled, true);
  cleanup();
});

test('Daemon Target Switching: normalizes, validates, and updates target profile', () => {
  cleanup();
  // Valid @ handle
  const rawHandle = '@new_profile_123';
  const clean = normalizeUsername(rawHandle);
  assert.equal(clean, 'new_profile_123');
  assert.equal(validateUsername(clean), true);

  const url = buildProfileUrl(clean);
  assert.equal(url, 'https://www.instagram.com/new_profile_123/');

  saveDaemonConfig({ targetUsername: clean, targetUrl: url }, TEST_CONFIG);
  const cfg = loadDaemonConfig(TEST_CONFIG);
  assert.equal(cfg.targetUsername, 'new_profile_123');
  assert.equal(cfg.targetUrl, 'https://www.instagram.com/new_profile_123/');

  // State machine baseline reset verification (Rule I)
  const existingState = createInitialStateMachine({
    currentAccount: 'old_account',
    lastReliableState: ObservationState.VISIBLE,
    previousReliableState: ObservationState.UNAVAILABLE
  });

  const evaluation = processObservation(existingState, {
    state: ObservationState.UNAVAILABLE,
    confidence: Confidence.HIGH,
    targetUsername: 'new_profile_123',
    reason: 'Initial check on new profile'
  });

  // Target change must reset baseline and establish without transition alert
  assert.equal(evaluation.isBaseline, true);
  assert.equal(evaluation.isTransition, false);
  assert.equal(evaluation.nextState.currentAccount, 'new_profile_123');
  assert.equal(evaluation.nextState.lastReliableState, ObservationState.UNAVAILABLE);
  assert.equal(evaluation.nextState.previousReliableState, null);

  cleanup();
});
