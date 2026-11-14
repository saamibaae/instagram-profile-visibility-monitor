/**
 * Production-Hardened Daemon Scheduler Engine
 * Supports Fixed Interval (3-60 min) and Random Range (60-180 sec) modes,
 * concurrency-safe live configuration reload, session health tracking,
 * and Telegram transition alerts.
 */

import { performance } from 'node:perf_hooks';
import { execSync } from 'node:child_process';
import {
  MonitoringStatus,
  NotificationStatus,
  ScheduleMode,
  SessionHealth,
  AuditEventType,
  ObservationState,
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_RANDOM_MIN_SECONDS,
  DEFAULT_RANDOM_MAX_SECONDS
} from '../lib/constants.js';
import { processObservation } from '../lib/state-machine.js';
import {
  sendTelegramMessage,
  sendTelegramWithRetry,
  formatTransitionMessage,
  shouldThrottleTransitionAlert
} from '../lib/telegram.js';
import { logger } from '../lib/logger.js';
import { loadDaemonConfig } from './config.js';
import {
  acquireDaemonLock,
  releaseDaemonLock,
  touchDaemonLock,
  getDaemonState,
  saveDaemonState,
  appendDaemonEvent,
  recordDaemonEventInMemory,
  appendDaemonAuditEvent,
  rotateDaemonLog,
  pruneDaemonEventsOlderThanWindow,
  pruneExpiredDailyPartitions
} from './storage.js';
import { getOrLaunchBrowser, closeBrowser } from './browser.js';
import { observeProfileWithPage } from './observer.js';
import { evaluateHttpFastPath } from './http-fastpath.js';
import {
  pollDaemonCommand,
  acknowledgeDaemonCommand,
  cleanupIpcFiles
} from './ipc.js';
import {
  startTelegramBot,
  stopTelegramBot,
  checkSilentDegradation
} from './telegram-bot.js';

let isRunning = false;
let isPaused = false;
let checkTimer = null;
let activeIpcPollTimer = null;
let inFlightCheck = false;
let rngSource = Math.random;
let activeConfigRevision = 1;
let lastDiskEventWrittenAt = 0;
let lastMaintenanceMs = 0;
let cachedPowerState = null;
let lastPowerCheckMs = 0;

/**
 * Adaptive Battery Sentry (Item 15)
 * Queries Windows/Linux power state to determine if running on discharging battery.
 * Cached for 60 seconds to eliminate command overhead.
 * @param {boolean} [forceRefresh=false]
 * @returns {{ onBattery: boolean }}
 */
