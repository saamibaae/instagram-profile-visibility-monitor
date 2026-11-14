import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeUsername,
  validateUsername,
  buildProfileUrl,
  validateProfileUrl,
  validateTelegramToken,
  validateTelegramChatId,
  validateInterval,
  validateObservation
} from '../lib/validation.js';
import { ObservationState, Confidence } from '../lib/constants.js';

test('Validation: normalizeUsername extracts usernames correctly', () => {
  assert.equal(normalizeUsername('instagram'), 'instagram');
  assert.equal(normalizeUsername('@instagram'), 'instagram');
  assert.equal(normalizeUsername('https://www.instagram.com/instagram/'), 'instagram');
  assert.equal(normalizeUsername('https://instagram.com/instagram?igsh=abc123#profile'), 'instagram');
  assert.equal(normalizeUsername('   instagram   '), 'instagram');
  assert.equal(normalizeUsername(''), '');
  assert.equal(normalizeUsername(null), '');
});

test('Validation: validateUsername rejects invalid characters and patterns', () => {
  assert.equal(validateUsername('instagram'), true);
  assert.equal(validateUsername('john.doe'), true);
  assert.equal(validateUsername('john_doe_99'), true);

  assert.equal(validateUsername('.johndoe'), false); // Cannot start with dot
  assert.equal(validateUsername('johndoe.'), false); // Cannot end with dot
  assert.equal(validateUsername('john..doe'), false); // Cannot have double dot
  assert.equal(validateUsername('john doe'), false); // No spaces
  assert.equal(validateUsername('john$doe'), false); // No special chars
  assert.equal(validateUsername(''), false);
  assert.equal(validateUsername('a'.repeat(31)), false); // Max 30 chars
});

test('Validation: buildProfileUrl formats correctly', () => {
  assert.equal(buildProfileUrl('instagram'), 'https://www.instagram.com/instagram/');
  assert.throws(() => buildProfileUrl('invalid@user!'));
});

test('Validation: validateProfileUrl checks domains and paths', () => {
  assert.equal(validateProfileUrl('https://www.instagram.com/instagram/', 'instagram'), true);
  assert.equal(validateProfileUrl('https://instagram.com/instagram/', 'instagram'), true);
  assert.equal(validateProfileUrl('https://www.instagram.com/otheruser/', 'instagram'), false);
  assert.equal(validateProfileUrl('https://www.instagram.com/explore/'), false); // Reserved path
  assert.equal(validateProfileUrl('https://evil-phish.com/instagram/'), false); // Wrong domain
  assert.equal(validateProfileUrl('not-a-url'), false);
});

test('Validation: validateTelegramToken checks format', () => {
  assert.equal(validateTelegramToken('123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567'), true);
  assert.equal(validateTelegramToken('1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567'), true);
  assert.equal(validateTelegramToken('invalid-token'), false);
  assert.equal(validateTelegramToken('12345:short'), false);
  assert.equal(validateTelegramToken(''), false);
  assert.equal(validateTelegramToken(null), false);
});

test('Validation: validateTelegramChatId checks format', () => {
  assert.equal(validateTelegramChatId('123456789'), true);
  assert.equal(validateTelegramChatId(123456789), true);
  assert.equal(validateTelegramChatId('-1001234567890'), true);
  assert.equal(validateTelegramChatId(-1001234567890), true);
  assert.equal(validateTelegramChatId('abc'), false);
  assert.equal(validateTelegramChatId(''), false);
});

test('Validation: validateInterval checks range', () => {
  assert.equal(validateInterval(1), true);
  assert.equal(validateInterval(3), true);
  assert.equal(validateInterval(60), true);
  assert.equal(validateInterval(0), false);
  assert.equal(validateInterval(61), false);
  assert.equal(validateInterval(2.5), false);
  assert.equal(validateInterval('3'), false);
});

test('Validation: validateObservation validates schema', () => {
  const valid = {
    state: ObservationState.VISIBLE,
    confidence: Confidence.HIGH,
    observedAt: '2026-11-09T12:00:00.000Z',
    targetUsername: 'instagram',
    reason: 'Valid profile header'
  };
  assert.equal(validateObservation(valid), true);

  assert.equal(validateObservation({ ...valid, state: 'INVALID_STATE' }), false);
  assert.equal(validateObservation({ ...valid, observedAt: 'invalid-date' }), false);
  assert.equal(validateObservation({ ...valid, targetUsername: '' }), false);
  assert.equal(validateObservation(null), false);
});
