/**
 * Storage Abstraction Layer
 * Interfaces with chrome.storage.local in browser context,
 * with seamless in-memory fallback for unit testing in Node.js.
 */

import {
  STORAGE_KEYS,
  DEFAULT_CONFIG,
  DEFAULT_STATE,
  NotificationStatus
} from './constants.js';
import { formatDhakaDateTime } from './timestamps.js';
import { logger } from './logger.js';

// In-memory backing store for Node.js test environment
const mockMemoryStore = new Map();

/**
 * Low-level storage adapter
 */
const storageAdapter = {
  async get(keys) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.get(keys, (items) => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(items || {});
          }
        });
      });
    }
    // Node.js fallback
    const result = {};
    const keyList = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
    for (const k of keyList) {
      if (mockMemoryStore.has(k)) {
        result[k] = JSON.parse(JSON.stringify(mockMemoryStore.get(k)));
      }
    }
    return result;
  },

  async set(items) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.set(items, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    }
    // Node.js fallback
    for (const [k, v] of Object.entries(items)) {
      mockMemoryStore.set(k, JSON.parse(JSON.stringify(v)));
    }
  },

  async remove(keys) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.remove(keys, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    }
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const k of keyList) {
      mockMemoryStore.delete(k);
    }
  },

  async clear() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve, reject) => {
        chrome.storage.local.clear(() => {
          if (chrome.runtime && chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    }
    mockMemoryStore.clear();
  }
};

/**
 * Configuration API
 */
export async function getConfig() {
  try {
    const data = await storageAdapter.get(STORAGE_KEYS.CONFIG);
    return { ...DEFAULT_CONFIG, ...(data[STORAGE_KEYS.CONFIG] || {}) };
  } catch (err) {
    logger.error('Storage', 'Failed to retrieve configuration, using defaults', err.message);
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(updates) {
  try {
    const current = await getConfig();
    const updated = { ...current, ...updates };
    await storageAdapter.set({ [STORAGE_KEYS.CONFIG]: updated });
    return updated;
  } catch (err) {
    logger.error('Storage', 'Failed to save configuration', err.message);
    throw err;
  }
}

export async function resetConfig() {
  await storageAdapter.set({ [STORAGE_KEYS.CONFIG]: { ...DEFAULT_CONFIG } });
  return { ...DEFAULT_CONFIG };
}

/**
 * State Machine Persistence API
 */
export async function getState() {
  try {
    const data = await storageAdapter.get(STORAGE_KEYS.STATE);
    return { ...DEFAULT_STATE, ...(data[STORAGE_KEYS.STATE] || {}) };
  } catch (err) {
    logger.error('Storage', 'Failed to retrieve state, using defaults', err.message);
    return { ...DEFAULT_STATE };
  }
}

export async function saveState(stateUpdates) {
  try {
    const current = await getState();
    const updated = { ...current, ...stateUpdates };
    await storageAdapter.set({ [STORAGE_KEYS.STATE]: updated });
    return updated;
  } catch (err) {
    logger.error('Storage', 'Failed to save state updates', err.message);
    throw err;
  }
}

export async function resetState() {
  await storageAdapter.set({ [STORAGE_KEYS.STATE]: { ...DEFAULT_STATE } });
  return { ...DEFAULT_STATE };
}

/**
 * Event History API
 */
export async function getHistory(options = {}) {
  try {
    const data = await storageAdapter.get(STORAGE_KEYS.HISTORY);
    let events = Array.isArray(data[STORAGE_KEYS.HISTORY]) ? data[STORAGE_KEYS.HISTORY] : [];

    if (options.transitionOnly) {
      events = events.filter((e) => e.isTransition === true);
    }
    if (options.stateFilter) {
      events = events.filter((e) => e.observedState === options.stateFilter);
    }
    if (options.limit && typeof options.limit === 'number') {
      events = events.slice(-options.limit);
    }

    return events;
  } catch (err) {
    logger.error('Storage', 'Failed to retrieve history', err.message);
    return [];
  }
}

export async function addHistoryEvent(event) {
  try {
    const config = await getConfig();
    const limit = config.historyRetentionLimit || 1000;
    const history = await getHistory();

    const fullEvent = {
      id: event.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`),
      username: event.username || config.targetUsername,
      timestampUtc: event.timestampUtc || new Date().toISOString(),
      observedState: event.observedState,
      previousReliableState: event.previousReliableState || null,
      confidence: event.confidence || 'HIGH',
      reason: event.reason || '',
      source: event.source || 'authorized-page-observation',
      checkDurationMs: event.checkDurationMs || 0,
      isTransition: Boolean(event.isTransition),
      notificationStatus: event.notificationStatus || NotificationStatus.SKIPPED
    };

    history.push(fullEvent);

    // Prune oldest if over retention limit
    const pruned = history.length > limit ? history.slice(-limit) : history;

    await storageAdapter.set({ [STORAGE_KEYS.HISTORY]: pruned });
    return fullEvent;
  } catch (err) {
    logger.error('Storage', 'Failed to add history event', err.message);
    throw err;
  }
}

export async function updateHistoryEvent(id, updates) {
  const history = await getHistory();
  const index = history.findIndex((e) => e.id === id);
  if (index !== -1) {
    history[index] = { ...history[index], ...updates };
    await storageAdapter.set({ [STORAGE_KEYS.HISTORY]: history });
    return history[index];
  }
  return null;
}

export async function clearHistory() {
  await storageAdapter.remove(STORAGE_KEYS.HISTORY);
  return [];
}

/**
 * Telegram Credentials API
 */
export async function saveTelegramCredentials({ botToken, chatId }) {
  await storageAdapter.set({
    [STORAGE_KEYS.TELEGRAM]: {
      botToken: (botToken || '').trim(),
      chatId: (chatId || '').toString().trim(),
      updatedAt: new Date().toISOString()
    }
  });
}

export async function getTelegramCredentials() {
  try {
    const data = await storageAdapter.get(STORAGE_KEYS.TELEGRAM);
    return data[STORAGE_KEYS.TELEGRAM] || { botToken: '', chatId: '' };
  } catch {
    return { botToken: '', chatId: '' };
  }
}

export async function clearTelegramCredentials() {
  await storageAdapter.remove(STORAGE_KEYS.TELEGRAM);
}

/**
 * Active Tab ID Tracking
 */
export async function getActiveTabId() {
  const data = await storageAdapter.get(STORAGE_KEYS.ACTIVE_TAB_ID);
  return data[STORAGE_KEYS.ACTIVE_TAB_ID] || null;
}

export async function setActiveTabId(tabId) {
  if (tabId === null) {
    await storageAdapter.remove(STORAGE_KEYS.ACTIVE_TAB_ID);
  } else {
    await storageAdapter.set({ [STORAGE_KEYS.ACTIVE_TAB_ID]: tabId });
  }
}

/**
 * CSV Export Generator
 * Safely escapes double quotes, commas, and newlines.
 * Never includes sensitive credentials.
 */
export function exportHistoryAsCsv(events = []) {
  const headers = [
    'Event ID',
    'Timestamp (UTC)',
    'Timestamp (Asia/Dhaka)',
    'Account',
    'Observed State',
    'Previous Reliable State',
    'Confidence',
    'Is Transition',
    'Notification Status',
    'Check Duration (ms)',
    'Reason'
  ];

  const escapeCell = (value) => {
    if (value === null || value === undefined) return '""';
    let str = String(value);
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    return `"${str.replace(/"/g, '""')}"`;
  };

  const rows = [headers.map(escapeCell).join(',')];

  for (const e of events) {
    const row = [
      escapeCell(e.id),
      escapeCell(e.timestampUtc),
      escapeCell(formatDhakaDateTime(e.timestampUtc, { includeSeconds: true })),
      escapeCell(e.username),
      escapeCell(e.observedState),
      escapeCell(e.previousReliableState || '—'),
      escapeCell(e.confidence),
      escapeCell(e.isTransition ? 'YES' : 'NO'),
      escapeCell(e.notificationStatus),
      escapeCell(e.checkDurationMs),
      escapeCell(e.reason)
    ];
    rows.push(row.join(','));
  }

  return rows.join('\r\n');
}

/**
 * For testing: resets the in-memory store
 */
export function __resetMockStore() {
  mockMemoryStore.clear();
}