export function getSystemPowerState(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedPowerState && (now - lastPowerCheckMs < 60000)) {
    return cachedPowerState;
  }
  let onBattery = false;
  if (process.platform === 'win32') {
    try {
      const out = execSync('powershell.exe -NoProfile -Command "(Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue).BatteryStatus"', {
        timeout: 2000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      onBattery = (out === '1');
    } catch {
      onBattery = false;
    }
  }
  cachedPowerState = { onBattery };
  lastPowerCheckMs = now;
  return cachedPowerState;
}

/**
 * Injects a custom RNG source for deterministic testing.
 * @param {Function} [customRng] - Function returning number in [0, 1)
 */
export function setSchedulerRngSource(customRng = Math.random) {
  rngSource = typeof customRng === 'function' ? customRng : Math.random;
}

/**
 * Calculates the next schedule delay in milliseconds according to active mode.
 *
 * @param {object} config
 * @param {Function} [rng=rngSource]
 * @returns {{ delayMs: number, delaySeconds: number, scheduleMode: string }}
 */
export function calculateNextDelayMs(config, rng = rngSource) {
  // Adaptive Battery Sentry (Item 15)
  if (config?.batterySaver === true) {
    const power = getSystemPowerState();
    if (power.onBattery) {
      const batteryIntervalSeconds = Math.max(300, config.batterySaverIntervalSeconds || 300);
      return {
        delayMs: batteryIntervalSeconds * 1000,
        delaySeconds: batteryIntervalSeconds,
        scheduleMode: 'BATTERY_SAVER'
      };
    }
  }

  const mode = config.scheduleMode || ScheduleMode.FIXED;

  if (mode === ScheduleMode.RANDOM_RANGE) {
    const minSec = typeof config.randomMinSeconds === 'number' ? config.randomMinSeconds : DEFAULT_RANDOM_MIN_SECONDS;
    const maxSec = typeof config.randomMaxSeconds === 'number' ? config.randomMaxSeconds : DEFAULT_RANDOM_MAX_SECONDS;
    const clampedMin = Math.max(60, Math.min(180, minSec));
    const clampedMax = Math.max(clampedMin, Math.min(180, maxSec));

    const delaySeconds = Math.floor(rng() * (clampedMax - clampedMin + 1)) + clampedMin;
    return {
      delayMs: delaySeconds * 1000,
      delaySeconds,
      scheduleMode: ScheduleMode.RANDOM_RANGE
    };
  }

  // FIXED Mode: whole minutes between 3 and 60
  const minutes = typeof config.fixedIntervalMinutes === 'number'
    ? config.fixedIntervalMinutes
    : (typeof config.intervalMinutes === 'number' ? config.intervalMinutes : DEFAULT_INTERVAL_MINUTES);
  const clampedMinutes = Math.max(3, Math.min(60, minutes));
  const delaySeconds = clampedMinutes * 60;

  return {
    delayMs: delaySeconds * 1000,
    delaySeconds,
    scheduleMode: ScheduleMode.FIXED
  };
}

/**
 * Runs a single observation check iteration.
 *
 * @param {object} config
 * @returns {Promise<object>}
 */
export async function runObservationCycle(config = loadDaemonConfig()) {
  if (inFlightCheck) {
    logger.warn('DaemonScheduler', 'Previous check in-flight, skipping concurrent run');
    return { skipped: true, reason: 'CONCURRENT_CHECK_IN_FLIGHT' };
  }

  inFlightCheck = true;
  const cycleStartWall = new Date().toISOString();
  const cycleStartMono = performance.now();
  const activeConfig = { ...loadDaemonConfig(), ...(config || {}) };
  const targetAtStart = activeConfig.targetUsername;
  const revisionAtStart = activeConfigRevision;
  let browserUsed = false;

  try {
    const currentState = getDaemonState();
    saveDaemonState({
      lastAttemptAt: cycleStartWall,
      activeCheckId: `chk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    });

    // 1. Observation execution: HTTP-First Fast Path (Item 11) with ephemeral browser fallback
    let observation = null;
    let checkDurationMs = 0;

    if (activeConfig.fastPath !== false) {
      try {
        const fastResult = await evaluateHttpFastPath(activeConfig);
        if (fastResult && !fastResult.fallbackRequired && fastResult.observation) {
          observation = fastResult.observation;
          checkDurationMs = fastResult.checkDurationMs;
        }
      } catch (fastErr) {
        logger.debug('DaemonScheduler', `Fast-path evaluation skipped: ${fastErr.message}`);
      }
    }

    if (!observation) {
      browserUsed = true;
      const { page } = await getOrLaunchBrowser({
        headless: activeConfig.headless !== false,
        userDataDir: activeConfig.browserProfileDir
      });

      const browserRes = await observeProfileWithPage(
        page,
        activeConfig.targetUrl,
        activeConfig.targetUsername
      );
      observation = browserRes.observation;
      checkDurationMs = browserRes.checkDurationMs;
    }

    // 3. Concurrency check: verify target was not changed during in-flight observation
    const latestConfig = loadDaemonConfig();
    if (latestConfig.targetUsername !== targetAtStart || activeConfigRevision !== revisionAtStart) {
      logger.warn('DaemonScheduler', `Target was switched to @${latestConfig.targetUsername} during check of @${targetAtStart}; discarding stale observation.`);
      return { skipped: true, reason: 'TARGET_CHANGED_DURING_CHECK' };
    }

    // 4. Session health evaluation
    let sessionHealth = SessionHealth.OK;
    const reasonLower = (observation.reason || '').toLowerCase();
    if (reasonLower.includes('challenge') || reasonLower.includes('checkpoint')) {
      sessionHealth = SessionHealth.CHALLENGED;
      appendDaemonAuditEvent(AuditEventType.AUTH_REQUIRED, {
        reason: observation.reason,
        account: targetAtStart
      });
    } else if (reasonLower.includes('login') || reasonLower.includes('redirected to accounts/login')) {
      sessionHealth = SessionHealth.AUTH_REQUIRED;
      appendDaemonAuditEvent(AuditEventType.AUTH_REQUIRED, {
        reason: 'Session expired or redirected to login',
        account: targetAtStart
      });
    } else if (reasonLower.includes('rate limit') || reasonLower.includes('please wait a few minutes')) {
      sessionHealth = SessionHealth.RATE_LIMITED;
      appendDaemonAuditEvent(AuditEventType.ACCESS_RESTRICTED, {
        reason: observation.reason,
        account: targetAtStart
      });
    }

    // 5. Process observation through pure state machine (Rules A - I)
    const evaluation = processObservation(currentState, observation);

    // Item 10: Proactive Session Expiry / Challenge Alert
    if (
      (sessionHealth === SessionHealth.AUTH_REQUIRED || sessionHealth === SessionHealth.CHALLENGED) &&
      currentState.sessionHealth === SessionHealth.OK
    ) {
      if (latestConfig.telegramNotificationsEnabled && latestConfig.telegramBotToken && latestConfig.telegramChatId) {
        const alertMsg = `⚠️ <b>Instagram Monitor Alert</b>\n\nSession challenge or login required for account @${targetAtStart}.\nReason: ${observation.reason}\nPlease run "npm run login" if using authenticated mode.`;
        sendTelegramWithRetry(latestConfig.telegramBotToken, latestConfig.telegramChatId, alertMsg).catch(() => {});
      }
    }

    // Silent Degradation Sentry: alerts if consecutive UNKNOWN checks reach threshold
    const degradation = checkSilentDegradation(observation, {
      threshold: latestConfig.consecutiveUnknownThreshold || 5
    });
    if (degradation.shouldAlert && latestConfig.telegramNotificationsEnabled && latestConfig.telegramBotToken && latestConfig.telegramChatId) {
      sendTelegramWithRetry(latestConfig.telegramBotToken, latestConfig.telegramChatId, degradation.message).catch(() => {});
    }

    // 6. Calculate next delay
    const { delayMs, delaySeconds, scheduleMode } = calculateNextDelayMs(latestConfig);
    const nextScheduledCheckAt = new Date(Date.now() + delayMs).toISOString();

    // 7. Update daemon state
    saveDaemonState({
      ...evaluation.nextState,
      nextScheduledCheckAt,
      lastScheduledDelayMs: delayMs,
      activeScheduleMode: scheduleMode,
      sessionHealth,
      lastSuccessfulCheckAt: (evaluation.isTransition || !evaluation.isBaseline)
        ? observation.observedAt
        : currentState.lastSuccessfulCheckAt,
      activeCheckId: null
    });

    // 8. Handle Telegram transition alert (Items 9 & 13)
    let notificationStatus = NotificationStatus.SKIPPED;

    if (evaluation.isTransition && evaluation.transitionEvent) {
      logger.info('DaemonScheduler', 'Visibility transition detected!', evaluation.transitionEvent);

      if (latestConfig.telegramNotificationsEnabled && latestConfig.telegramBotToken && latestConfig.telegramChatId) {
        const throttleCheck = shouldThrottleTransitionAlert(evaluation.transitionEvent);
        if (throttleCheck.throttled) {
          logger.warn('DaemonScheduler', `Telegram alert throttled by flap dampener (${throttleCheck.pendingCount} pending)`);
          notificationStatus = NotificationStatus.SKIPPED;
        } else {
          const text = formatTransitionMessage(evaluation.transitionEvent);
          const sendRes = await sendTelegramWithRetry(
            latestConfig.telegramBotToken,
            latestConfig.telegramChatId,
            text
          );
          notificationStatus = sendRes.status;
        }
      }
    }

    // 9. Append event record (Transitions, baselines, unknowns, or hourly heartbeats persist to disk)
    const isBaseline = Boolean(evaluation.isBaseline);
    const isTransition = Boolean(evaluation.isTransition);
    const isUnknown = observation.state === ObservationState.UNKNOWN;
    const timeSinceLastDiskWrite = Date.now() - lastDiskEventWrittenAt;
    const shouldPersistToDisk = isTransition || isBaseline || isUnknown || timeSinceLastDiskWrite >= (60 * 60 * 1000) || activeConfig.persistEveryCheck === true;

    const eventPayload = {
      username: latestConfig.targetUsername,
      observedState: observation.state,
      previousReliableState: evaluation.nextState.previousReliableState,
      confidence: observation.confidence,
      reason: observation.reason,
      checkDurationMs,
      isTransition: evaluation.isTransition,
      notificationStatus
    };

    let eventRecord = null;
    if (shouldPersistToDisk) {
      eventRecord = appendDaemonEvent(eventPayload);
      lastDiskEventWrittenAt = Date.now();
    } else {
      eventRecord = recordDaemonEventInMemory(eventPayload);
    }

    // Check log rotation and prune events once per 24 hours rather than every check (Item 19)
    const nowMs = Date.now();
    if (nowMs - lastMaintenanceMs > 24 * 60 * 60 * 1000) {
      lastMaintenanceMs = nowMs;
      rotateDaemonLog();
      pruneDaemonEventsOlderThanWindow(undefined, 24);
      pruneExpiredDailyPartitions();
    }

    return {
      observation,
      evaluation,
      eventRecord,
      checkDurationMs,
      sessionHealth,
      nextScheduledCheckAt
    };
  } catch (err) {
    logger.error('DaemonScheduler', 'Exception during observation cycle', err.message);
    saveDaemonState({
      sessionHealth: SessionHealth.UNKNOWN,
      interruptionReason: err.message,
      activeCheckId: null
    });
    return { error: err.message };
  } finally {
    inFlightCheck = false;
    // Ephemeral Browser Lifecycle:
    // Close browser immediately after check to free ~850MB of RAM and stop SSD profile cache writes
    if (browserUsed && activeConfig.ephemeralBrowser !== false) {
      await closeBrowser().catch(() => {});
    }
    // Touch atomic lock (Item 14)
    touchDaemonLock();
    // Explicit V8 Heap Compaction (Item 18)
    if (typeof global.gc === 'function') {
      try {
        global.gc();
      } catch {}
    }
  }
}

/**
 * Reschedules the pending observation timer with new configuration.
 * Cancels obsolete deadlines without interrupting an in-flight check.
 *
 * @param {object} [newConfig]
 * @returns {{ nextScheduledCheckAt: string, delaySeconds: number, scheduleMode: string }}
 */
export function reschedule(newConfig = loadDaemonConfig()) {
  activeConfigRevision++;

  if (checkTimer) {
    clearTimeout(checkTimer);
    checkTimer = null;
  }

  if (!isRunning || isPaused) {
    saveDaemonState({ nextScheduledCheckAt: null });
    return { nextScheduledCheckAt: null, delaySeconds: 0, scheduleMode: newConfig.scheduleMode };
  }

  const { delayMs, delaySeconds, scheduleMode } = calculateNextDelayMs(newConfig);
  const nextScheduledCheckAt = new Date(Date.now() + delayMs).toISOString();

  saveDaemonState({
    nextScheduledCheckAt,
    lastScheduledDelayMs: delayMs,
    activeScheduleMode: scheduleMode
  });

  logger.info('DaemonScheduler', `Rescheduled next check deadline to ${nextScheduledCheckAt} (in ${delaySeconds}s, mode: ${scheduleMode})`);

  checkTimer = setTimeout(async () => {
    const currentConfig = loadDaemonConfig();
    await runObservationCycle(currentConfig);
    reschedule(currentConfig);
  }, delayMs);

  return { nextScheduledCheckAt, delaySeconds, scheduleMode };
}

/**
 * Pauses monitoring.
 * @param {string} [reason='User requested pause']
 */
export function pauseMonitoring(reason = 'User requested pause') {
  if (!isRunning || isPaused) return;
  isPaused = true;
  if (checkTimer) {
    clearTimeout(checkTimer);
    checkTimer = null;
  }
  saveDaemonState({
    monitoringStatus: MonitoringStatus.PAUSED,
    interruptionReason: reason,
    nextScheduledCheckAt: null
  });
  appendDaemonAuditEvent(AuditEventType.MONITORING_PAUSED, { reason });
  logger.info('DaemonScheduler', `Monitoring paused: ${reason}`);
}

/**
 * Resumes monitoring from paused state.
 */
export function resumeMonitoring() {
  if (!isRunning || !isPaused) return;
  isPaused = false;
  saveDaemonState({
    monitoringStatus: MonitoringStatus.RUNNING,
    interruptionReason: null
  });
  appendDaemonAuditEvent(AuditEventType.MONITORING_RESUMED, {});
  logger.info('DaemonScheduler', 'Monitoring resumed');
  reschedule(loadDaemonConfig());
}

/**
 * Returns current scheduler operational metrics.
 * @returns {object}
 */
export function getSchedulerStatus() {
  const state = getDaemonState();
  const memory = process.memoryUsage();
  return {
    isRunning,
    isPaused,
    inFlightCheck,
    activeConfigRevision,
    uptimeSeconds: Math.floor(process.uptime()),
    memoryRssMb: Math.round((memory.rss / (1024 * 1024)) * 10) / 10,
    memoryHeapMb: Math.round((memory.heapUsed / (1024 * 1024)) * 10) / 10,
    sessionHealth: state.sessionHealth || SessionHealth.OK,
    lastScheduledDelayMs: state.lastScheduledDelayMs || 0,
    nextScheduledCheckAt: state.nextScheduledCheckAt || null,
    activeScheduleMode: state.activeScheduleMode || ScheduleMode.FIXED
  };
}

/**
 * Starts the continuous daemon monitoring loop.
 *
 * @param {object} [options]
 * @param {boolean} [options.singleRun=false] - For testing or one-off checks
 */
export async function startDaemon(options = {}) {
  const config = loadDaemonConfig();

  // 1. Acquire process lock
  acquireDaemonLock(process.pid);
  cleanupIpcFiles();

  logger.info('DaemonScheduler', `Starting daemon for @${config.targetUsername} (PID: ${process.pid}, Mode: ${config.scheduleMode})`);

  saveDaemonState({
    monitoringStatus: MonitoringStatus.RUNNING,
    currentAccount: config.targetUsername,
    activeScheduleMode: config.scheduleMode,
    sessionHealth: SessionHealth.OK,
    interruptionReason: null
  });

  appendDaemonAuditEvent(AuditEventType.MONITORING_STARTED, {
    pid: process.pid,
    targetUsername: config.targetUsername,
    scheduleMode: config.scheduleMode
  });

  isRunning = true;
  isPaused = false;
  let isProcessingIpc = false;

  // Setup graceful termination handlers
  const cleanupAndExit = async (signal) => {
    logger.info('DaemonScheduler', `Received ${signal}, shutting down gracefully...`);
    isRunning = false;
    isPaused = false;
    if (checkTimer) clearTimeout(checkTimer);
    if (activeIpcPollTimer) {
      clearInterval(activeIpcPollTimer);
      activeIpcPollTimer = null;
    }
    cleanupIpcFiles();

    await closeBrowser();
    saveDaemonState({
      monitoringStatus: MonitoringStatus.STOPPED,
      nextScheduledCheckAt: null
    });
    appendDaemonAuditEvent(AuditEventType.MONITORING_STOPPED, { signal });
    releaseDaemonLock();
    process.exit(0);
  };

  if (options.registerSignalHandlers !== false) {
    process.once('SIGINT', () => cleanupAndExit('SIGINT'));
    process.once('SIGTERM', () => cleanupAndExit('SIGTERM'));
  }

  // Start IPC command polling if running continuously
  if (!options.singleRun) {
    activeIpcPollTimer = setInterval(async () => {
      if (!isRunning || isProcessingIpc) return;
      const cmd = pollDaemonCommand();
      if (!cmd) return;

      isProcessingIpc = true;
      try {
        logger.info('DaemonScheduler', `Processing IPC command: ${cmd.command} (ID: ${cmd.id})`);
        if (cmd.command === 'CHECK_NOW' || cmd.command === 'SWITCH_TARGET') {
          if (checkTimer) {
            clearTimeout(checkTimer);
            checkTimer = null;
          }
          const freshConfig = loadDaemonConfig();
          const cycleRes = await runObservationCycle(freshConfig);
          reschedule(freshConfig);
          acknowledgeDaemonCommand(cmd.id, cycleRes);
        } else if (cmd.command === 'RESCHEDULE') {
          const freshConfig = loadDaemonConfig();
          const reschedRes = reschedule(freshConfig);
          acknowledgeDaemonCommand(cmd.id, reschedRes);
        } else if (cmd.command === 'PAUSE') {
          pauseMonitoring(cmd.payload?.reason);
          acknowledgeDaemonCommand(cmd.id, { success: true, monitoringStatus: MonitoringStatus.PAUSED });
        } else if (cmd.command === 'RESUME') {
          resumeMonitoring();
          acknowledgeDaemonCommand(cmd.id, { success: true, monitoringStatus: MonitoringStatus.RUNNING });
        } else if (cmd.command === 'STOP') {
          acknowledgeDaemonCommand(cmd.id, { success: true });
          if (activeIpcPollTimer) {
            clearInterval(activeIpcPollTimer);
            activeIpcPollTimer = null;
          }
          await cleanupAndExit('IPC_STOP');
        } else {
          acknowledgeDaemonCommand(cmd.id, { error: `Unknown command ${cmd.command}` });
        }
      } catch (err) {
        logger.error('DaemonScheduler', `Error handling IPC command ${cmd.command}`, err.message);
        acknowledgeDaemonCommand(cmd.id, { error: err.message });
      } finally {
        isProcessingIpc = false;
      }
    }, 400);
  }

  // 2. Perform initial baseline check
  await runObservationCycle(config);

  if (options.singleRun) {
    if (activeIpcPollTimer) {
      clearInterval(activeIpcPollTimer);
      activeIpcPollTimer = null;
    }
    cleanupIpcFiles();
    await closeBrowser();
    releaseDaemonLock();
    return;
  }

  // 3. Schedule next check
  reschedule(config);

  // 4. Start two-way Telegram command listener if configured
  if (config.telegramNotificationsEnabled && config.telegramBotToken && config.telegramChatId && config.telegramTwoWayEnabled !== false) {
    startTelegramBot().catch(() => {});
  }
}

/**
 * Stops the daemon monitoring loop cleanly in-process.
 */
export async function stopDaemon() {
  logger.info('DaemonScheduler', 'Stopping daemon monitoring loop...');
  isRunning = false;
  isPaused = false;
  stopTelegramBot();
  if (checkTimer) {
    clearTimeout(checkTimer);
    checkTimer = null;
  }
  if (activeIpcPollTimer) {
    clearInterval(activeIpcPollTimer);
    activeIpcPollTimer = null;
  }
  cleanupIpcFiles();
  await closeBrowser();
  saveDaemonState({
    monitoringStatus: MonitoringStatus.STOPPED,
    nextScheduledCheckAt: null
  });
  appendDaemonAuditEvent(AuditEventType.MONITORING_STOPPED, { reason: 'User requested stop' });
  releaseDaemonLock();
}

// Auto-run if executed directly as script (node daemon/scheduler.js)
const isMainScript = process.argv[1] && (
  process.argv[1].endsWith('scheduler.js') ||
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
);

if (isMainScript) {
  startDaemon().catch((err) => {
    logger.error('DaemonScheduler', 'Fatal startup error', err.message);
    releaseDaemonLock();
    process.exit(1);
  });
}
