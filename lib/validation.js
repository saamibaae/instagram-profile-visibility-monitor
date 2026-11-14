/**
 * Input and Schema Validation Module
 */

import {
  ObservationState,
  Confidence,
  ScheduleMode,
  FIXED_INTERVAL_MIN_MINUTES,
  FIXED_INTERVAL_MAX_MINUTES,
  RANDOM_RANGE_MIN_SECONDS,
  RANDOM_RANGE_MAX_SECONDS
} from './constants.js';

const INSTAGRAM_USERNAME_REGEX = /^[a-zA-Z0-9._]{1,30}$/;
const TELEGRAM_BOT_TOKEN_REGEX = /^[0-9]{8,12}:[a-zA-Z0-9_-]{30,50}$/;
const TELEGRAM_CHAT_ID_REGEX = /^-?[0-9]{5,15}$/;

/**
 * Normalizes an Instagram username or URL into a clean username string.
 * @param {string} input - Username or Instagram profile URL
 * @returns {string} Normalized lowercase username
 */
export function normalizeUsername(input) {
  if (typeof input !== 'string') return '';
  let trimmed = input.trim();
  if (!trimmed) return '';

  // Remove leading @
  if (trimmed.startsWith('@')) {
    trimmed = trimmed.slice(1);
  }

  // Handle URL format: https://www.instagram.com/username/?...
  if (trimmed.includes('instagram.com/')) {
    try {
      const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        trimmed = parts[0];
      }
    } catch {
      // Fallback regex extraction if URL parsing fails
      const match = trimmed.match(/instagram\.com\/([a-zA-Z0-9._]+)/i);
      if (match && match[1]) {
        trimmed = match[1];
      }
    }
  }

  // Strip trailing slashes or query components
  trimmed = trimmed.replace(/\/+$/, '').split('?')[0].split('#')[0];

  return trimmed.toLowerCase();
}

/**
 * Validates whether a username complies with Instagram username rules.
 * @param {string} username
 * @returns {boolean}
 */
export function validateUsername(username) {
  if (typeof username !== 'string') return false;
  const clean = username.trim();
  if (!INSTAGRAM_USERNAME_REGEX.test(clean)) return false;
  // Instagram handles cannot start or end with a period, and cannot have consecutive periods
  if (clean.startsWith('.') || clean.endsWith('.')) return false;
  if (clean.includes('..')) return false;
  return true;
}

/**
 * Builds canonical Instagram profile URL from username.
 * @param {string} username
 * @returns {string}
 */
export function buildProfileUrl(username) {
  const clean = normalizeUsername(username);
  if (!validateUsername(clean)) {
    throw new Error(`Invalid Instagram username: "${username}"`);
  }
  return `https://www.instagram.com/${clean}/`;
}

/**
 * Validates that a URL is a legitimate Instagram profile URL for target.
 * @param {string} url
 * @param {string} [expectedUsername]
 * @returns {boolean}
 */
export function validateProfileUrl(url, expectedUsername) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (!['www.instagram.com', 'instagram.com'].includes(parsed.hostname.toLowerCase())) {
      return false;
    }
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length < 1) return false;
    const pathUser = pathParts[0].toLowerCase();
    // Exclude reserved system paths
    const reserved = ['explore', 'reels', 'stories', 'direct', 'accounts', 'developer', 'about', 'legal'];
    if (reserved.includes(pathUser)) return false;

    if (expectedUsername) {
      return pathUser === normalizeUsername(expectedUsername);
    }
    return validateUsername(pathUser);
  } catch {
    return false;
  }
}

/**
 * Validates Telegram Bot API Token format.
 * @param {string} token
 * @returns {boolean}
 */
export function validateTelegramToken(token) {
  if (typeof token !== 'string') return false;
  return TELEGRAM_BOT_TOKEN_REGEX.test(token.trim());
}

/**
 * Validates Telegram Chat ID format.
 * @param {string|number} chatId
 * @returns {boolean}
 */
export function validateTelegramChatId(chatId) {
  if (typeof chatId === 'number') {
    return Number.isInteger(chatId) && chatId !== 0;
  }
  if (typeof chatId !== 'string') return false;
  return TELEGRAM_CHAT_ID_REGEX.test(chatId.trim());
}

/**
 * Validates monitoring interval in minutes.
 * @param {number} minutes
 * @returns {boolean}
 */
export function validateInterval(minutes) {
  return typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 1 && minutes <= 60;
}

/**
 * Validates fixed schedule interval in whole minutes (3 to 60).
 * @param {number} minutes
 * @returns {boolean}
 */
export function validateFixedInterval(minutes) {
  return typeof minutes === 'number' && Number.isInteger(minutes) &&
    minutes >= FIXED_INTERVAL_MIN_MINUTES && minutes <= FIXED_INTERVAL_MAX_MINUTES;
}

/**
 * Validates random range bounds in seconds (60 to 180 seconds, min <= max).
 * @param {number} minSeconds
 * @param {number} maxSeconds
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateRandomRange(minSeconds, maxSeconds) {
  if (typeof minSeconds !== 'number' || !Number.isInteger(minSeconds) ||
      typeof maxSeconds !== 'number' || !Number.isInteger(maxSeconds)) {
    return { valid: false, error: 'Minimum and maximum bounds must be whole integers in seconds.' };
  }
  if (minSeconds < RANDOM_RANGE_MIN_SECONDS) {
    return { valid: false, error: `Minimum interval cannot be less than ${RANDOM_RANGE_MIN_SECONDS} seconds.` };
  }
  if (maxSeconds > RANDOM_RANGE_MAX_SECONDS) {
    return { valid: false, error: `Maximum interval cannot exceed ${RANDOM_RANGE_MAX_SECONDS} seconds.` };
  }
  if (minSeconds > maxSeconds) {
    return { valid: false, error: 'Minimum interval bound cannot be greater than maximum bound.' };
  }
  return { valid: true };
}

/**
 * Validates a complete schedule configuration object.
 * @param {object} schedule
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateScheduleConfig(schedule) {
  const errors = [];
  if (!schedule || typeof schedule !== 'object') {
    return { valid: false, errors: ['Schedule configuration must be an object.'] };
  }

  const mode = schedule.scheduleMode;
  if (!mode || !Object.values(ScheduleMode).includes(mode)) {
    errors.push(`Invalid schedule mode: "${mode}". Must be ${Object.values(ScheduleMode).join(' or ')}.`);
  }

  if (mode === ScheduleMode.FIXED) {
    const mins = schedule.fixedIntervalMinutes;
    if (!validateFixedInterval(mins)) {
      errors.push(`Fixed interval must be an integer between ${FIXED_INTERVAL_MIN_MINUTES} and ${FIXED_INTERVAL_MAX_MINUTES} minutes (received: ${mins}).`);
    }
  } else if (mode === ScheduleMode.RANDOM_RANGE) {
    const rangeResult = validateRandomRange(schedule.randomMinSeconds, schedule.randomMaxSeconds);
    if (!rangeResult.valid) {
      errors.push(rangeResult.error);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates an observation object structure.
 * @param {object} obs
 * @returns {boolean}
 */
export function validateObservation(obs) {
  if (!obs || typeof obs !== 'object') return false;
  if (!Object.values(ObservationState).includes(obs.state)) return false;
  if (!Object.values(Confidence).includes(obs.confidence)) return false;
  if (typeof obs.observedAt !== 'string' || Number.isNaN(Date.parse(obs.observedAt))) return false;
  if (typeof obs.targetUsername !== 'string' || !obs.targetUsername) return false;
  if (typeof obs.reason !== 'string') return false;
  return true;
}
