/**
 * Standalone Daemon Configuration Manager
 * Persists application settings to data/config.json with atomic writes and schema versioning.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_TARGET_USERNAME,
  DEFAULT_TARGET_URL,
  DEFAULT_INTERVAL_MINUTES,
  CONFIG_SCHEMA_VERSION,
  ScheduleMode,
  FIXED_INTERVAL_MIN_MINUTES,
  FIXED_INTERVAL_MAX_MINUTES,
  DEFAULT_RANDOM_MIN_SECONDS,
  DEFAULT_RANDOM_MAX_SECONDS,
  TIMEZONE
} from '../lib/constants.js';
import { validateScheduleConfig } from '../lib/validation.js';
import { logger } from '../lib/logger.js';

const DATA_DIR = path.resolve('data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

export const DEFAULT_DAEMON_CONFIG = Object.freeze({
  schemaVersion: CONFIG_SCHEMA_VERSION,
  targetUsername: DEFAULT_TARGET_USERNAME,
  targetUrl: DEFAULT_TARGET_URL,
  scheduleMode: ScheduleMode.FIXED,
  fixedIntervalMinutes: DEFAULT_INTERVAL_MINUTES,
  randomMinSeconds: DEFAULT_RANDOM_MIN_SECONDS,
  randomMaxSeconds: DEFAULT_RANDOM_MAX_SECONDS,
  // Legacy intervalMinutes preserved for backward compatibility
  intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  telegramNotificationsEnabled: false,
  telegramBotToken: '',
  telegramChatId: '',
  headless: true,
  ephemeralBrowser: true,
  fastPath: true,
  batterySaver: false,
  proxyUrl: '',
  timezone: TIMEZONE,
  historyRetentionLimit: 1000,
  dataDir: DATA_DIR,
  browserProfileDir: path.join(DATA_DIR, 'browser_profile')
});

function ensureDataDir(dir = DATA_DIR) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Performs safe, atomic configuration migration from v1 to v2.
 * Creates a backup file before writing migrated settings.
 * @param {object} parsed
 * @param {string} customPath
 * @returns {object}
 */
