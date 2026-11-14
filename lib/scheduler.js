/**
 * Scheduler and Tab Lifecycle Coordinator
 * Manages chrome.alarms, dedicated tab synchronization, and observation check execution.
 */

import {
  ALARM_NAME,
  CHECK_TIMEOUT_MS,
  DEFAULT_INTERVAL_MINUTES,
  MonitoringStatus,
  ObservationState,
  Confidence,
  NotificationStatus
} from './constants.js';
import {
  getConfig,
  saveConfig,
  getState,
  saveState,
  getActiveTabId,
  setActiveTabId,
  addHistoryEvent,
  getTelegramCredentials
} from './storage.js';
import { processObservation } from './state-machine.js';
import { classifyPageSnapshot } from './classifier.js';
import { sendTelegramMessage, formatTransitionMessage } from './telegram.js';
import { validateProfileUrl } from './validation.js';
import { logger } from './logger.js';

// Module-level guard against in-flight checks within the same execution context
let localInFlightCheck = false;

/**
 * Starts or restarts scheduled monitoring.
 * @param {number} [intervalMinutes]
 * @returns {Promise<object>}
 */
export async function startMonitoring(intervalMinutes, options = {}) {
  const config = await getConfig();
  const interval = intervalMinutes || config.intervalMinutes || DEFAULT_INTERVAL_MINUTES;

  await saveConfig({ monitoringEnabled: true, intervalMinutes: interval });

  const nextCheckTime = new Date(Date.now() + interval * 60000).toISOString();
  const updatedState = await saveState({
    monitoringStatus: MonitoringStatus.RUNNING,
    nextScheduledCheckAt: nextCheckTime,
    interruptionReason: null
  });

  // Schedule alarm in Chrome
  if (typeof chrome !== 'undefined' && chrome.alarms) {
    await new Promise((resolve) => {
      chrome.alarms.clear(ALARM_NAME, () => {
        chrome.alarms.create(ALARM_NAME, {
          delayInMinutes: interval,
          periodInMinutes: interval
        });
        resolve();
      });
    });
  }

  logger.info('Scheduler', `Monitoring started with ${interval}-minute interval`, { nextCheckTime });

  // Execute initial baseline observation asynchronously unless skipped
  if (!options.skipImmediateCheck) {
    performObservationCheck({ isManual: false }).catch((err) => {
      logger.error('Scheduler', 'Error in initial baseline check', err.message);
    });
  }

  return updatedState;
}

/**
 * Pauses monitoring without resetting state machine history.
 */
export async function pauseMonitoring(reason = null) {
  await saveConfig({ monitoringEnabled: false });

  if (typeof chrome !== 'undefined' && chrome.alarms) {
    await new Promise((resolve) => chrome.alarms.clear(ALARM_NAME, resolve));
  }

  const updatedState = await saveState({
    monitoringStatus: MonitoringStatus.PAUSED,
    nextScheduledCheckAt: null,
    interruptionReason: reason
  });

  logger.info('Scheduler', 'Monitoring paused', { reason });
  return updatedState;
}

/**
 * Completely stops monitoring and cancels scheduled alarms.
 */
export async function stopMonitoring() {
  await saveConfig({ monitoringEnabled: false });

  if (typeof chrome !== 'undefined' && chrome.alarms) {
    await new Promise((resolve) => chrome.alarms.clear(ALARM_NAME, resolve));
  }

  const updatedState = await saveState({
    monitoringStatus: MonitoringStatus.STOPPED,
    nextScheduledCheckAt: null,
    activeCheckId: null,
    interruptionReason: null
  });

  localInFlightCheck = false;
  logger.info('Scheduler', 'Monitoring stopped');
  return updatedState;
}

/**
 * Ensures a dedicated monitoring tab exists, is valid, and matches the target profile.
 * Avoids stealing user focus (active: false).
 * @param {string} targetUrl
 * @param {string} targetUsername
 * @returns {Promise<{ tab: object|null, error?: string }>}
 */
