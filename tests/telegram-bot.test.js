import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTelegramCommand,
  isAuthorizedChatId,
  checkSilentDegradation,
  resetDegradationTracker,
  executeTelegramCommand
} from '../daemon/telegram-bot.js';
import { ObservationState, Confidence } from '../lib/constants.js';

test('TelegramBot: parseTelegramCommand parses supported commands with arguments', () => {
  assert.deepEqual(parseTelegramCommand('/status'), { command: 'status', arg: '' });
  assert.deepEqual(parseTelegramCommand('/check'), { command: 'check', arg: '' });
  assert.deepEqual(parseTelegramCommand('/target instagram'), { command: 'target', arg: 'instagram' });
  assert.deepEqual(parseTelegramCommand('/target @cristiano'), { command: 'target', arg: 'cristiano' });
  assert.deepEqual(parseTelegramCommand('/pause'), { command: 'pause', arg: '' });
  assert.deepEqual(parseTelegramCommand('/resume'), { command: 'resume', arg: '' });
  assert.deepEqual(parseTelegramCommand('/help'), { command: 'help', arg: '' });
  assert.deepEqual(parseTelegramCommand('/unknown_cmd'), { command: 'unknown', arg: '' });
  assert.deepEqual(parseTelegramCommand('not a command'), null);
});

test('TelegramBot: isAuthorizedChatId strictly validates sender chat ID', () => {
  const authorizedId = '123456789';
  assert.equal(isAuthorizedChatId('123456789', authorizedId), true);
  assert.equal(isAuthorizedChatId(123456789, authorizedId), true);
  assert.equal(isAuthorizedChatId('999999999', authorizedId), false);
  assert.equal(isAuthorizedChatId('', authorizedId), false);
  assert.equal(isAuthorizedChatId(null, authorizedId), false);
});

test('TelegramBot: checkSilentDegradation detects consecutive failure threshold and suppresses repeat alerts', () => {
  resetDegradationTracker();

  const unknownObs = {
    state: ObservationState.UNKNOWN,
    confidence: Confidence.LOW,
    reason: 'Page structure changed or challenge encountered'
  };

  // Checks 1 to 4: should not trigger alert yet (threshold = 5)
  for (let i = 1; i <= 4; i++) {
    const res = checkSilentDegradation(unknownObs, { threshold: 5 });
    assert.equal(res.shouldAlert, false);
    assert.equal(res.consecutiveCount, i);
  }

  // Check 5: Hits threshold -> triggers alert
  const alertRes = checkSilentDegradation(unknownObs, { threshold: 5 });
  assert.equal(alertRes.shouldAlert, true);
  assert.equal(alertRes.consecutiveCount, 5);
  assert.ok(alertRes.message.includes('Monitoring Blinded'));

  // Check 6: Consecutive check 6 in same streak -> suppressed (no spam)
  const streak6Res = checkSilentDegradation(unknownObs, { threshold: 5 });
  assert.equal(streak6Res.shouldAlert, false);
  assert.equal(streak6Res.consecutiveCount, 6);

  // Recovery: Visible state observed -> resets streak
  const visibleObs = {
    state: ObservationState.VISIBLE,
    confidence: Confidence.HIGH,
    reason: 'Verified handle'
  };
  const recoveryRes = checkSilentDegradation(visibleObs, { threshold: 5 });
  assert.equal(recoveryRes.shouldAlert, false);
  assert.equal(recoveryRes.consecutiveCount, 0);

  // Subsequent unknown starts from 1 again
  const nextRes = checkSilentDegradation(unknownObs, { threshold: 5 });
  assert.equal(nextRes.consecutiveCount, 1);
});

test('TelegramBot: executeTelegramCommand handles supported commands accurately', async () => {
  const helpReply = await executeTelegramCommand('help');
  assert.match(helpReply, /Available Commands/);

  const statusReply = await executeTelegramCommand('status');
  assert.match(statusReply, /System Telemetry & Status/);

  const targetReply = await executeTelegramCommand('target', 'valid_user');
  assert.match(targetReply, /Target Profile Updated/);
  assert.match(targetReply, /@valid_user/);

  const invalidTargetReply = await executeTelegramCommand('target', 'bad!user#name');
  assert.match(invalidTargetReply, /Invalid Handle/);

  const pauseReply = await executeTelegramCommand('pause');
  assert.match(pauseReply, /Monitoring Paused/);

  const resumeReply = await executeTelegramCommand('resume');
  assert.match(resumeReply, /Monitoring Resumed/);
});