export function migrateDaemonConfig(parsed, customPath = CONFIG_FILE) {
  const currentVersion = parsed.schemaVersion || 1;
  if (currentVersion >= CONFIG_SCHEMA_VERSION) {
    return parsed;
  }

  logger.info('DaemonConfig', `Migrating configuration from schema v${currentVersion} to v${CONFIG_SCHEMA_VERSION}`);

  // Create backup before migration
  try {
    const backupPath = `${customPath}.backup.json`;
    fs.writeFileSync(backupPath, JSON.stringify(parsed, null, 2), 'utf-8');
    logger.info('DaemonConfig', `Created pre-migration backup at ${backupPath}`);
  } catch (err) {
    logger.warn('DaemonConfig', 'Could not create pre-migration backup', err.message);
  }

  // Determine fixed interval from legacy intervalMinutes if present
  let fixedInterval = DEFAULT_INTERVAL_MINUTES;
  if (typeof parsed.fixedIntervalMinutes === 'number' && parsed.fixedIntervalMinutes >= FIXED_INTERVAL_MIN_MINUTES) {
    fixedInterval = parsed.fixedIntervalMinutes;
  } else if (typeof parsed.intervalMinutes === 'number') {
    fixedInterval = Math.max(FIXED_INTERVAL_MIN_MINUTES, Math.min(FIXED_INTERVAL_MAX_MINUTES, parsed.intervalMinutes));
  }

  const migrated = {
    ...DEFAULT_DAEMON_CONFIG,
    ...parsed,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    scheduleMode: parsed.scheduleMode || ScheduleMode.FIXED,
    fixedIntervalMinutes: fixedInterval,
    randomMinSeconds: parsed.randomMinSeconds || DEFAULT_RANDOM_MIN_SECONDS,
    randomMaxSeconds: parsed.randomMaxSeconds || DEFAULT_RANDOM_MAX_SECONDS,
    intervalMinutes: fixedInterval
  };

  // Save migrated file atomically
  try {
    const tempPath = `${customPath}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(migrated, null, 2), 'utf-8');
    fs.renameSync(tempPath, customPath);
    logger.info('DaemonConfig', 'Migration completed and saved successfully');
  } catch (err) {
    logger.error('DaemonConfig', 'Failed to save migrated config', err.message);
  }

  return migrated;
}

/**
 * Overlays 12-Factor environment variables on top of active configuration.
 * Enables zero-touch containerized and cloud deployments.
 * @param {object} config
 * @returns {object}
 */
export function applyEnvOverrides(config) {
  const result = { ...config };
  if (process.env.TARGET_USERNAME) {
    result.targetUsername = process.env.TARGET_USERNAME.replace(/^@/, '').trim();
    result.targetUrl = `https://www.instagram.com/${result.targetUsername}/`;
  }
  if (process.env.SCHEDULE_MODE && ['FIXED', 'RANDOM_RANGE'].includes(process.env.SCHEDULE_MODE)) {
    result.scheduleMode = process.env.SCHEDULE_MODE;
  }
  if (process.env.FIXED_INTERVAL_MINUTES) {
    const min = parseInt(process.env.FIXED_INTERVAL_MINUTES, 10);
    if (!Number.isNaN(min) && min >= FIXED_INTERVAL_MIN_MINUTES && min <= FIXED_INTERVAL_MAX_MINUTES) {
      result.fixedIntervalMinutes = min;
      result.intervalMinutes = min;
    }
  }
  if (process.env.RANDOM_MIN_SECONDS) {
    const rMin = parseInt(process.env.RANDOM_MIN_SECONDS, 10);
    if (!Number.isNaN(rMin) && rMin >= 60 && rMin <= 180) result.randomMinSeconds = rMin;
  }
  if (process.env.RANDOM_MAX_SECONDS) {
    const rMax = parseInt(process.env.RANDOM_MAX_SECONDS, 10);
    if (!Number.isNaN(rMax) && rMax >= 60 && rMax <= 180) result.randomMaxSeconds = rMax;
  }
  if (process.env.TELEGRAM_NOTIFICATIONS_ENABLED !== undefined) {
    result.telegramNotificationsEnabled = process.env.TELEGRAM_NOTIFICATIONS_ENABLED === 'true' || process.env.TELEGRAM_NOTIFICATIONS_ENABLED === '1';
  }
  if (process.env.TELEGRAM_BOT_TOKEN) {
    result.telegramBotToken = process.env.TELEGRAM_BOT_TOKEN.trim();
  }
  if (process.env.TELEGRAM_CHAT_ID) {
    result.telegramChatId = process.env.TELEGRAM_CHAT_ID.trim();
  }
  if (process.env.HEADLESS !== undefined) {
    result.headless = process.env.HEADLESS !== 'false' && process.env.HEADLESS !== '0';
  }
  if (process.env.EPHEMERAL_BROWSER !== undefined) {
    result.ephemeralBrowser = process.env.EPHEMERAL_BROWSER !== 'false' && process.env.EPHEMERAL_BROWSER !== '0';
  }
  if (process.env.FAST_PATH !== undefined) {
    result.fastPath = process.env.FAST_PATH !== 'false' && process.env.FAST_PATH !== '0';
  }
  if (process.env.BATTERY_SAVER !== undefined) {
    result.batterySaver = process.env.BATTERY_SAVER === 'true' || process.env.BATTERY_SAVER === '1';
  }
  if (process.env.PROXY_URL) {
    result.proxyUrl = process.env.PROXY_URL.trim();
  }
  return result;
}

/**
 * Loads daemon configuration, creating default file if missing and migrating if legacy.
 * @param {string} [customPath]
 * @returns {object}
 */
export function loadDaemonConfig(customPath = CONFIG_FILE) {
  try {
    ensureDataDir(path.dirname(customPath));
    let base = DEFAULT_DAEMON_CONFIG;
    if (fs.existsSync(customPath)) {
      const raw = fs.readFileSync(customPath, 'utf-8');
      const parsed = JSON.parse(raw);

      // Check if migration is required
      if (!parsed.schemaVersion || parsed.schemaVersion < CONFIG_SCHEMA_VERSION) {
        base = migrateDaemonConfig(parsed, customPath);
      } else {
        base = { ...DEFAULT_DAEMON_CONFIG, ...parsed };
      }
    } else {
      // Write defaults if missing
      saveDaemonConfig(DEFAULT_DAEMON_CONFIG, customPath);
    }
    return applyEnvOverrides(base);
  } catch (err) {
    logger.error('DaemonConfig', 'Error reading config, using defaults', err.message);
    return applyEnvOverrides({ ...DEFAULT_DAEMON_CONFIG });
  }
}

