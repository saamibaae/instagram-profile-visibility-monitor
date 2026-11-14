/**
 * Settings Page Controller
 */

import { normalizeUsername, validateUsername, buildProfileUrl } from '../lib/validation.js';

// DOM Elements
const inputTarget = document.getElementById('input-target');
const checkAutoTab = document.getElementById('check-auto-tab');
const selectInterval = document.getElementById('select-interval');
const checkTelegramEnabled = document.getElementById('check-telegram-enabled');
const inputBotToken = document.getElementById('input-bot-token');
const inputChatId = document.getElementById('input-chat-id');
const btnToggleToken = document.getElementById('btn-toggle-token');
const btnTestTelegram = document.getElementById('btn-test-telegram');
const btnClearTelegram = document.getElementById('btn-clear-telegram');
const telegramTestResult = document.getElementById('telegram-test-result');
const checkBrowserNotifs = document.getElementById('check-browser-notifs');
const selectRetention = document.getElementById('select-retention');
const btnClearHistory = document.getElementById('btn-clear-history');
const btnSaveAll = document.getElementById('btn-save-all');
const toastEl = document.getElementById('toast');

function showToast(message, type = 'success') {
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  toastEl.classList.remove('hidden');
  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 4000);
}

// Toggle password visibility
btnToggleToken.addEventListener('click', () => {
  if (inputBotToken.type === 'password') {
    inputBotToken.type = 'text';
    btnToggleToken.textContent = '🔒';
  } else {
    inputBotToken.type = 'password';
    btnToggleToken.textContent = '👁';
  }
});

/**
 * Loads current settings into inputs
 */
async function loadSettings() {
  try {
    const statusResp = await chrome.runtime.sendMessage({ action: 'GET_STATUS' });
    if (!statusResp || !statusResp.success) return;

    const { config } = statusResp;

    inputTarget.value = config.targetUsername || 'instagram';
    checkAutoTab.checked = config.autoOpenTab !== false;
    selectInterval.value = String(config.intervalMinutes || 3);
    checkTelegramEnabled.checked = Boolean(config.telegramNotificationsEnabled);
    checkBrowserNotifs.checked = Boolean(config.browserNotificationsEnabled);
    selectRetention.value = String(config.historyRetentionLimit || 1000);

    // Load credentials if stored in extension storage
    chrome.storage.local.get(['insta_monitor_telegram'], (res) => {
      const creds = res.insta_monitor_telegram || {};
      if (creds.botToken) inputBotToken.value = creds.botToken;
      if (creds.chatId) inputChatId.value = creds.chatId;
    });
  } catch (err) {
    showToast(`Failed to load settings: ${err.message}`, 'error');
  }
}

// Test Telegram Connection
btnTestTelegram.addEventListener('click', async () => {
  const botToken = inputBotToken.value.trim();
  const chatId = inputChatId.value.trim();

  if (!botToken || !chatId) {
    telegramTestResult.textContent = 'Please enter both Bot Token and Chat ID to test.';
    telegramTestResult.className = 'test-result-box error';
    telegramTestResult.classList.remove('hidden');
    return;
  }

  btnTestTelegram.disabled = true;
  telegramTestResult.textContent = 'Sending test notification to Telegram...';
  telegramTestResult.className = 'test-result-box';
  telegramTestResult.classList.remove('hidden');

  try {
    const res = await chrome.runtime.sendMessage({
      action: 'TEST_TELEGRAM',
      botToken,
      chatId
    });

    if (res?.success) {
      telegramTestResult.textContent = '✓ Test notification delivered successfully! Check your Telegram chat.';
      telegramTestResult.className = 'test-result-box success';
    } else {
      telegramTestResult.textContent = `✗ Delivery failed: ${res?.error || 'Unknown error'}`;
      telegramTestResult.className = 'test-result-box error';
    }
  } catch (err) {
    telegramTestResult.textContent = `✗ Error: ${err.message}`;
    telegramTestResult.className = 'test-result-box error';
  } finally {
    btnTestTelegram.disabled = false;
  }
});

// Clear Telegram Credentials
btnClearTelegram.addEventListener('click', async () => {
  if (confirm('Clear saved Telegram Bot Token and Chat ID?')) {
    await chrome.runtime.sendMessage({ action: 'CLEAR_TELEGRAM_CREDENTIALS' });
    inputBotToken.value = '';
    inputChatId.value = '';
    telegramTestResult.classList.add('hidden');
    showToast('Telegram credentials cleared.');
  }
});

// Clear All History
btnClearHistory.addEventListener('click', async () => {
  if (confirm('Are you sure you want to delete all stored observation history? This cannot be undone.')) {
    await chrome.runtime.sendMessage({ action: 'CLEAR_HISTORY' });
    showToast('All observation history cleared.');
  }
});

// Save All Settings
btnSaveAll.addEventListener('click', async () => {
  const rawTarget = inputTarget.value.trim();
  const username = normalizeUsername(rawTarget);

  if (!validateUsername(username)) {
    showToast(`Invalid Instagram username: "${rawTarget}". Only letters, numbers, dots, and underscores allowed.`, 'error');
    return;
  }

  const intervalMinutes = parseInt(selectInterval.value, 10);
  const autoOpenTab = checkAutoTab.checked;
  const telegramNotificationsEnabled = checkTelegramEnabled.checked;
  const browserNotificationsEnabled = checkBrowserNotifs.checked;
  const historyRetentionLimit = parseInt(selectRetention.value, 10);

  const botToken = inputBotToken.value.trim();
  const chatId = inputChatId.value.trim();

  btnSaveAll.disabled = true;

  try {
    const targetUrl = buildProfileUrl(username);

    // Save config
    await chrome.runtime.sendMessage({
      action: 'SAVE_CONFIG',
      updates: {
        targetUsername: username,
        targetUrl,
        intervalMinutes,
        autoOpenTab,
        telegramNotificationsEnabled,
        browserNotificationsEnabled,
        historyRetentionLimit
      }
    });

    // Save Telegram credentials
    if (botToken || chatId) {
      await chrome.runtime.sendMessage({
        action: 'SAVE_TELEGRAM_CREDENTIALS',
        botToken,
        chatId
      });
    }

    showToast('All settings saved successfully!');
  } catch (err) {
    showToast(`Save error: ${err.message}`, 'error');
  } finally {
    btnSaveAll.disabled = false;
  }
});

loadSettings();
