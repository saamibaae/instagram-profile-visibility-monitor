import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { applyEnvOverrides, DEFAULT_DAEMON_CONFIG } from '../daemon/config.js';
import {
  recordDaemonEventInMemory,
  readDaemonEvents,
  acquireDaemonLock,
  touchDaemonLock,
  pruneExpiredDailyPartitions
} from '../daemon/storage.js';
import { LOW_MEMORY_ARGS, withEphemeralBrowser } from '../daemon/browser.js';
import { startGuiServer } from '../daemon/server.js';
import { evaluateHttpFastPath } from '../daemon/http-fastpath.js';
import {
  telegramAgent,
  shouldThrottleTransitionAlert,
  resetFlapDampener,
  sendTelegramWithRetry
} from '../lib/telegram.js';
import { calculateNextDelayMs, getSystemPowerState } from '../daemon/scheduler.js';
import { ObservationState, Confidence, NotificationStatus } from '../lib/constants.js';

test('Production Optimizations: LOW_MEMORY_ARGS contains minimal memory and disk flags', () => {
  assert.ok(LOW_MEMORY_ARGS.includes('--disable-gpu'));
  assert.ok(LOW_MEMORY_ARGS.includes('--disk-cache-size=1'));
  assert.ok(LOW_MEMORY_ARGS.includes('--disable-application-cache'));
  assert.ok(LOW_MEMORY_ARGS.includes('--no-sandbox'));
  assert.ok(LOW_MEMORY_ARGS.includes('--disable-dev-shm-usage'));
  assert.ok(LOW_MEMORY_ARGS.includes('--renderer-process-limit=1'));
  assert.ok(LOW_MEMORY_ARGS.includes('--in-process-gpu'));
});

test('Production Optimizations: applyEnvOverrides respects 12-factor environment variables', () => {
  const originalEnv = { ...process.env };
  try {
    process.env.TARGET_USERNAME = 'env_custom_target';
    process.env.SCHEDULE_MODE = 'RANDOM_RANGE';
    process.env.RANDOM_MIN_SECONDS = '75';
    process.env.RANDOM_MAX_SECONDS = '150';
    process.env.TELEGRAM_NOTIFICATIONS_ENABLED = 'true';
    process.env.TELEGRAM_BOT_TOKEN = '123456789:TEST_ENV_TOKEN';
    process.env.TELEGRAM_CHAT_ID = '987654321';
    process.env.HEADLESS = 'true';
    process.env.EPHEMERAL_BROWSER = 'true';
    process.env.FAST_PATH = 'true';
    process.env.BATTERY_SAVER = 'true';

    const overridden = applyEnvOverrides(DEFAULT_DAEMON_CONFIG);
    assert.equal(overridden.targetUsername, 'env_custom_target');
    assert.equal(overridden.targetUrl, 'https://www.instagram.com/env_custom_target/');
    assert.equal(overridden.scheduleMode, 'RANDOM_RANGE');
    assert.equal(overridden.randomMinSeconds, 75);
    assert.equal(overridden.randomMaxSeconds, 150);
    assert.equal(overridden.telegramNotificationsEnabled, true);
    assert.equal(overridden.telegramBotToken, '123456789:TEST_ENV_TOKEN');
    assert.equal(overridden.telegramChatId, '987654321');
    assert.equal(overridden.ephemeralBrowser, true);
    assert.equal(overridden.fastPath, true);
    assert.equal(overridden.batterySaver, true);
  } finally {
    process.env = originalEnv;
  }
});

test('Production Optimizations: recordDaemonEventInMemory updates memory cache without disk failure', () => {
  const memoryEvent = recordDaemonEventInMemory({
    username: 'test_memory_acc',
    observedState: ObservationState.VISIBLE,
    reason: 'In-memory test heartbeat',
    checkDurationMs: 120,
    isTransition: false
  });

  assert.equal(memoryEvent.observedState, ObservationState.VISIBLE);
  assert.equal(memoryEvent.isTransition, false);

  const cachedEvents = readDaemonEvents({ limit: 10 });
  assert.ok(Array.isArray(cachedEvents));
  const found = cachedEvents.some((e) => e.id === memoryEvent.id);
  assert.ok(found, 'Recorded memory event should be present in cached events');
});

