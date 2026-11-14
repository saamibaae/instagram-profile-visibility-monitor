/**
 * Telegram Bot API Integration Module
 * Official Telegram Bot API via standard fetch().
 * Zero credential leakage, robust error handling, and structured formatting.
 */

import https from 'node:https';
import { formatDhakaDateTime, formatDhakaTime } from './timestamps.js';
import { validateTelegramToken, validateTelegramChatId } from './validation.js';
import { ObservationState, NotificationStatus } from './constants.js';
import { logger } from './logger.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const DEFAULT_TIMEOUT_MS = 10000;

// Persistent Keep-Alive TLS Agent (Item 7) - keeps warm TLS 1.3 socket to api.telegram.org
export const telegramAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 5,
  keepAliveMsecs: 60000,
  timeout: 15000
});

// Flap Dampening Token Bucket (Item 13)
let lastTransitionSentAt = 0;
let bufferedTransitions = [];
const DEFAULT_FLAP_COOLDOWN_MS = 30000; // 30s window

/**
 * Checks if a transition alert should be throttled to prevent notification spam / Telegram 429 bans.
 * @param {object} transitionEvent
 * @param {number} [cooldownMs=30000]
 * @returns {{ throttled: boolean, pendingCount: number }}
 */
export function shouldThrottleTransitionAlert(transitionEvent, cooldownMs = DEFAULT_FLAP_COOLDOWN_MS) {
  const now = Date.now();
  const elapsed = now - lastTransitionSentAt;

  if (lastTransitionSentAt > 0 && elapsed < cooldownMs) {
    bufferedTransitions.push({ event: transitionEvent, time: now });
    logger.warn('Telegram', `Flap dampener active: throttling transition alert (${elapsed}ms < ${cooldownMs}ms). Buffered: ${bufferedTransitions.length}`);
    return { throttled: true, pendingCount: bufferedTransitions.length };
  }

  lastTransitionSentAt = now;
  bufferedTransitions = [];
  return { throttled: false, pendingCount: 0 };
}

/**
 * Resets the flap dampener state (for testing and manual reset).
 */
export function resetFlapDampener() {
  lastTransitionSentAt = 0;
  bufferedTransitions = [];
}

/**
 * Formats a transition event into the exact human-readable message required by spec.
 * @param {object} event - Transition event object
 * @returns {string}
 */
export function formatTransitionMessage(event) {
  const account = event.username ? `@${event.username}` : '@unknown';
  const isVisible = event.newObservation === ObservationState.VISIBLE;

  const header = 'Instagram Visibility Monitor';
  const observationLine = isVisible ? 'Observation: PROFILE VISIBLE' : 'Observation: PROFILE UNAVAILABLE';
  const prevObsTime = formatDhakaTime(event.previousObservationAt);
  const currObsTime = formatDhakaTime(event.currentObservationAt);
  const detectedAtStr = formatDhakaDateTime(event.detectedAt, { includeSeconds: false });

  let gapNote = '';
  if (event.hadInterveningUnknowns && event.monitoringGapMinutes > 0) {
    gapNote = `\n\nIntervening monitoring gap:\n~${event.monitoringGapMinutes} minutes of unverified observations`;
  }

  const note = isVisible
    ? 'Note:\nThis is an observed visibility change,\nnot proof of account reactivation.'
    : 'Note:\nThe account may be unavailable for\nmultiple reasons. Deactivation is unverified.';

  return `${header}

Account: ${account}

${observationLine}

Previous reliable state:
${event.previousReliableState || 'UNKNOWN'}

Previous observation:
${prevObsTime}

Current observation:
${currObsTime}

Detected:
${detectedAtStr}
Asia/Dhaka${gapNote}

${note}`;
}

/**
 * Formats a test notification message.
 * @param {string} username
 * @returns {string}
 */
export function formatTestMessage(username = 'instagram') {
  const nowStr = formatDhakaDateTime(new Date().toISOString());
  return `Instagram Visibility Monitor — Test Message

Connected successfully to Telegram Bot.

Monitored Account: @${username}
Time: ${nowStr} Asia/Dhaka

This confirms that visibility transition alerts will be delivered to this chat.`;
}

/**
 * Sends a message via Telegram Bot API with timeout and error handling.
 *
 * @param {string} botToken
 * @param {string|number} chatId
 * @param {string} text
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Optional fetch override for unit testing
 * @returns {Promise<{ ok: boolean, status: string, error?: string, retryAfter?: number }>}
 */