export async function resolveMonitoringTab(targetUrl, targetUsername) {
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    return { tab: null, error: 'Tabs API unavailable' };
  }

  const storedTabId = await getActiveTabId();

  if (storedTabId !== null) {
    try {
      const tab = await new Promise((resolve) => {
        chrome.tabs.get(storedTabId, (t) => {
          if (chrome.runtime.lastError || !t) {
            resolve(null);
          } else {
            resolve(t);
          }
        });
      });

      if (tab) {
        // Validate tab URL
        if (validateProfileUrl(tab.url, targetUsername)) {
          // If tab is discarded by Chrome memory saver, reload it
          if (tab.discarded) {
            await new Promise((resolve) => chrome.tabs.reload(tab.id, {}, resolve));
          }
          return { tab };
        }
        // Tab was navigated away
        logger.warn('Scheduler', 'Monitored tab navigated away from target URL', { currentUrl: tab.url });
      }
    } catch (e) {
      logger.warn('Scheduler', 'Failed to retrieve stored tab', e.message);
    }
  }

  // Search existing tabs for target URL
  const existingTabs = await new Promise((resolve) => {
    chrome.tabs.query({ url: '*://*.instagram.com/*' }, (tabs) => resolve(tabs || []));
  });

  for (const t of existingTabs) {
    if (validateProfileUrl(t.url, targetUsername)) {
      await setActiveTabId(t.id);
      logger.info('Scheduler', 'Reusing existing Instagram tab', { tabId: t.id });
      return { tab: t };
    }
  }

  // Create new background tab without stealing user focus
  const config = await getConfig();
  if (config.autoOpenTab) {
    const newTab = await new Promise((resolve) => {
      chrome.tabs.create({ url: targetUrl, active: false }, resolve);
    });
    if (newTab && newTab.id) {
      await setActiveTabId(newTab.id);
      logger.info('Scheduler', 'Created new dedicated background tab', { tabId: newTab.id });
      return { tab: newTab };
    }
  }

  return { tab: null, error: 'Dedicated monitoring tab not found and auto-create disabled' };
}

/**
 * Performs a single complete observation check.
 * Handles overlap prevention, timeouts, DOM classification, state machine update,
 * event recording, and notification delivery.
 *
 * @param {object} [options]
 * @param {boolean} [options.isManual=false]
 * @param {object} [options.mockSnapshot] - Optional snapshot override for testing
 * @returns {Promise<object>}
 */
