/**
 * Background Service Worker for Instagram Profile Visibility Monitor
 * Chrome Manifest V3 Ephemeral Lifecycle Compliant.
 * Top-level synchronous event listener registration.
 */

import { ALARM_NAME, MonitoringStatus, DEFAULT_INTERVAL_MINUTES } from '../lib/constants.js';
import {
  getConfig,
  saveConfig,
  getState,
  saveState,
  getActiveTabId,
  setActiveTabId,
  getHistory,
  clearHistory,
  getTelegramCredentials,
  saveTelegramCredentials,
  clearTelegramCredentials,
  exportHistoryAsCsv
} from '../lib/storage.js';
import {
  startMonitoring,
  pauseMonitoring,
  stopMonitoring,
  performObservationCheck
} from '../lib/scheduler.js';
import { testTelegramConnection } from '../lib/telegram.js';
import { logger } from '../lib/logger.js';

logger.info('ServiceWorker', 'Service worker initialized');

// Top-level synchronous event listeners
chrome.runtime.onInstalled.addListener(async (details) => {
  logger.info('ServiceWorker', 'Extension installed/updated', details.reason);
  try {
    const config = await getConfig();
    logger.info('ServiceWorker', 'Config loaded on install', { targetUsername: config.targetUsername });
  } catch (err) {
    logger.error('ServiceWorker', 'Initialization error on install', err.message);
  }
});

chrome.runtime.onStartup.addListener(async () => {
  logger.info('ServiceWorker', 'Browser startup detected, reconciling state');
  try {
    const config = await getConfig();
    const state = await getState();

    // Reconcile alarm if monitoring was running prior to browser shutdown
    if (config.monitoringEnabled && state.monitoringStatus === MonitoringStatus.RUNNING) {
      chrome.alarms.get(ALARM_NAME, (existingAlarm) => {
        if (!existingAlarm) {
          const interval = config.intervalMinutes || DEFAULT_INTERVAL_MINUTES;
          chrome.alarms.create(ALARM_NAME, {
            delayInMinutes: interval,
            periodInMinutes: interval
          });
          logger.info('ServiceWorker', 'Re-established monitoring alarm after startup', { interval });
        }
      });
    }
  } catch (err) {
    logger.error('ServiceWorker', 'Startup reconciliation failed', err.message);
  }
});

// Periodic Alarm Handler
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    logger.info('ServiceWorker', 'Periodic check alarm triggered');
    performObservationCheck({ isManual: false }).catch((err) => {
      logger.error('ServiceWorker', 'Error executing scheduled observation check', err.message);
    });
  }
});

// Tab removal listener: detect if the monitored tab was closed by user
chrome.tabs.onRemoved.addListener(async (closedTabId) => {
  try {
    const monitoredTabId = await getActiveTabId();
    if (monitoredTabId !== null && closedTabId === monitoredTabId) {
      logger.warn('ServiceWorker', 'Monitored tab was closed by user');
      await setActiveTabId(null);
      const state = await getState();
      if (state.monitoringStatus === MonitoringStatus.RUNNING) {
        await saveState({
          monitoringStatus: MonitoringStatus.INTERRUPTED,
          interruptionReason: 'Dedicated Instagram tab was closed'
        });
      }
    }
  } catch (err) {
    logger.warn('ServiceWorker', 'Error in tabs.onRemoved handler', err.message);
  }
});

// Message Passing Router for UI (Popup, Settings, History)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message?.action;

  (async () => {
    try {
      switch (action) {
        case 'GET_STATUS': {
          const config = await getConfig();
          const state = await getState();
          const activeTabId = await getActiveTabId();
          const telegram = await getTelegramCredentials();
          sendResponse({
            success: true,
            config,
            state,
            activeTabId,
            telegramConfigured: Boolean(telegram.botToken && telegram.chatId)
          });
          break;
        }

        case 'START_MONITORING': {
          const interval = message.intervalMinutes;
          const nextState = await startMonitoring(interval);
          sendResponse({ success: true, state: nextState });
          break;
        }

        case 'PAUSE_MONITORING': {
          const nextState = await pauseMonitoring('User clicked Pause');
          sendResponse({ success: true, state: nextState });
          break;
        }

        case 'STOP_MONITORING': {
          const nextState = await stopMonitoring();
          sendResponse({ success: true, state: nextState });
          break;
        }

        case 'TRIGGER_MANUAL_CHECK': {
          const result = await performObservationCheck({ isManual: true });
          const updatedState = await getState();
          sendResponse({ success: true, result, state: updatedState });
          break;
        }

        case 'SAVE_CONFIG': {
          const updates = message.updates || {};
          const updatedConfig = await saveConfig(updates);
          // If interval changed and running, update alarm
          const currentState = await getState();
          if (currentState.monitoringStatus === MonitoringStatus.RUNNING && updates.intervalMinutes) {
            chrome.alarms.create(ALARM_NAME, {
              delayInMinutes: updates.intervalMinutes,
              periodInMinutes: updates.intervalMinutes
            });
          }
          sendResponse({ success: true, config: updatedConfig });
          break;
        }

        case 'SAVE_TELEGRAM_CREDENTIALS': {
          const { botToken, chatId } = message;
          await saveTelegramCredentials({ botToken, chatId });
          sendResponse({ success: true });
          break;
        }

        case 'CLEAR_TELEGRAM_CREDENTIALS': {
          await clearTelegramCredentials();
          sendResponse({ success: true });
          break;
        }

        case 'TEST_TELEGRAM': {
          const { botToken, chatId } = message;
          const config = await getConfig();
          const creds = await getTelegramCredentials();
          const tokenToUse = botToken || creds.botToken;
          const chatIdToUse = chatId || creds.chatId;

          const res = await testTelegramConnection(tokenToUse, chatIdToUse, config.targetUsername);
          sendResponse({ success: res.ok, status: res.status, error: res.error });
          break;
        }

        case 'GET_HISTORY': {
          const options = message.options || {};
          const history = await getHistory(options);
          sendResponse({ success: true, history });
          break;
        }

        case 'CLEAR_HISTORY': {
          await clearHistory();
          sendResponse({ success: true });
          break;
        }

        case 'EXPORT_CSV': {
          const history = await getHistory();
          const csv = exportHistoryAsCsv(history);
          sendResponse({ success: true, csv });
          break;
        }

        case 'CONTENT_SCRIPT_READY': {
          logger.debug('ServiceWorker', 'Content script reported ready from URL', message.url);
          sendResponse({ acknowledged: true });
          break;
        }

        default:
          sendResponse({ success: false, error: `Unknown action: ${action}` });
      }
    } catch (err) {
      logger.error('ServiceWorker', `Error handling message action: ${action}`, err.message);
      sendResponse({ success: false, error: err.message || 'Operation failed' });
    }
  })();

  return true; // Keep message channel open for async response
});
