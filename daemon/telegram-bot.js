/**
 * Interactive Two-Way Telegram Bot & Silent Degradation Sentry
 *
 * Implements:
 * - Two-way command long-polling (/status, /check, /target, /pause, /resume, /help)
 * - Strict chat ID authorization guard (discards unauthorized senders)
 * - Silent degradation watchdog (alerts when 5 consecutive checks fail/return UNKNOWN)
 * - Clean lifecycle startup and graceful shutdown
 */

import { ObservationState } from '../lib/constants.js';
import { normalizeUsername, validateUsername, buildProfileUrl } from '../lib/validation.js';
import { formatDhakaDateTime, formatDhakaTime } from '../lib/timestamps.js';
import { sendTelegramMessage } from '../lib/telegram.js';
import { logger } from '../lib/logger.js';
import { loadDaemonConfig, saveDaemonConfig } from './config.js';
import { getDaemonState } from './storage.js';
import { reschedule, pauseMonitoring, resumeMonitoring } from './scheduler.js';

let botPollingActive = false;
let abortController = null;
let lastUpdateId = 0;

// Silent degradation tracking state
let consecutiveUnknownCount = 0;
let streakAlertSent = false;

/**
 * Resets the silent degradation tracker (used in tests and on state reset).
 */
export function resetDegradationTracker() {
  consecutiveUnknownCount = 0;
  streakAlertSent = false;
}

/**
 * Checks whether sender chat ID matches the authorized Telegram chat ID.
 *
 * @param {string|number} senderChatId
 * @param {string|number} authorizedChatId
 * @returns {boolean}
 */
export function isAuthorizedChatId(senderChatId, authorizedChatId) {
  if (!senderChatId || !authorizedChatId) return false;
  return String(senderChatId).trim() === String(authorizedChatId).trim();
}

/**
 * Parses incoming Telegram message text into command and argument.
 *
 * @param {string} [text]
 * @returns {{ command: string, arg: string }|null}
 */
export function parseTelegramCommand(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;

  const parts = trimmed.slice(1).split(/\s+/);
  const rawCmd = parts[0].toLowerCase().split('@')[0]; // Strip bot mention e.g. /status@MyBot
  let arg = parts.slice(1).join(' ').trim();

  // Strip leading @ from username if passed as argument (e.g. /target @username)
  if (rawCmd === 'target' && arg.startsWith('@')) {
    arg = arg.slice(1).trim();
  }

  const supported = ['status', 'check', 'target', 'pause', 'resume', 'help', 'start'];
  const command = supported.includes(rawCmd) ? rawCmd : 'unknown';

  return { command, arg };
}

/**
 * Evaluates silent degradation: triggers alert if UNKNOWN checks hit threshold.
 *
 * @param {object} observation
 * @param {object} [options]
 * @param {number} [options.threshold=5]
 * @returns {{ shouldAlert: boolean, consecutiveCount: number, message?: string }}
 */
export function checkSilentDegradation(observation, options = {}) {
  const threshold = options.threshold || 5;

  if (observation.state === ObservationState.UNKNOWN) {
    consecutiveUnknownCount++;

    if (consecutiveUnknownCount >= threshold && !streakAlertSent) {
      streakAlertSent = true;
      const reason = observation.reason || 'Unrecognized HTML structure or authentication checkpoint';
      const message = `⚠️ <b>Instagram Monitor Alert: Monitoring Blinded</b>\n\n` +
        `<b>${consecutiveUnknownCount} consecutive checks</b> returned UNKNOWN.\n\n` +
        `• Reason: ${reason}\n` +
        `• Confidence: ${observation.confidence || 'LOW'}\n\n` +
        `<i>The system cannot reliably observe the target profile. Check network connectivity or import a fresh secondary Instagram session via CLI.</i>`;

      return {
        shouldAlert: true,
        consecutiveCount: consecutiveUnknownCount,
        message
      };
    }

    return {
      shouldAlert: false,
      consecutiveCount: consecutiveUnknownCount
    };
  }

  // Reliable state reached (VISIBLE or UNAVAILABLE) -> reset streak
  consecutiveUnknownCount = 0;
  streakAlertSent = false;
  return {
    shouldAlert: false,
    consecutiveCount: 0
  };
}

/**
 * Executes a parsed Telegram command and produces an HTML response message.
 *
 * @param {string} command
 * @param {string} arg
 * @returns {Promise<string>}
 */