export async function performObservationCheck(options = {}) {
  const { isManual = false, mockSnapshot = null } = options;
  const startTime = Date.now();
  const checkId = `chk_${startTime}_${Math.random().toString(36).slice(2, 7)}`;

  // 1. Overlap guard
  const state = await getState();
  if (localInFlightCheck || state.activeCheckId) {
    const elapsedSinceAttempt = state.lastAttemptAt ? (startTime - new Date(state.lastAttemptAt).getTime()) : 0;
    if (elapsedSinceAttempt < CHECK_TIMEOUT_MS) {
      logger.warn('Scheduler', 'Check already in progress, skipping overlapping execution', { checkId });
      return { skipped: true, reason: 'OVERLAPPING_CHECK_PREVENTED' };
    }
    logger.warn('Scheduler', 'Previous check exceeded 30s timeout, recovering');
  }

  localInFlightCheck = true;
  await saveState({ activeCheckId: checkId, lastAttemptAt: new Date(startTime).toISOString() });

  const config = await getConfig();
  let observation = null;
  let checkDurationMs = 0;

  try {
    if (mockSnapshot) {
      // Testing path with provided snapshot
      observation = classifyPageSnapshot(mockSnapshot, config.targetUsername);
      checkDurationMs = Date.now() - startTime;
    } else {
      // Browser tab execution path
      const { tab, error: tabError } = await resolveMonitoringTab(config.targetUrl, config.targetUsername);

      if (!tab) {
        logger.warn('Scheduler', 'Cannot observe: monitoring tab unavailable', tabError);
        await saveState({
          monitoringStatus: MonitoringStatus.INTERRUPTED,
          interruptionReason: tabError || 'Monitoring tab closed or unavailable'
        });

        observation = {
          state: ObservationState.UNKNOWN,
          confidence: Confidence.LOW,
          observedAt: new Date(startTime).toISOString(),
          targetUsername: config.targetUsername,
          reason: tabError || 'Dedicated monitoring tab unavailable',
          source: 'authorized-page-observation'
        };
      } else {
        // Query content script via message passing with 15s timeout
        const response = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            resolve({ success: false, error: 'Inspection request timed out' });
          }, 15000);

          chrome.tabs.sendMessage(tab.id, { action: 'INSPECT_PAGE', checkId }, (resp) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
            } else {
              resolve(resp || { success: false, error: 'Empty response from tab' });
            }
          });
        });

        checkDurationMs = Date.now() - startTime;

        if (response?.success && response.snapshot) {
          observation = classifyPageSnapshot(response.snapshot, config.targetUsername);
        } else {
          observation = {
            state: ObservationState.UNKNOWN,
            confidence: Confidence.LOW,
            observedAt: new Date(startTime).toISOString(),
            targetUsername: config.targetUsername,
            reason: response?.error || 'Content script inspection failed',
            source: 'authorized-page-observation'
          };
        }
      }
    }
  } catch (err) {
    checkDurationMs = Date.now() - startTime;
    observation = {
      state: ObservationState.UNKNOWN,
      confidence: Confidence.LOW,
      observedAt: new Date(startTime).toISOString(),
      targetUsername: config.targetUsername,
      reason: err.message || 'Observation exception',
      source: 'authorized-page-observation'
    };
  } finally {
    localInFlightCheck = false;
  }

  // 2. Evaluate observation in pure State Machine
  const currentState = await getState();
  const evaluation = processObservation(currentState, observation);

  // Compute next intended check time if monitoring is running
  let nextScheduledTime = null;
  if (currentState.monitoringStatus === MonitoringStatus.RUNNING) {
    nextScheduledTime = new Date(Date.now() + (config.intervalMinutes || DEFAULT_INTERVAL_MINUTES) * 60000).toISOString();
  }

  // 3. Persist updated state
  await saveState({
    ...evaluation.nextState,
    activeCheckId: null,
    nextScheduledCheckAt: nextScheduledTime
  });

  // 4. Record event to history
  let notificationStatus = NotificationStatus.SKIPPED;
  const historyEvent = await addHistoryEvent({
    observedState: observation.state,
    previousReliableState: evaluation.nextState.previousReliableState,
    confidence: observation.confidence,
    reason: observation.reason,
    checkDurationMs,
    isTransition: evaluation.isTransition,
    notificationStatus
  });

  // 5. Handle Transition Notifications
  if (evaluation.isTransition && evaluation.transitionEvent) {
    logger.info('Scheduler', 'Transition detected!', evaluation.transitionEvent);

    // Telegram delivery
    if (config.telegramNotificationsEnabled) {
      const creds = await getTelegramCredentials();
      if (creds.botToken && creds.chatId) {
        const messageText = formatTransitionMessage(evaluation.transitionEvent);
        const sendRes = await sendTelegramMessage(creds.botToken, creds.chatId, messageText);
        notificationStatus = sendRes.status;
      } else {
        notificationStatus = NotificationStatus.FAILED;
        logger.warn('Scheduler', 'Telegram enabled but credentials missing');
      }
    }

    // Browser Notification
    if (config.browserNotificationsEnabled && typeof chrome !== 'undefined' && chrome.notifications) {
      const isVisible = evaluation.transitionEvent.newObservation === ObservationState.VISIBLE;
      const title = `Instagram: @${config.targetUsername}`;
      const msg = isVisible
        ? 'Profile is now VISIBLE (Observed Accessibility)'
        : 'Profile is now UNAVAILABLE (Deactivation unverified)';

      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icons/icon128.png',
        title,
        message: msg,
        priority: 2
      }, () => {});
    }
  }

  return {
    checkId,
    observation,
    evaluation,
    historyEvent,
    isManual
  };
}
