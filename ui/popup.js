/**
 * Main Popup Controller
 */

import { MonitoringStatus, ObservationState } from '../lib/constants.js';
import { formatDhakaTime, formatDhakaDateTime, isCheckOverdue } from '../lib/timestamps.js';

// DOM Elements
const targetLinkEl = document.getElementById('target-link');
const monitoringDotEl = document.getElementById('monitoring-dot');
const monitoringStatusTextEl = document.getElementById('monitoring-status-text');
const interruptionBannerEl = document.getElementById('interruption-banner');
const interruptionTextEl = document.getElementById('interruption-text');
const currentObsBadgeEl = document.getElementById('current-obs-badge');
const telegramStatusEl = document.getElementById('telegram-status');
const lastReliableStateEl = document.getElementById('last-reliable-state');
const lastAttemptTimeEl = document.getElementById('last-attempt-time');
const nextCheckTimeEl = document.getElementById('next-check-time');
const lastTransitionTimeEl = document.getElementById('last-transition-time');
const scheduleIndicatorEl = document.getElementById('schedule-indicator');

const btnStart = document.getElementById('btn-start');
const btnPause = document.getElementById('btn-pause');
const btnStop = document.getElementById('btn-stop');
const btnCheckNow = document.getElementById('btn-check-now');
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnOpenHistory = document.getElementById('btn-open-history');

/**
 * Loads current state from service worker and updates UI
 */
async function refreshStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_STATUS' });
    if (!response || !response.success) return;

    const { config, state, telegramConfigured } = response;

    // 1. Target Account
    targetLinkEl.textContent = `@${config.targetUsername}`;
    targetLinkEl.href = config.targetUrl;

    // 2. Monitoring Status
    const status = state.monitoringStatus || MonitoringStatus.STOPPED;
    monitoringStatusTextEl.textContent = status;
    monitoringDotEl.className = 'status-indicator-dot';

    if (status === MonitoringStatus.RUNNING) {
      monitoringDotEl.classList.add('running');
      btnStart.classList.add('hidden');
      btnPause.classList.remove('hidden');
      btnStop.classList.remove('hidden');
      btnPause.textContent = 'Pause';
    } else if (status === MonitoringStatus.PAUSED) {
      monitoringDotEl.classList.add('paused');
      btnStart.classList.remove('hidden');
      btnStart.textContent = 'Resume';
      btnPause.classList.add('hidden');
      btnStop.classList.remove('hidden');
    } else if (status === MonitoringStatus.INTERRUPTED) {
      monitoringDotEl.classList.add('interrupted');
      btnStart.classList.remove('hidden');
      btnStart.textContent = 'Restart';
      btnPause.classList.add('hidden');
      btnStop.classList.remove('hidden');
    } else {
      // STOPPED
      btnStart.classList.remove('hidden');
      btnStart.textContent = 'Start Monitoring';
      btnPause.classList.add('hidden');
      btnStop.classList.add('hidden');
    }

    // 3. Interruption Banner
    if (status === MonitoringStatus.INTERRUPTED || state.interruptionReason) {
      interruptionBannerEl.classList.remove('hidden');
      interruptionTextEl.textContent = state.interruptionReason || 'Monitoring interrupted';
    } else {
      interruptionBannerEl.classList.add('hidden');
    }

    // 4. Current Observation Badge
    const obs = state.currentObservation || ObservationState.UNKNOWN;
    currentObsBadgeEl.textContent = obs;
    currentObsBadgeEl.className = 'badge';
    if (obs === ObservationState.VISIBLE) {
      currentObsBadgeEl.classList.add('badge-visible');
    } else if (obs === ObservationState.UNAVAILABLE) {
      currentObsBadgeEl.classList.add('badge-unavailable');
    } else {
      currentObsBadgeEl.classList.add('badge-unknown');
    }

    // 5. Telegram Status
    if (!config.telegramNotificationsEnabled) {
      telegramStatusEl.textContent = 'Disabled';
      telegramStatusEl.className = 'telegram-badge disconnected';
    } else if (telegramConfigured) {
      telegramStatusEl.textContent = 'Connected';
      telegramStatusEl.className = 'telegram-badge connected';
    } else {
      telegramStatusEl.textContent = 'Not configured';
      telegramStatusEl.className = 'telegram-badge disconnected';
    }

    // 6. Timestamps
    lastReliableStateEl.textContent = state.lastReliableState
      ? `${state.lastReliableState} (${formatDhakaTime(state.lastReliableObservedAt)})`
      : '—';

    lastAttemptTimeEl.textContent = formatDhakaTime(state.lastAttemptAt, true);

    if (state.nextScheduledCheckAt) {
      const isOverdue = isCheckOverdue(state.nextScheduledCheckAt);
      nextCheckTimeEl.textContent = `${formatDhakaTime(state.nextScheduledCheckAt)}${isOverdue ? ' (Overdue)' : ''}`;
      if (isOverdue) {
        nextCheckTimeEl.classList.add('overdue');
      } else {
        nextCheckTimeEl.classList.remove('overdue');
      }
    } else {
      nextCheckTimeEl.textContent = status === MonitoringStatus.RUNNING ? 'Scheduling...' : '—';
      nextCheckTimeEl.classList.remove('overdue');
    }

    lastTransitionTimeEl.textContent = state.lastTransitionAt
      ? formatDhakaDateTime(state.lastTransitionAt)
      : 'None detected';

    // 7. Schedule note
    scheduleIndicatorEl.textContent = `Interval: ${config.intervalMinutes || 3}m`;
  } catch (err) {
    console.error('Failed to refresh status:', err);
  }
}

// Button Handlers
btnStart.addEventListener('click', async () => {
  btnStart.disabled = true;
  await chrome.runtime.sendMessage({ action: 'START_MONITORING' });
  btnStart.disabled = false;
  refreshStatus();
});

btnPause.addEventListener('click', async () => {
  btnPause.disabled = true;
  await chrome.runtime.sendMessage({ action: 'PAUSE_MONITORING' });
  btnPause.disabled = false;
  refreshStatus();
});

btnStop.addEventListener('click', async () => {
  btnStop.disabled = true;
  await chrome.runtime.sendMessage({ action: 'STOP_MONITORING' });
  btnStop.disabled = false;
  refreshStatus();
});

btnCheckNow.addEventListener('click', async () => {
  btnCheckNow.disabled = true;
  const originalText = btnCheckNow.textContent;
  btnCheckNow.textContent = 'Checking...';

  try {
    await chrome.runtime.sendMessage({ action: 'TRIGGER_MANUAL_CHECK' });
  } catch (e) {
    console.error('Check error:', e);
  } finally {
    btnCheckNow.disabled = false;
    btnCheckNow.textContent = originalText;
    refreshStatus();
  }
});

btnOpenSettings.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('ui/settings.html') });
});

btnOpenHistory.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('ui/history.html') });
});

// Initial load and periodic refresh while popup open
refreshStatus();
const refreshInterval = setInterval(refreshStatus, 2500);
window.addEventListener('unload', () => clearInterval(refreshInterval));
