import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  loadDaemonConfig,
  saveDaemonConfig,
  migrateDaemonConfig,
  DEFAULT_DAEMON_CONFIG
} from '../daemon/config.js';
import { ScheduleMode, CONFIG_SCHEMA_VERSION } from '../lib/constants.js';

const MIGRATION_TEST_FILE = path.resolve('data/test_migration_config.json');
const BACKUP_FILE = `${MIGRATION_TEST_FILE}.backup.json`;

function cleanup() {
  const dir = path.dirname(MIGRATION_TEST_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(MIGRATION_TEST_FILE)) fs.unlinkSync(MIGRATION_TEST_FILE);
  if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
}

test('Config Migration: Migrates legacy v1 config to schema v2 with backup', () => {
  cleanup();

  // Create legacy unversioned config (v1)
  const legacyV1 = {
    targetUsername: 'migrated_user',
    targetUrl: 'https://www.instagram.com/migrated_user/',
    intervalMinutes: 5,
    telegramNotificationsEnabled: true,
    telegramBotToken: '123456789:TEST_TOKEN_SECRET',
    telegramChatId: '987654321',
    headless: true
  };

  fs.writeFileSync(MIGRATION_TEST_FILE, JSON.stringify(legacyV1, null, 2), 'utf-8');

  // Load through loadDaemonConfig which triggers migration
  const migrated = loadDaemonConfig(MIGRATION_TEST_FILE);

  assert.equal(migrated.schemaVersion, CONFIG_SCHEMA_VERSION);
  assert.equal(migrated.targetUsername, 'migrated_user');
  assert.equal(migrated.scheduleMode, ScheduleMode.FIXED);
  assert.equal(migrated.fixedIntervalMinutes, 5);
  assert.equal(migrated.intervalMinutes, 5);
  assert.equal(migrated.randomMinSeconds, 60);
  assert.equal(migrated.randomMaxSeconds, 180);
  assert.equal(migrated.telegramBotToken, '123456789:TEST_TOKEN_SECRET');

  // Verify backup was created
  assert.equal(fs.existsSync(BACKUP_FILE), true);
  const backupContent = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
  assert.equal(backupContent.targetUsername, 'migrated_user');
  assert.equal(backupContent.schemaVersion, undefined);

  cleanup();
});

test('Config Migration: Preserves already migrated v2 config without overwriting', () => {
  cleanup();

  const v2Config = {
    schemaVersion: 2,
    targetUsername: 'user_v2',
    scheduleMode: ScheduleMode.RANDOM_RANGE,
    fixedIntervalMinutes: 10,
    randomMinSeconds: 90,
    randomMaxSeconds: 150
  };

  saveDaemonConfig(v2Config, MIGRATION_TEST_FILE);
  const loaded = loadDaemonConfig(MIGRATION_TEST_FILE);

  assert.equal(loaded.schemaVersion, 2);
  assert.equal(loaded.targetUsername, 'user_v2');
  assert.equal(loaded.scheduleMode, ScheduleMode.RANDOM_RANGE);
  assert.equal(loaded.randomMinSeconds, 90);
  assert.equal(loaded.randomMaxSeconds, 150);

  // Backup should NOT be created if already at target schema
  assert.equal(fs.existsSync(BACKUP_FILE), false);

  cleanup();
});
