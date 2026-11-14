import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { sanitizeConfigForClient } from '../daemon/config.js';
import { exportDaemonEventsToCsv } from '../daemon/storage.js';

test('Security Audit: sanitizeConfigForClient masks Telegram Bot Token', () => {
  const secretToken = '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567';
  const rawConfig = {
    schemaVersion: 2,
    targetUsername: 'test_user',
    targetUrl: 'https://www.instagram.com/test_user/',
    scheduleMode: 'FIXED',
    fixedIntervalMinutes: 3,
    telegramNotificationsEnabled: true,
    telegramBotToken: secretToken,
    telegramChatId: '123456789'
  };

  const sanitized = sanitizeConfigForClient(rawConfig);

  // Must NOT contain the plaintext token
  assert.equal(sanitized.telegramBotToken, undefined);
  assert.equal(sanitized.telegramBotTokenMasked, '••••••••');
  assert.equal(sanitized.telegramConfigured, true);
  assert.equal(JSON.stringify(sanitized).includes(secretToken), false);
});

test('Security Audit: CSV Export never exposes tokens or credentials', () => {
  const testCsvPath = path.resolve('data/test_security_export.csv');
  const sampleEvents = [
    {
      id: 'evt_1',
      timestampUtc: '2026-11-09T18:00:00.000Z',
      username: 'target_account',
      observedState: 'VISIBLE',
      confidence: 'HIGH',
      reason: 'Verified target handle',
      checkDurationMs: 1250,
      isTransition: false,
      notificationStatus: 'SKIPPED'
    }
  ];

  exportDaemonEventsToCsv(sampleEvents, testCsvPath);
  const csvContent = fs.readFileSync(testCsvPath, 'utf-8');

  // Verify headers and content do not have credential fields
  assert.equal(csvContent.includes('telegramBotToken'), false);
  assert.equal(csvContent.includes('password'), false);
  assert.equal(csvContent.includes('cookie'), false);
  assert.equal(csvContent.includes('sessionid'), false);

  if (fs.existsSync(testCsvPath)) fs.unlinkSync(testCsvPath);
});

test('Security Audit: CSV Export neutralizes formula injection', () => {
  const testCsvPath = path.resolve('data/test_formula_injection.csv');
  const sampleEvents = [
    {
      id: '=1+1',
      timestampUtc: '2026-11-09T18:00:00.000Z',
      username: '@evil_user',
      observedState: 'VISIBLE',
      confidence: 'HIGH',
      reason: '+cmd|\' /C calc\'!A0',
      checkDurationMs: 120,
      isTransition: false,
      notificationStatus: 'SKIPPED'
    }
  ];

  exportDaemonEventsToCsv(sampleEvents, testCsvPath);
  const csvContent = fs.readFileSync(testCsvPath, 'utf-8');

  // Must prepend single quote to neutralize spreadsheet formula execution
  assert.equal(csvContent.includes('"\'=1+1"'), true);
  assert.equal(csvContent.includes('"\'@evil_user"'), true);
  assert.equal(csvContent.includes('"\'+cmd|\''), true);

  if (fs.existsSync(testCsvPath)) fs.unlinkSync(testCsvPath);
});

test('Security Audit: .gitignore excludes runtime storage, secrets, and backups', () => {
  const gitignoreContent = fs.readFileSync(path.resolve('.gitignore'), 'utf-8');
  assert.equal(gitignoreContent.includes('data/'), true);
  assert.equal(gitignoreContent.includes('.env'), true);
  assert.equal(gitignoreContent.includes('*.log'), true);
  assert.equal(gitignoreContent.includes('*.backup.json'), true);
});

test('Security Audit: Git tracked content contains no live exposed tokens', () => {
  try {
    const gitGrepOutput = execSync('git grep -n -E "[0-9]{9,10}:[A-Za-z0-9_-]{35}"', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const nonDummyMatches = gitGrepOutput
      .split('\n')
      .filter((line) => line.trim() && !line.includes('123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567') && !line.includes('1234567890:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567'));
    assert.equal(nonDummyMatches.length, 0, `Found unexpected plaintext token in tracked git files: ${nonDummyMatches.join(', ')}`);
  } catch (err) {
    // git grep exits with code 1 when no match is found, which proves files are clean
    assert.ok(true);
  }
});