/**
 * Saves daemon configuration with atomic write and schema validation.
 * @param {object} updates
 * @param {string} [customPath]
 * @returns {object}
 */
export function saveDaemonConfig(updates = {}, customPath = CONFIG_FILE) {
  ensureDataDir(path.dirname(customPath));
  const safeUpdates = { ...updates };
  let current = {};
  try {
    if (fs.existsSync(customPath)) {
      current = JSON.parse(fs.readFileSync(customPath, 'utf-8'));
    }
  } catch {
    current = {};
  }

  // Validate schedule updates if provided
  if (safeUpdates.scheduleMode || safeUpdates.fixedIntervalMinutes || safeUpdates.randomMinSeconds || safeUpdates.randomMaxSeconds) {
    const candidateSchedule = {
      scheduleMode: safeUpdates.scheduleMode || current.scheduleMode || DEFAULT_DAEMON_CONFIG.scheduleMode,
      fixedIntervalMinutes: safeUpdates.fixedIntervalMinutes !== undefined
        ? safeUpdates.fixedIntervalMinutes
        : (current.fixedIntervalMinutes || DEFAULT_DAEMON_CONFIG.fixedIntervalMinutes),
      randomMinSeconds: safeUpdates.randomMinSeconds !== undefined
        ? safeUpdates.randomMinSeconds
        : (current.randomMinSeconds || DEFAULT_DAEMON_CONFIG.randomMinSeconds),
      randomMaxSeconds: safeUpdates.randomMaxSeconds !== undefined
        ? safeUpdates.randomMaxSeconds
        : (current.randomMaxSeconds || DEFAULT_DAEMON_CONFIG.randomMaxSeconds)
    };

    const validation = validateScheduleConfig(candidateSchedule);
    if (!validation.valid) {
      throw new Error(`Schedule validation failed: ${validation.errors.join('; ')}`);
    }
  }

  // Keep legacy intervalMinutes synchronized with fixedIntervalMinutes
  if (safeUpdates.fixedIntervalMinutes !== undefined) {
    safeUpdates.intervalMinutes = safeUpdates.fixedIntervalMinutes;
  } else if (safeUpdates.intervalMinutes !== undefined && safeUpdates.fixedIntervalMinutes === undefined) {
    safeUpdates.fixedIntervalMinutes = safeUpdates.intervalMinutes;
  }

  const merged = {
    ...DEFAULT_DAEMON_CONFIG,
    ...current,
    ...safeUpdates,
    schemaVersion: CONFIG_SCHEMA_VERSION
  };

  const tempPath = `${customPath}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(merged, null, 2), 'utf-8');
  fs.renameSync(tempPath, customPath);

  logger.info('DaemonConfig', 'Configuration saved successfully');
  return merged;
}

/**
 * Returns a sanitized copy of configuration safe to expose in API responses.
 * Never leaks the plaintext Telegram Bot Token.
 * @param {object} config
 * @returns {object}
 */
export function sanitizeConfigForClient(config) {
  if (!config || typeof config !== 'object') return {};
  const hasToken = Boolean(config.telegramBotToken && config.telegramBotToken.trim());
  return {
    schemaVersion: config.schemaVersion,
    targetUsername: config.targetUsername,
    targetUrl: config.targetUrl,
    scheduleMode: config.scheduleMode,
    fixedIntervalMinutes: config.fixedIntervalMinutes,
    randomMinSeconds: config.randomMinSeconds,
    randomMaxSeconds: config.randomMaxSeconds,
    telegramNotificationsEnabled: Boolean(config.telegramNotificationsEnabled),
    telegramConfigured: hasToken && Boolean(config.telegramChatId),
    telegramBotTokenMasked: hasToken ? '••••••••' : '',
    telegramChatId: config.telegramChatId ? String(config.telegramChatId) : '',
    timezone: config.timezone || TIMEZONE,
    headless: config.headless !== false
  };
}