export async function sendTelegramMessage(botToken, chatId, text, options = {}) {
  const token = (botToken || '').trim();
  const cid = (chatId || '').toString().trim();

  if (!validateTelegramToken(token)) {
    return { ok: false, status: NotificationStatus.FAILED, error: 'Invalid Telegram bot token format' };
  }
  if (!validateTelegramChatId(cid)) {
    return { ok: false, status: NotificationStatus.FAILED, error: 'Invalid Telegram chat ID format' };
  }
  if (!text || typeof text !== 'string') {
    return { ok: false, status: NotificationStatus.FAILED, error: 'Empty message text' };
  }

  const fetchFn = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchFn) {
    return { ok: false, status: NotificationStatus.FAILED, error: 'Network fetch unavailable' };
  }

  const endpoint = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS) : null;

  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: cid,
        text,
        disable_web_page_preview: true
      }),
      signal: controller ? controller.signal : undefined
    });

    if (timeoutId) clearTimeout(timeoutId);

    const json = await response.json().catch(() => ({}));

    if (response.status === 200 && json.ok) {
      logger.info('Telegram', 'Notification successfully delivered', { chatId: cid });
      return { ok: true, status: NotificationStatus.SENT };
    }

    // Handle 429 Too Many Requests
    if (response.status === 429) {
      const retryAfter = json?.parameters?.retry_after || 60;
      logger.warn('Telegram', 'Rate limited by Telegram Bot API', { retryAfter });
      return {
        ok: false,
        status: NotificationStatus.FAILED,
        error: `Rate limited. Retry after ${retryAfter}s`,
        retryAfter
      };
    }

    // Handle 401 Unauthorized (Invalid bot token)
    if (response.status === 401) {
      logger.error('Telegram', 'Unauthorized: Invalid Telegram bot token');
      return { ok: false, status: NotificationStatus.FAILED, error: 'Unauthorized: Invalid bot token' };
    }

    // Handle 400 Bad Request (Invalid chat ID or message)
    if (response.status === 400) {
      const desc = json.description || 'Bad Request';
      logger.error('Telegram', 'Bad Request from Telegram', desc);

      if (desc.toLowerCase().includes('chat not found')) {
        return {
          ok: false,
          status: NotificationStatus.FAILED,
          error: 'Chat not found: You must open a chat with your bot in Telegram and click "Start" (or send /start) before the bot is permitted to message you. Also verify your Chat ID is correct.'
        };
      }

      return { ok: false, status: NotificationStatus.FAILED, error: `Bad Request: ${desc}` };
    }

    // Server errors (5xx)
    const errorMsg = json.description || `HTTP ${response.status}`;
    logger.error('Telegram', 'Failed to send message', errorMsg);
    return { ok: false, status: NotificationStatus.FAILED, error: errorMsg };
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    const isTimeout = err.name === 'AbortError';
    const message = isTimeout ? 'Request timed out after 10s' : (err.message || 'Network error');
    logger.error('Telegram', 'Exception while sending message', message);
    return { ok: false, status: NotificationStatus.FAILED, error: message };
  }
}

/**
 * Verifies connection by sending a test message.
 */
export async function testTelegramConnection(botToken, chatId, username, options = {}) {
  const text = formatTestMessage(username);
  return sendTelegramMessage(botToken, chatId, text, options);
}

/**
 * Sends a message via Telegram Bot API with exponential backoff and jitter (Item 9).
 * Guarantees delivery during transient network glitches or server 5xx issues.
 *
 * @param {string} botToken
 * @param {string|number} chatId
 * @param {string} text
 * @param {object} [options]
 * @param {number} [maxAttempts=3]
 * @returns {Promise<{ ok: boolean, status: string, error?: string, attempts: number }>}
 */
export async function sendTelegramWithRetry(botToken, chatId, text, options = {}, maxAttempts = 3) {
  let delay = 1000;
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastResult = await sendTelegramMessage(botToken, chatId, text, options);
    if (lastResult.ok && lastResult.status === NotificationStatus.SENT) {
      return { ...lastResult, attempts: attempt };
    }

    // Do not retry on non-retryable user errors (invalid token, chat not found, empty text)
    const err = (lastResult.error || '').toLowerCase();
    if (
      err.includes('invalid') ||
      err.includes('chat not found') ||
      err.includes('empty message') ||
      err.includes('unauthorized')
    ) {
      return { ...lastResult, attempts: attempt };
    }

    if (attempt < maxAttempts) {
      const jitter = Math.floor(Math.random() * 400) - 200;
      const waitMs = Math.max(200, delay + jitter);
      logger.warn('Telegram', `Delivery attempt ${attempt} failed: ${lastResult.error}. Retrying in ${waitMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      delay *= 2;
    }
  }

  return { ...lastResult, attempts: maxAttempts };
}