export async function executeTelegramCommand(command, arg) {
  const config = loadDaemonConfig();
  const state = getDaemonState();

  switch (command) {
    case 'start':
    case 'help':
      return `🤖 <b>Instagram Profile Visibility Monitor</b>\n\n` +
        `<b>Available Commands:</b>\n` +
        `• <code>/status</code> — View real-time observation status & telemetry\n` +
        `• <code>/check</code> — Trigger an immediate observation cycle\n` +
        `• <code>/target &lt;username&gt;</code> — Change monitored target profile\n` +
        `• <code>/pause</code> — Pause background monitoring\n` +
        `• <code>/resume</code> — Resume background monitoring\n` +
        `• <code>/help</code> — Display this guide`;

    case 'status': {
      const target = config.targetUsername;
      const obs = state.currentObservation || 'UNKNOWN';
      const mode = config.scheduleMode || 'FIXED';
      const lastCheck = state.lastAttemptAt ? formatDhakaDateTime(state.lastAttemptAt, { includeSeconds: true }) : '—';
      const nextCheck = state.nextScheduledCheckAt ? formatDhakaTime(state.nextScheduledCheckAt) : '—';
      const memRss = Math.round(process.memoryUsage().rss / (1024 * 1024));
      const uptimeSec = Math.round(process.uptime());

      return `📊 <b>System Telemetry & Status</b>\n\n` +
        `• <b>Target:</b> @${target}\n` +
        `• <b>Observed State:</b> <code>${obs}</code>\n` +
        `• <b>Schedule Mode:</b> ${mode}\n` +
        `• <b>Last Check:</b> ${lastCheck}\n` +
        `• <b>Next Check:</b> ${nextCheck}\n` +
        `• <b>Memory RSS:</b> ${memRss} MB\n` +
        `• <b>Uptime:</b> ${uptimeSec}s`;
    }

    case 'check':
      reschedule(config);
      return `🔄 <b>Observation Check Triggered</b>\n\nScheduled check execution immediately. Status will update on completion.`;

    case 'target': {
      if (!arg) {
        return `⚠️ <b>Missing Handle</b>\n\nUsage: <code>/target &lt;username&gt;</code>\nExample: <code>/target cristiano</code>`;
      }
      const clean = normalizeUsername(arg);
      if (!clean || !validateUsername(clean)) {
        return `❌ <b>Invalid Handle</b>\n\nHandle must be 1-30 characters using letters, numbers, periods, or underscores without starting, ending, or consecutive periods.`;
      }

      saveDaemonConfig({
        targetUsername: clean,
        targetUrl: buildProfileUrl(clean)
      });
      reschedule(loadDaemonConfig());
      return `✓ <b>Target Profile Updated</b>\n\nNow monitoring: @${clean}\nBaseline will be initialized on next observation.`;
    }

    case 'pause':
      pauseMonitoring();
      return `⏸️ <b>Monitoring Paused</b>\n\nObservation checks are temporarily suspended. Send <code>/resume</code> to continue.`;

    case 'resume':
      resumeMonitoring();
      return `▶️ <b>Monitoring Resumed</b>\n\nObservation schedule is now active.`;

    default:
      return `❓ <b>Unrecognized Command</b>\n\nSend <code>/help</code> to see available commands.`;
  }
}

/**
 * Starts long-polling Telegram Bot API listener.
 *
 * @param {object} [options]
 * @param {string} [options.token]
 * @param {string} [options.chatId]
 */
export async function startTelegramBot(options = {}) {
  const config = loadDaemonConfig();
  const token = options.token || config.telegramBotToken;
  const chatId = options.chatId || config.telegramChatId;

  if (!token || !chatId) {
    logger.debug('TelegramBot', 'Skipping Telegram bot polling: missing token or chatId');
    return;
  }

  if (botPollingActive) {
    logger.debug('TelegramBot', 'Telegram bot polling is already active');
    return;
  }

  botPollingActive = true;
  abortController = new AbortController();
  logger.info('TelegramBot', `Starting two-way Telegram command listener for chat ID: ${chatId}`);

  // Background polling loop
  (async () => {
    while (botPollingActive) {
      try {
        const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=15&allowed_updates=["message"]`;
        const res = await fetch(url, {
          signal: abortController.signal
        });

        if (!res.ok) {
          if (res.status === 409) {
            // Another instance is polling
            logger.warn('TelegramBot', 'Telegram 409 Conflict: Another instance is polling getUpdates. Backing off 10s...');
            await new Promise((r) => setTimeout(r, 10000));
            continue;
          }
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            lastUpdateId = Math.max(lastUpdateId, update.update_id);

            const msg = update.message;
            if (msg && msg.text && isAuthorizedChatId(msg.chat?.id, chatId)) {
              const parsed = parseTelegramCommand(msg.text);
              if (parsed) {
                logger.info('TelegramBot', `Received command /${parsed.command} from authorized chat ${chatId}`);
                const reply = await executeTelegramCommand(parsed.command, parsed.arg);
                await sendTelegramMessage(token, chatId, reply).catch((err) => {
                  logger.warn('TelegramBot', `Failed to send reply to /${parsed.command}`, err.message);
                });
              }
            }
          }
        }
      } catch (err) {
        if (err.name === 'AbortError' || !botPollingActive) {
          break;
        }
        logger.warn('TelegramBot', `Polling exception: ${err.message}. Retrying in 5s...`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    logger.info('TelegramBot', 'Telegram command listener stopped');
  })();
}

/**
 * Stops the active Telegram command polling loop cleanly.
 */
export function stopTelegramBot() {
  botPollingActive = false;
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
}