test('Production Optimizations: Server /healthz endpoint returns memory and uptime telemetry', async () => {
  const server = startGuiServer({ port: 3849, autoOpenBrowser: false });

  await new Promise((resolve) => server.once('listening', resolve));

  try {
    const res = await new Promise((resolve, reject) => {
      const req = http.get('http://127.0.0.1:3849/healthz', (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => resolve({ statusCode: r.statusCode, data: JSON.parse(body) }));
      });
      req.on('error', reject);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.data.status, 'ok');
    assert.equal(typeof res.data.uptime, 'number');
    assert.equal(typeof res.data.memoryRssMb, 'number');
    assert.equal(typeof res.data.memoryHeapMb, 'number');
    assert.ok(res.data.memoryRssMb > 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Production Optimizations: Fast-path classifies HTTP 404 as UNAVAILABLE in ~120ms without browser', async () => {
  const mock404Fetch = async () => ({
    status: 404,
    headers: new Map(),
    text: async () => 'Not Found'
  });

  const res = await evaluateHttpFastPath({
    targetUsername: 'instagram',
    targetUrl: 'https://www.instagram.com/instagram/'
  }, { fetchImpl: mock404Fetch });

  assert.equal(res.fallbackRequired, false);
  assert.equal(res.observation.state, ObservationState.UNAVAILABLE);
  assert.equal(res.observation.confidence, Confidence.HIGH);
  assert.equal(res.observation.source, 'http-fast-path');
});

test('Production Optimizations: Fast-path classifies matching og:title as VISIBLE without browser', async () => {
  const htmlBody = `<!DOCTYPE html><html><head><meta property="og:title" content="Instagram (@instagram) • Instagram photos"><title>Instagram (@instagram)</title></head><body><div>Profile</div></body></html>`;

  const mock200Fetch = async () => ({
    status: 200,
    headers: new Map(),
    text: async () => htmlBody
  });

  const res = await evaluateHttpFastPath({
    targetUsername: 'instagram',
    targetUrl: 'https://www.instagram.com/instagram/'
  }, { fetchImpl: mock200Fetch });

  assert.equal(res.fallbackRequired, false);
  assert.equal(res.observation.state, ObservationState.VISIBLE);
  assert.equal(res.observation.confidence, Confidence.HIGH);
});

test('Production Optimizations: Fast-path flags redirect to accounts/login for browser fallback', async () => {
  const headers = new Map();
  headers.set('location', 'https://www.instagram.com/accounts/login/?next=/instagram/');

  const mock302Fetch = async () => ({
    status: 302,
    headers: { get: (k) => headers.get(k) },
    text: async () => ''
  });

  const res = await evaluateHttpFastPath({
    targetUsername: 'instagram',
    targetUrl: 'https://www.instagram.com/instagram/'
  }, { fetchImpl: mock302Fetch });

  assert.equal(res.fallbackRequired, true);
  assert.match(res.reason, /redirect/i);
});

test('Production Optimizations: Fast-path flags client-side unhydrated skeleton for browser fallback', async () => {
  const htmlBody = `<!DOCTYPE html><html><head><title>Instagram</title></head><body><div id="mount_0_0"></div></body></html>`;

  const mockSkeletonFetch = async () => ({
    status: 200,
    headers: new Map(),
    text: async () => htmlBody
  });

  const res = await evaluateHttpFastPath({
    targetUsername: 'instagram',
    targetUrl: 'https://www.instagram.com/instagram/'
  }, { fetchImpl: mockSkeletonFetch });

  assert.equal(res.fallbackRequired, true);
  assert.match(res.reason, /unhydrated/i);
});

test('Production Optimizations: Telegram HTTPS Agent has keepAlive enabled', () => {
  assert.ok(telegramAgent);
  assert.equal(telegramAgent.keepAlive, true);
  assert.equal(telegramAgent.maxSockets, 5);
});

test('Production Optimizations: Flap dampener throttles repeated rapid alerts within cooldown', () => {
  resetFlapDampener();

  const mockEvent = {
    username: 'instagram',
    newObservation: ObservationState.UNAVAILABLE
  };

  const first = shouldThrottleTransitionAlert(mockEvent, 1000);
  assert.equal(first.throttled, false);

  const second = shouldThrottleTransitionAlert(mockEvent, 1000);
  assert.equal(second.throttled, true);
  assert.equal(second.pendingCount, 1);

  resetFlapDampener();
  const third = shouldThrottleTransitionAlert(mockEvent, 1000);
  assert.equal(third.throttled, false);
});

test('Production Optimizations: sendTelegramWithRetry retries on transient 500 error', async () => {
  let callCount = 0;
  const mockFlakyFetch = async () => {
    callCount++;
    if (callCount === 1) {
      return { status: 500, json: async () => ({ ok: false, description: 'Internal Telegram Gateway Error' }) };
    }
    return { status: 200, json: async () => ({ ok: true, result: { message_id: 123 } }) };
  };

  const res = await sendTelegramWithRetry(
    '123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ1234567',
    '987654321',
    'Test message',
    { fetchImpl: mockFlakyFetch },
    3
  );

  assert.equal(res.ok, true);
  assert.equal(res.status, NotificationStatus.SENT);
  assert.equal(callCount, 2);
  assert.equal(res.attempts, 2);
});

test('Production Optimizations: Heartbeat lock self-heals stale locks older than 2 minutes', () => {
  const testLockDir = path.resolve('data/test_lock_dir');
  const testLockFile = path.join(testLockDir, 'daemon.lock');

  if (!fs.existsSync(testLockDir)) {
    fs.mkdirSync(testLockDir, { recursive: true });
  }

  try {
    // Write a simulated stale lock with heartbeat older than 3 minutes (180s)
    const staleLock = {
      pid: process.pid, // current PID, but stale heartbeat
      startedAt: new Date(Date.now() - 300000).toISOString(),
      lastHeartbeatAt: new Date(Date.now() - 180000).toISOString()
    };
    fs.writeFileSync(testLockFile, JSON.stringify(staleLock), 'utf-8');

    // Should successfully self-heal and acquire without throwing
    acquireDaemonLock(process.pid, testLockFile);

    const acquired = JSON.parse(fs.readFileSync(testLockFile, 'utf-8'));
    assert.equal(acquired.pid, process.pid);

    // Test touchDaemonLock updates lastHeartbeatAt
    const beforeTouch = acquired.lastHeartbeatAt;
    touchDaemonLock(testLockFile);
    const afterTouch = JSON.parse(fs.readFileSync(testLockFile, 'utf-8')).lastHeartbeatAt;
    assert.ok(afterTouch >= beforeTouch);
  } finally {
    if (fs.existsSync(testLockDir)) {
      fs.rmSync(testLockDir, { recursive: true, force: true });
    }
  }
});

test('Production Optimizations: pruneExpiredDailyPartitions unlinks partitions older than maxAgeDays', () => {
  const testPartDir = path.resolve('data/test_partitions');
  if (!fs.existsSync(testPartDir)) {
    fs.mkdirSync(testPartDir, { recursive: true });
  }

  try {
    // Create today's file and an expired file from 5 days ago
    const todayStr = new Date().toISOString().slice(0, 10);
    const expiredStr = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const todayFile = path.join(testPartDir, `events_${todayStr}.jsonl`);
    const expiredFile = path.join(testPartDir, `events_${expiredStr}.jsonl`);

    fs.writeFileSync(todayFile, '{"test":"today"}\n');
    fs.writeFileSync(expiredFile, '{"test":"expired"}\n');

    const unlinked = pruneExpiredDailyPartitions(testPartDir, 2);
    assert.ok(unlinked.includes(`events_${expiredStr}.jsonl`));
    assert.equal(fs.existsSync(expiredFile), false);
    assert.equal(fs.existsSync(todayFile), true);
  } finally {
    if (fs.existsSync(testPartDir)) {
      fs.rmSync(testPartDir, { recursive: true, force: true });
    }
  }
});

test('Production Optimizations: getSystemPowerState returns system battery state safely', () => {
  const power = getSystemPowerState();
  assert.ok(power);
  assert.equal(typeof power.onBattery, 'boolean');
});
