/**
 * Production-Hardened Local Web GUI Dashboard Server
 * Powered by native node:http (zero external dependencies).
 * Binds strictly to 127.0.0.1 with Host/Origin CSRF protection,
 * two-mode scheduling controls, live diagnostics, and history filters.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec, spawn } from 'node:child_process';
import {
  loadDaemonConfig,
  saveDaemonConfig,
  sanitizeConfigForClient
} from './config.js';
import {
  checkDaemonRunning,
  getDaemonState,
  saveDaemonState,
  appendDaemonEvent,
  appendDaemonAuditEvent,
  readDaemonEvents,
  readDaemonAuditEvents,
  exportDaemonEventsToCsv,
  releaseDaemonLock
} from './storage.js';
import {
  runObservationCycle,
  reschedule,
  pauseMonitoring,
  resumeMonitoring,
  getSchedulerStatus,
  startDaemon,
  stopDaemon
} from './scheduler.js';
import { closeBrowser } from './browser.js';
import { sendDaemonCommand } from './ipc.js';
import { testTelegramConnection } from '../lib/telegram.js';
import { formatDhakaDateTime, formatDhakaTime } from '../lib/timestamps.js';
import { logger } from '../lib/logger.js';
import {
  authenticateRequest,
  isAuthorizedHostOrProxy,
  createSessionToken,
  verifyPassword,
  getAuthConfig
} from './auth.js';
import {
  importRawCookies,
  importStorageState,
  getSessionStatus
} from './session.js';
import {
  ScheduleMode,
  SessionHealth,
  AuditEventType,
  FIXED_INTERVAL_MIN_MINUTES,
  FIXED_INTERVAL_MAX_MINUTES,
  RANDOM_RANGE_MIN_SECONDS,
  RANDOM_RANGE_MAX_SECONDS
} from '../lib/constants.js';
import {
  normalizeUsername,
  validateUsername,
  buildProfileUrl,
  validateScheduleConfig
} from '../lib/validation.js';

const PORT = 3847;
const MAX_PAYLOAD_BYTES = 102400; // 100 KB max payload

export function getDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Instagram Visibility Monitor Dashboard</title>
  <style>
    :root {
      --bg-primary: #f5f5f7;
      --bg-card: #ffffff;
      --border-color: #e5e5ea;
      --text-primary: #1c1c1e;
      --text-secondary: #8e8e93;
      --accent-color: #0071e3;
      --accent-hover: #0077ed;
      --success-color: #34c759;
      --danger-color: #ff3b30;
      --warning-color: #ff9500;
      --card-shadow: 0 4px 14px rgba(0, 0, 0, 0.05);
      --radius-sm: 8px;
      --radius-md: 12px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg-primary: #1c1c1e;
        --bg-card: #2c2c2e;
        --border-color: #38383a;
        --text-primary: #f5f5f7;
        --text-secondary: #98989d;
        --card-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: var(--bg-primary); color: var(--text-primary); padding: 24px; }
    .layout { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
    
    /* Header */
    .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 14px; border-bottom: 1px solid var(--border-color); }
    .title-group h1 { font-size: 20px; font-weight: 600; }
    .title-group p { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }
    .header-badges { display: flex; align-items: center; gap: 10px; }
    .status-pill { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 20px; background-color: var(--bg-card); border: 1px solid var(--border-color); }
    .dot { width: 10px; height: 10px; border-radius: 50%; background-color: var(--text-secondary); }
    .dot.running { background-color: var(--success-color); box-shadow: 0 0 8px rgba(52, 199, 89, 0.6); }
    .dot.paused { background-color: var(--warning-color); box-shadow: 0 0 8px rgba(255, 149, 0, 0.6); }

    /* Cards */
    .card { background-color: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 18px; box-shadow: var(--card-shadow); display: flex; flex-direction: column; gap: 14px; }
    .card-title { font-size: 15px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }

    /* Metrics Grid */
    .status-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    @media (max-width: 768px) { .status-grid { grid-template-columns: repeat(2, 1fr); } }
    .metric-box { background: var(--bg-primary); padding: 12px; border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 4px; }
    .metric-label { font-size: 11px; text-transform: uppercase; color: var(--text-secondary); font-weight: 600; }
    .metric-val { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Badges */
    .badge { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 12px; font-weight: 700; width: fit-content; }
    .badge-visible { background: rgba(52, 199, 89, 0.15); color: var(--success-color); }
    .badge-unavailable { background: rgba(255, 59, 48, 0.15); color: var(--danger-color); }
    .badge-unknown { background: rgba(142, 142, 147, 0.15); color: var(--text-secondary); }
    .badge-health-ok { background: rgba(52, 199, 89, 0.15); color: var(--success-color); }
    .badge-health-warn { background: rgba(255, 149, 0, 0.15); color: var(--warning-color); }

    /* Buttons & Controls */
    .controls-row { display: flex; gap: 10px; flex-wrap: wrap; }
    .btn { padding: 8px 16px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; border: 1px solid transparent; cursor: pointer; transition: all 0.15s ease; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
    .btn-primary { background-color: var(--accent-color); color: #fff; }
    .btn-primary:hover { background-color: var(--accent-hover); }
    .btn-danger { background-color: rgba(255, 59, 48, 0.12); color: var(--danger-color); border-color: rgba(255, 59, 48, 0.25); }
    .btn-danger:hover { background-color: rgba(255, 59, 48, 0.22); }
    .btn-secondary { background-color: var(--bg-card); border-color: var(--border-color); color: var(--text-primary); }
    .btn-secondary:hover { background-color: var(--border-color); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Inputs & Forms */
    .input-text { padding: 9px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); font-size: 13px; outline: none; }
    .input-text:focus { border-color: var(--accent-color); }
    .segmented-control { display: inline-flex; background: var(--bg-primary); padding: 4px; border-radius: 8px; border: 1px solid var(--border-color); }
    .seg-btn { padding: 6px 14px; border: none; background: transparent; font-size: 12px; font-weight: 600; border-radius: 6px; cursor: pointer; color: var(--text-secondary); transition: all 0.15s; }
    .seg-btn.active { background: var(--bg-card); color: var(--text-primary); box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
    
    .slider-row { display: flex; align-items: center; gap: 14px; }
    .slider-row input[type="range"] { flex: 1; accent-color: var(--accent-color); cursor: pointer; }
    .slider-num { width: 75px; text-align: center; font-weight: 600; }
    .hint-text { font-size: 11px; color: var(--text-secondary); }
    .validation-error { font-size: 12px; color: var(--danger-color); font-weight: 600; display: none; }

    /* History Table */
    .table-wrap { overflow-x: auto; max-height: 380px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 10px 12px; background: var(--bg-primary); color: var(--text-secondary); font-weight: 600; position: sticky; top: 0; }
    td { padding: 10px 12px; border-bottom: 1px solid var(--border-color); }
    tr:hover { background: rgba(0, 0, 0, 0.02); }
    .empty { text-align: center; color: var(--text-secondary); font-style: italic; padding: 30px; }

    /* Toast */
    #toast { position: fixed; bottom: 20px; right: 20px; background: #333; color: #fff; padding: 12px 20px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 500; display: none; box-shadow: 0 4px 16px rgba(0,0,0,0.2); z-index: 9999; }
  </style>
</head>
<body>
  <div class="layout">
    <!-- Header -->
    <header class="header">
      <div class="title-group">
        <h1>Instagram Visibility Monitor</h1>
        <p>Target: <strong id="hdr-target">@...</strong> &bull; Schedule: <span id="hdr-schedule">—</span></p>
      </div>
      <div class="header-badges">
        <div id="countdown-pill" class="status-pill" style="display: none; background: rgba(0, 113, 227, 0.08); border-color: rgba(0, 113, 227, 0.25); color: var(--accent-color);">
          <span style="font-size: 13px;">⏱</span>
          <span id="txt-countdown-hdr">Next fetch in --s</span>
        </div>
        <div class="status-pill">
          <span class="dot" id="dot"></span>
          <span id="txt-status">Checking...</span>
        </div>
      </div>
    </header>

    <!-- Runtime Status & Metrics Panel -->
    <section class="card">
      <div class="status-grid">
        <div class="metric-box">
          <span class="metric-label">Observed State</span>
          <span id="metric-obs" class="badge badge-unknown">UNKNOWN</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">Last Attempt (Dhaka)</span>
          <span id="metric-attempt" class="metric-val">—</span>
        </div>
        <div class="metric-box">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="metric-label">Intended Next Check</span>
            <span id="badge-countdown-live" style="font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; display: none;">--s</span>
          </div>
          <span id="metric-next" class="metric-val">—</span>
          <span id="metric-countdown-sub" style="font-size: 11px; font-weight: 600; color: var(--accent-color); margin-top: 2px;">—</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">Session Health</span>
          <span id="metric-health" class="badge badge-health-ok">OK</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">Active Mode</span>
          <span id="metric-mode" class="metric-val">FIXED (3m)</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">Last Selected Delay</span>
          <span id="metric-delay" class="metric-val">—</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">Process Memory / PID</span>
          <span id="metric-process" class="metric-val">—</span>
        </div>
        <div class="metric-box">
          <span class="metric-label">Telegram Alerts</span>
          <span id="metric-telegram" class="metric-val" style="color: var(--success-color);">ENABLED</span>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="controls-row">
        <button id="btn-start" class="btn btn-primary" onclick="startMonitor()">Start Monitoring</button>
        <button id="btn-pause" class="btn btn-secondary" onclick="togglePause()">Pause</button>
        <button id="btn-stop" class="btn btn-danger" onclick="stopMonitor()">Stop Monitoring</button>
        <button id="btn-check" class="btn btn-secondary" onclick="checkNow()">Check Status Now</button>
        <button id="btn-test-tg" class="btn btn-secondary" onclick="testTelegram()">Test Telegram Alert</button>
        <button id="btn-export" class="btn btn-secondary" onclick="exportCsv()">Export CSV</button>
      </div>
    </section>

    <!-- Target Account Section -->
    <section class="card">
      <div class="card-title">
        <span>Instagram Username</span>
        <span class="hint-text">Active: <strong id="lbl-active-target" style="color: var(--accent-color);">@...</strong></span>
      </div>
      <div style="display: flex; gap: 10px;">
        <input type="text" id="input-target-user" class="input-text" style="flex: 1;" placeholder="Enter handle or profile URL (e.g. cristiano, @natgeo, https://instagram.com/user)">
        <button id="btn-apply-target" class="btn btn-primary" onclick="applyTarget()">Apply Target</button>
      </div>
      <p class="hint-text">Applies canonical handle and resets comparison baseline under Rule I so previous observations do not trigger false transition alerts.</p>
    </section>

    <!-- Scheduling Modes Section -->
    <section class="card">
      <div class="card-title">
        <span>Monitoring Schedule</span>
        <!-- Segmented Control -->
        <div class="segmented-control" role="group" aria-label="Schedule Mode">
          <button id="btn-mode-fixed" class="seg-btn active" onclick="selectScheduleMode('FIXED')">Fixed Interval</button>
          <button id="btn-mode-random" class="seg-btn" onclick="selectScheduleMode('RANDOM_RANGE')">Random Range</button>
        </div>
      </div>

      <!-- Fixed Interval Mode Controls -->
      <div id="controls-fixed" style="display: flex; flex-direction: column; gap: 10px;">
        <label style="font-size: 13px; font-weight: 600;">Check Interval (Whole Minutes)</label>
        <div class="slider-row">
          <input type="range" id="slider-fixed" min="3" max="60" step="1" value="3" oninput="syncFixedFromSlider(this.value)">
          <input type="number" id="num-fixed" class="input-text slider-num" min="3" max="60" step="1" value="3" oninput="syncFixedFromNumber(this.value)">
          <span id="lbl-fixed-cadence" style="font-size: 13px; font-weight: 600; min-width: 140px;">Every 3 minutes</span>
        </div>
        <p class="hint-text">Permitted range: 3 to 60 minutes. Schedules each check relative to previous completion.</p>
      </div>

      <!-- Random Range Mode Controls -->
      <div id="controls-random" style="display: none; flex-direction: column; gap: 12px;">
        <div>
          <label style="font-size: 13px; font-weight: 600;">Minimum Delay (Seconds)</label>
          <div class="slider-row" style="margin-top: 4px;">
            <input type="range" id="slider-random-min" min="60" max="180" step="5" value="60" oninput="syncRandomMinFromSlider(this.value)">
            <input type="number" id="num-random-min" class="input-text slider-num" min="60" max="180" step="1" value="60" oninput="syncRandomMinFromNumber(this.value)">
            <span id="lbl-random-min" style="font-size: 12px; font-weight: 600; min-width: 130px;">60s (1 min 0s)</span>
          </div>
        </div>

        <div>
          <label style="font-size: 13px; font-weight: 600;">Maximum Delay (Seconds)</label>
          <div class="slider-row" style="margin-top: 4px;">
            <input type="range" id="slider-random-max" min="60" max="180" step="5" value="180" oninput="syncRandomMaxFromSlider(this.value)">
            <input type="number" id="num-random-max" class="input-text slider-num" min="60" max="180" step="1" value="180" oninput="syncRandomMaxFromNumber(this.value)">
            <span id="lbl-random-max" style="font-size: 12px; font-weight: 600; min-width: 130px;">180s (3 min 0s)</span>
          </div>
        </div>

        <div id="range-validation-msg" class="validation-error">Minimum delay cannot exceed maximum delay.</div>
        <p class="hint-text">Permitted bounds: 60 to 180 seconds. Selects a uniform random delay between checks for ordinary workload distribution.</p>
      </div>

      <div>
        <button id="btn-apply-schedule" class="btn btn-primary" onclick="applyScheduleSettings()">Apply Schedule</button>
      </div>
    </section>

    <!-- Observation Event History -->
    <section class="card table-card">
      <div class="card-title">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span>Observation Event History</span>
          <span style="font-size: 11px; font-weight: normal; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px;">
            <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;box-shadow: 0 0 6px #10b981;"></span> Live Feed
          </span>
          <span id="lbl-history-count" style="font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 12px; background: rgba(0, 113, 227, 0.12); color: var(--accent-color);">0 records (24h)</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
          <select id="filter-timerange" class="input-text" style="padding: 4px 8px; font-size: 11px; font-weight: 600;" onchange="window.__lastEventsSig = ''; fetchData()">
            <option value="24h" selected>Last 24 Hours (All)</option>
            <option value="12h">Last 12 Hours</option>
            <option value="6h">Last 6 Hours</option>
            <option value="1h">Last 1 Hour</option>
            <option value="ALL">All Recorded History</option>
          </select>
          <select id="filter-account" class="input-text" style="padding: 4px 8px; font-size: 11px;" onchange="window.__lastEventsSig = ''; fetchData()">
            <option value="CURRENT">Current Target</option>
            <option value="ALL">All Profiles</option>
          </select>
          <select id="filter-state" class="input-text" style="padding: 4px 8px; font-size: 11px;" onchange="window.__lastEventsSig = ''; fetchData()">
            <option value="ALL">All States</option>
            <option value="VISIBLE">Visible Only</option>
            <option value="UNAVAILABLE">Unavailable Only</option>
            <option value="UNKNOWN">Unknown Only</option>
          </select>
          <label style="font-size: 11px; display: flex; align-items: center; gap: 4px; cursor: pointer;">
            <input type="checkbox" id="check-transitions-only" onchange="window.__lastEventsSig = ''; fetchData()"> Transitions Only
          </label>
          <button class="btn btn-secondary" style="font-size: 11px; padding: 4px 10px;" onclick="window.__lastEventsSig = ''; fetchData()">Refresh</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time (Dhaka)</th>
              <th>Account</th>
              <th>Observation</th>
              <th>Previous</th>
              <th>Transition</th>
              <th>Duration</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody id="history-tbody">
            <tr><td colspan="7" class="empty">Loading observation records...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>

  <div id="toast"></div>

  <script>
    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    let activeScheduleMode = 'FIXED';
    let isDaemonRunning = false;
    let isDaemonPaused = false;
    let latestNextCheckUtc = null;
    let isCheckInFlight = false;

    function updateCountdownTimer() {
      const pill = document.getElementById('countdown-pill');
      const txtHdr = document.getElementById('txt-countdown-hdr');
      const badgeLive = document.getElementById('badge-countdown-live');
      const subEl = document.getElementById('metric-countdown-sub');

      if (!isDaemonRunning || isDaemonPaused || !latestNextCheckUtc) {
        if (pill) pill.style.display = 'none';
        if (badgeLive) badgeLive.style.display = 'none';
        if (subEl) {
          subEl.style.color = 'var(--text-secondary)';
          subEl.textContent = isDaemonPaused ? 'Paused' : (isDaemonRunning ? 'Scheduling next check...' : 'Monitoring stopped');
        }
        return;
      }

      const targetMs = new Date(latestNextCheckUtc).getTime();
      const nowMs = Date.now();
      const diffSec = Math.ceil((targetMs - nowMs) / 1000);

      if (diffSec <= 0 || isCheckInFlight) {
        if (pill) {
          pill.style.display = 'flex';
          pill.style.background = 'rgba(255, 149, 0, 0.12)';
          pill.style.borderColor = 'rgba(255, 149, 0, 0.35)';
          pill.style.color = 'var(--warning-color)';
        }
        if (txtHdr) txtHdr.textContent = 'Observing target now...';

        if (badgeLive) {
          badgeLive.style.display = 'inline-block';
          badgeLive.style.background = 'rgba(255, 149, 0, 0.15)';
          badgeLive.style.color = 'var(--warning-color)';
          badgeLive.textContent = 'CHECKING';
        }
        if (subEl) {
          subEl.style.color = 'var(--warning-color)';
          subEl.textContent = '⚡ Checking target now...';
        }
      } else {
        let countdownStr = '';
        if (diffSec >= 60) {
          const m = Math.floor(diffSec / 60);
          const s = diffSec % 60;
          countdownStr = \`\${m}m \${s < 10 ? '0' : ''}\${s}s (\${diffSec}s)\`;
        } else {
          countdownStr = \`\${diffSec}s\`;
        }

        if (pill) {
          pill.style.display = 'flex';
          pill.style.background = 'rgba(0, 113, 227, 0.08)';
          pill.style.borderColor = 'rgba(0, 113, 227, 0.25)';
          pill.style.color = 'var(--accent-color)';
        }
        if (txtHdr) txtHdr.textContent = \`Next fetch in \${diffSec}s\`;

        if (badgeLive) {
          badgeLive.style.display = 'inline-block';
          badgeLive.style.background = 'rgba(0, 113, 227, 0.12)';
          badgeLive.style.color = 'var(--accent-color)';
          badgeLive.textContent = \`in \${diffSec}s\`;
        }
        if (subEl) {
          subEl.style.color = 'var(--accent-color)';
          subEl.textContent = \`Next fetch in \${countdownStr}\`;
        }
      }
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.style.display = 'block';
      setTimeout(() => t.style.display = 'none', 3500);
    }

    function formatSecToMinSec(sec) {
      const s = parseInt(sec, 10) || 0;
      const m = Math.floor(s / 60);
      const rem = s % 60;
      return \`\${s}s (\${m}m \${rem}s)\`;
    }

    function selectScheduleMode(mode) {
      activeScheduleMode = mode;
      document.getElementById('btn-mode-fixed').className = mode === 'FIXED' ? 'seg-btn active' : 'seg-btn';
      document.getElementById('btn-mode-random').className = mode === 'RANDOM_RANGE' ? 'seg-btn active' : 'seg-btn';
      document.getElementById('controls-fixed').style.display = mode === 'FIXED' ? 'flex' : 'none';
      document.getElementById('controls-random').style.display = mode === 'RANDOM_RANGE' ? 'flex' : 'none';
      validateRandomBounds();
    }

    function syncFixedFromSlider(val) {
      document.getElementById('num-fixed').value = val;
      document.getElementById('lbl-fixed-cadence').textContent = \`Every \${val} minutes\`;
    }

    function syncFixedFromNumber(val) {
      const clamped = Math.max(3, Math.min(60, parseInt(val, 10) || 3));
      document.getElementById('slider-fixed').value = clamped;
      document.getElementById('lbl-fixed-cadence').textContent = \`Every \${clamped} minutes\`;
    }

    function syncRandomMinFromSlider(val) {
      document.getElementById('num-random-min').value = val;
      document.getElementById('lbl-random-min').textContent = formatSecToMinSec(val);
      validateRandomBounds();
    }

    function syncRandomMinFromNumber(val) {
      const v = parseInt(val, 10) || 60;
      document.getElementById('slider-random-min').value = v;
      document.getElementById('lbl-random-min').textContent = formatSecToMinSec(v);
      validateRandomBounds();
    }

    function syncRandomMaxFromSlider(val) {
      document.getElementById('num-random-max').value = val;
      document.getElementById('lbl-random-max').textContent = formatSecToMinSec(val);
      validateRandomBounds();
    }

    function syncRandomMaxFromNumber(val) {
      const v = parseInt(val, 10) || 180;
      document.getElementById('slider-random-max').value = v;
      document.getElementById('lbl-random-max').textContent = formatSecToMinSec(v);
      validateRandomBounds();
    }

    function validateRandomBounds() {
      if (activeScheduleMode !== 'RANDOM_RANGE') {
        document.getElementById('range-validation-msg').style.display = 'none';
        document.getElementById('btn-apply-schedule').disabled = false;
        return true;
      }
      const min = parseInt(document.getElementById('num-random-min').value, 10) || 60;
      const max = parseInt(document.getElementById('num-random-max').value, 10) || 180;
      const isInvalid = min > max || min < 60 || max > 180;
      const errorEl = document.getElementById('range-validation-msg');
      if (isInvalid) {
        errorEl.textContent = min > max ? 'Minimum interval bound cannot be greater than maximum bound.' : 'Bounds must be between 60s and 180s.';
        errorEl.style.display = 'block';
        document.getElementById('btn-apply-schedule').disabled = true;
        return false;
      }
      errorEl.style.display = 'none';
      document.getElementById('btn-apply-schedule').disabled = false;
      return true;
    }

    async function fetchData() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();

        isDaemonRunning = data.running;
        isDaemonPaused = data.state && data.state.monitoringStatus === 'PAUSED';
        latestNextCheckUtc = (data.state && data.state.nextScheduledCheckAt) ? data.state.nextScheduledCheckAt : null;
        isCheckInFlight = Boolean(data.state && data.state.activeCheckId);
        updateCountdownTimer();

        // Status Pill
        const dot = document.getElementById('dot');
        const txt = document.getElementById('txt-status');
        if (isDaemonRunning) {
          if (isDaemonPaused) {
            dot.className = 'dot paused';
            txt.textContent = 'Paused';
          } else {
            dot.className = 'dot running';
            txt.textContent = 'Running';
          }
        } else {
          dot.className = 'dot';
          txt.textContent = 'Stopped';
        }

        document.getElementById('btn-start').disabled = isDaemonRunning;
        document.getElementById('btn-pause').disabled = !isDaemonRunning;
        document.getElementById('btn-pause').textContent = isDaemonPaused ? 'Resume' : 'Pause';
        document.getElementById('btn-stop').disabled = !isDaemonRunning;

        // Metrics
        const obs = data.state.currentObservation || 'UNKNOWN';
        const badgeEl = document.getElementById('metric-obs');
        badgeEl.textContent = obs;
        badgeEl.className = 'badge ' + (obs === 'VISIBLE' ? 'badge-visible' : (obs === 'UNAVAILABLE' ? 'badge-unavailable' : 'badge-unknown'));

        document.getElementById('metric-attempt').textContent = data.lastAttemptFormatted || '—';
        document.getElementById('metric-next').textContent = data.nextCheckFormatted || (isDaemonRunning && !isDaemonPaused ? 'Scheduling...' : '—');
        
        // Target Labels
        const targetHandle = '@' + (data.config.targetUsername || 'unknown');
        document.getElementById('hdr-target').textContent = targetHandle;
        document.getElementById('lbl-active-target').textContent = targetHandle;

        // Session Health
        const health = data.state.sessionHealth || 'OK';
        const healthEl = document.getElementById('metric-health');
        healthEl.textContent = health;
        healthEl.className = 'badge ' + (health === 'OK' ? 'badge-health-ok' : 'badge-health-warn');

        // Mode Display
        const mode = data.config.scheduleMode || 'FIXED';
        const modeDesc = mode === 'FIXED'
          ? \`FIXED (\${data.config.fixedIntervalMinutes || 3}m)\`
          : \`RANDOM (\${data.config.randomMinSeconds || 60}s–\${data.config.randomMaxSeconds || 180}s)\`;
        document.getElementById('metric-mode').textContent = modeDesc;
        document.getElementById('hdr-schedule').textContent = modeDesc;

        // Delay & Process
        const delayMs = data.state.lastScheduledDelayMs;
        document.getElementById('metric-delay').textContent = delayMs ? \`\${Math.round(delayMs / 1000)}s\` : '—';
        document.getElementById('metric-process').textContent = data.pid ? \`PID \${data.pid}\` : '—';

        // History Table (Conditional fetch only on state/filter changes)
        const stateFilter = document.getElementById('filter-state').value;
        const accountFilter = document.getElementById('filter-account') ? document.getElementById('filter-account').value : 'CURRENT';
        const transitionOnly = document.getElementById('check-transitions-only').checked;
        const timeRange = document.getElementById('filter-timerange') ? document.getElementById('filter-timerange').value : '24h';
        const currentFilterSig = \`\${stateFilter}:\${accountFilter}:\${transitionOnly}:\${timeRange}\`;
        const currentStatusSig = \`\${data.state.lastAttemptAt || ''}:\${data.state.lastSuccessfulCheckAt || ''}:\${data.state.currentObservation || ''}:\${data.state.monitoringStatus || ''}\`;

        const shouldFetchHistory = !window.__historyLoaded || window.__lastFilterSig !== currentFilterSig || window.__lastStatusSig !== currentStatusSig;

        if (shouldFetchHistory) {
          window.__historyLoaded = true;
          window.__lastFilterSig = currentFilterSig;
          window.__lastStatusSig = currentStatusSig;

          const histRes = await fetch(\`/api/history?state=\${stateFilter}&username=\${accountFilter}&transitionOnly=\${transitionOnly}&timeRange=\${timeRange}\`);
          const events = await histRes.json();
          const tbody = document.getElementById('history-tbody');

          const countBadge = document.getElementById('lbl-history-count');
          if (countBadge && Array.isArray(events)) {
            const rangeLabel = timeRange === '24h' ? 'Last 24h' : (timeRange === 'ALL' ? 'All Time' : timeRange);
            countBadge.textContent = \`\${events.length} record\${events.length === 1 ? '' : 's'} (\${rangeLabel})\`;
          }

          const newEventsSig = (events || []).map((e) => e.id + e.observedState + (e.reason || '')).join('|');
          if (window.__lastEventsSig !== newEventsSig) {
            window.__lastEventsSig = newEventsSig;
            tbody.innerHTML = '';

            if (!events || events.length === 0) {
              tbody.innerHTML = '<tr><td colspan="7" class="empty">No events match the selected filters.</td></tr>';
              return;
            }

            const reversed = [...events].reverse();
            for (const e of reversed) {
              const tr = document.createElement('tr');
              const badgeClass = e.observedState === 'VISIBLE' ? 'badge-visible' : (e.observedState === 'UNAVAILABLE' ? 'badge-unavailable' : 'badge-unknown');
              const isCurrent = (e.username || '').toLowerCase() === (data.config.targetUsername || '').toLowerCase();
              tr.innerHTML = \`
                <td>\${escapeHtml(e.timeFormatted || e.timestampUtc)}</td>
                <td><strong>@\${escapeHtml(e.username)}</strong>\${isCurrent ? ' <span style="font-size:9px;color:var(--primary);background:rgba(59,130,246,0.12);padding:1px 5px;border-radius:4px;font-weight:600;">ACTIVE</span>' : ''}</td>
                <td><span class="badge \${badgeClass}">\${escapeHtml(e.observedState)}</span></td>
                <td>\${escapeHtml(e.previousReliableState || '—')}</td>
                <td style="font-weight:\${e.isTransition ? '700;color:var(--warning-color)' : 'normal'}">\${e.isTransition ? 'YES' : 'NO'}</td>
                <td>\${Number(e.checkDurationMs) || 0} ms</td>
                <td>\${escapeHtml((e.reason || '').slice(0, 45))}</td>
              \`;
              tbody.appendChild(tr);
            }
          }
        }
      } catch (err) {
        console.error(err);
      }
    }

    async function applyTarget() {
      const input = document.getElementById('input-target-user');
      const val = input.value.trim();
      if (!val) {
        showToast('Please enter an Instagram username or URL');
        return;
      }
      const btn = document.getElementById('btn-apply-target');
      btn.disabled = true;
      btn.textContent = 'Switching & Checking...';
      try {
        const res = await fetch('/api/settings/target', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: val })
        });
        const data = await res.json();
        if (data.success) {
          const obsDesc = data.observation ? \` (\${data.observation.state})\` : '';
          showToast(\`✓ Target set to @\${data.targetUsername}\${obsDesc}\`);
          input.value = '';
          window.__lastEventsSig = '';
          await fetchData();
        } else {
          showToast(\`✗ Failed: \${data.error || 'Invalid target'}\`);
        }
      } catch (err) {
        showToast(\`✗ Error: \${err.message}\`);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Apply Target';
      }
    }

    async function applyScheduleSettings() {
      if (!validateRandomBounds()) return;
      const btn = document.getElementById('btn-apply-schedule');
      btn.disabled = true;

      const payload = {
        scheduleMode: activeScheduleMode,
        fixedIntervalMinutes: parseInt(document.getElementById('num-fixed').value, 10),
        randomMinSeconds: parseInt(document.getElementById('num-random-min').value, 10),
        randomMaxSeconds: parseInt(document.getElementById('num-random-max').value, 10)
      };

      try {
        const res = await fetch('/api/settings/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
          showToast(\`✓ Schedule updated: \${data.message}\`);
          fetchData();
        } else {
          showToast(\`✗ Failed: \${data.error}\`);
        }
      } catch (err) {
        showToast(\`✗ Error: \${err.message}\`);
      } finally {
        btn.disabled = false;
      }
    }

    async function startMonitor() {
      document.getElementById('btn-start').disabled = true;
      const res = await fetch('/api/start', { method: 'POST' });
      const data = await res.json();
      showToast(data.message || 'Started background monitor');
      fetchData();
    }

    async function togglePause() {
      const endpoint = isDaemonPaused ? '/api/resume' : '/api/pause';
      const res = await fetch(endpoint, { method: 'POST' });
      const data = await res.json();
      showToast(data.message);
      fetchData();
    }

    async function stopMonitor() {
      document.getElementById('btn-stop').disabled = true;
      const res = await fetch('/api/stop', { method: 'POST' });
      const data = await res.json();
      showToast(data.message || 'Stopped monitor');
      fetchData();
    }

    async function checkNow() {
      const btn = document.getElementById('btn-check');
      btn.disabled = true;
      btn.textContent = 'Observing target...';
      try {
        const res = await fetch('/api/check', { method: 'POST' });
        const data = await res.json();
        if (data.success && data.observation) {
          showToast(\`✓ Check: \${data.observation.state} (\${data.observation.confidence} confidence) in \${data.checkDurationMs || 0}ms\`);
        } else {
          showToast('Check: ' + (data.message || data.error || 'Done'));
        }
      } catch (err) {
        showToast(\`✗ Check error: \${err.message}\`);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Check Status Now';
        window.__lastEventsSig = '';
        await fetchData();
      }
    }

    async function testTelegram() {
      showToast('Sending test message to Telegram...');
      const res = await fetch('/api/test-telegram', { method: 'POST' });
      const data = await res.json();
      showToast(data.ok ? '✓ Test notification delivered to Telegram!' : '✗ Failed: ' + data.error);
    }

    function exportCsv() {
      const stateFilter = document.getElementById('filter-state').value;
      const accountFilter = document.getElementById('filter-account') ? document.getElementById('filter-account').value : 'CURRENT';
      const transitionOnly = document.getElementById('check-transitions-only').checked;
      const timeRange = document.getElementById('filter-timerange') ? document.getElementById('filter-timerange').value : '24h';
      window.location.href = \`/api/export?state=\${stateFilter}&username=\${accountFilter}&transitionOnly=\${transitionOnly}&timeRange=\${timeRange}\`;
    }

    // Initialize
    fetchData();
    setInterval(fetchData, 3000);
    setInterval(updateCountdownTimer, 1000);
  </script>
</body>
</html>`;
}

export function getLoginHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign In - Instagram Monitor</title>
  <style>
    :root {
      --bg-primary: #f5f5f7;
      --bg-card: #ffffff;
      --border-color: #e5e5ea;
      --text-primary: #1c1c1e;
      --text-secondary: #8e8e93;
      --accent-color: #0071e3;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg-primary: #1c1c1e;
        --bg-card: #2c2c2e;
        --border-color: #38383a;
        --text-primary: #f5f5f7;
        --text-secondary: #98989d;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg-primary); color: var(--text-primary); display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 16px; padding: 32px; width: 100%; max-width: 380px; box-shadow: 0 8px 30px rgba(0,0,0,0.08); text-align: center; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
    p { font-size: 14px; color: var(--text-secondary); margin-bottom: 24px; }
    input { width: 100%; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); font-size: 15px; margin-bottom: 16px; outline: none; }
    input:focus { border-color: var(--accent-color); }
    button { width: 100%; padding: 12px; border-radius: 10px; border: none; background: var(--accent-color); color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
    .error { color: #ff3b30; font-size: 13px; margin-top: 12px; display: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Instagram Monitor</h1>
    <p>Enter the admin password to access the dashboard</p>
    <form id="login-form">
      <input type="password" id="pw" placeholder="Admin Password" required autofocus />
      <button type="submit">Unlock Dashboard</button>
      <div id="err" class="error"></div>
    </form>
  </div>
  <script>
    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault();
      const err = document.getElementById('err');
      err.style.display = 'none';
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: document.getElementById('pw').value })
        });
        const data = await res.json();
        if (data.ok) {
          window.location.reload();
        } else {
          err.innerText = data.error || 'Invalid password';
          err.style.display = 'block';
        }
      } catch (e) {
        err.innerText = 'Network error: ' + e.message;
        err.style.display = 'block';
      }
    };
  </script>
</body>
</html>`;
}

/**
 * Validates incoming request Host and Origin headers to protect local endpoints.
 * @param {http.IncomingMessage} req
 * @returns {boolean}
 */
function isAuthorizedOrigin(req, activePort = PORT, allowedHosts = []) {
  return isAuthorizedHostOrProxy(req, activePort, allowedHosts);
}

/**
 * Reads request body safely with payload size cap.
 * @param {http.IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytesRead = 0;

    req.on('data', (chunk) => {
      bytesRead += chunk.length;
      if (bytesRead > MAX_PAYLOAD_BYTES) {
        req.destroy();
        reject(new Error('Payload too large (exceeds 100KB)'));
        return;
      }
      body += chunk;
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const loginAttempts = new Map();

export function startGuiServer(options = {}) {
  const autoOpen = options.autoOpenBrowser !== false;
  const port = options.port || PORT;
  const allowedHosts = options.allowedHosts || (process.env.ALLOWED_HOSTS ? process.env.ALLOWED_HOSTS.split(',').map((s) => s.trim()) : []);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`);

    const sendJson = (obj, status = 200) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify(obj));
    };

    // 1. Host & Proxy Validation
    if (!isAuthorizedOrigin(req, port, allowedHosts)) {
      sendJson({ error: 'Forbidden: Unauthorized Host or Origin' }, 403);
      return;
    }

    // 1b. CSRF Check for mutation methods
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      const origin = req.headers.origin;
      const referer = req.headers.referer;
      if (origin || referer) {
        const source = (origin || referer).toLowerCase();
        const isLocal = source.startsWith(`http://localhost:${port}`) ||
                        source.startsWith(`http://127.0.0.1:${port}`) ||
                        source.startsWith(`http://[::1]:${port}`) ||
                        source.startsWith(`https://localhost:${port}`) ||
                        source.startsWith(`https://127.0.0.1:${port}`) ||
                        source.startsWith(`https://[::1]:${port}`);
        let isAllowed = isLocal;
        if (!isAllowed) {
          try {
            const parsedSource = new URL(source);
            const sourceHost = parsedSource.hostname.toLowerCase();
            for (const h of allowedHosts) {
              const cleanH = h.toLowerCase().split(':')[0];
              if (cleanH === '*' || sourceHost === cleanH || sourceHost.endsWith('.' + cleanH)) {
                isAllowed = true;
                break;
              }
            }
          } catch {
            isAllowed = false;
          }
        }
        if (!isAllowed) {
          sendJson({ error: 'Forbidden: Invalid CSRF Origin' }, 403);
          return;
        }
      }
    }

    // 2. Authentication Check
    const auth = authenticateRequest(req);

    // 2a. Login API (with brute-force rate limit protection)
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const clientIp = req.socket?.remoteAddress || 'unknown';
      const now = Date.now();
      const attemptInfo = loginAttempts.get(clientIp) || { count: 0, lockedUntil: 0 };

      if (attemptInfo.lockedUntil > now) {
        const remainingSec = Math.ceil((attemptInfo.lockedUntil - now) / 1000);
        sendJson({ error: `Too many failed login attempts. Please wait ${remainingSec}s.` }, 429);
        return;
      }

      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw || '{}');
        if (verifyPassword(parsed.password)) {
          loginAttempts.delete(clientIp);
          const token = createSessionToken();
          const isHttps = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Set-Cookie': `monitor_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${isHttps ? '; Secure' : ''}`,
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'strict-origin-when-cross-origin'
          });
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        attemptInfo.count = (attemptInfo.count || 0) + 1;
        if (attemptInfo.count >= 5) {
          attemptInfo.lockedUntil = now + 60000; // 60-second cooldown
        }
        loginAttempts.set(clientIp, attemptInfo);

        sendJson({ error: 'Invalid password' }, 401);
        return;
      } catch {
        sendJson({ error: 'Failed to process login' }, 400);
        return;
      }
    }

    // 2b. Logout API
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': 'monitor_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // 2c. Auth Status API
    if (url.pathname === '/api/auth/status' && req.method === 'GET') {
      sendJson({
        authenticated: auth.authenticated,
        required: getAuthConfig().required
      });
      return;
    }

    // 2d. Healthcheck API (Docker & Cloud Watchdog)
    if (url.pathname === '/healthz' && req.method === 'GET') {
      const runningInfo = checkDaemonRunning();
      const state = getDaemonState();
      const mem = process.memoryUsage();
      sendJson({
        status: 'ok',
        uptime: Math.round(process.uptime()),
        memoryRssMb: Math.round(mem.rss / (1024 * 1024)),
        memoryHeapMb: Math.round(mem.heapUsed / (1024 * 1024)),
        monitoringRunning: runningInfo.running,
        lastObservedState: state.currentObservation || 'UNKNOWN',
        sessionHealth: state.sessionHealth || 'OK'
      });
      return;
    }

    // 2e. Enforce Authentication on all subsequent routes
    if (!auth.authenticated) {
      if (url.pathname === '/' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Content-Security-Policy': "default-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:;"
        });
        res.end(getLoginHtml());
        return;
      }
      sendJson({ error: 'Unauthorized: Authentication required' }, 401);
      return;
    }

    // 3. HTML View
    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy': "default-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:;"
      });
      res.end(getDashboardHtml());
      return;
    }

    // 3. Status API (Sanitized - Never exposes Telegram Token!)
    if (url.pathname === '/api/status' && req.method === 'GET') {
      const runningInfo = checkDaemonRunning();
      const config = loadDaemonConfig();
      const state = getDaemonState();
      const sanitizedConfig = sanitizeConfigForClient(config);

      sendJson({
        running: runningInfo.running,
        pid: runningInfo.pid,
        config: sanitizedConfig,
        state,
        lastAttemptFormatted: state.lastAttemptAt ? formatDhakaDateTime(state.lastAttemptAt, { includeSeconds: true }) : '—',
        nextCheckFormatted: state.nextScheduledCheckAt ? formatDhakaTime(state.nextScheduledCheckAt) : '—'
      });
      return;
    }

    // 4. Diagnostics API
    if (url.pathname === '/api/diagnostics' && req.method === 'GET') {
      const schedulerStatus = getSchedulerStatus();
      const audits = readDaemonAuditEvents({ limit: 10 });
      sendJson({
        scheduler: schedulerStatus,
        recentAudits: audits
      });
      return;
    }

    // 4b. Session Status & Import API (Cross-Platform Headless Onboarding)
    if (url.pathname === '/api/session/status' && req.method === 'GET') {
      sendJson(getSessionStatus());
      return;
    }

    if (url.pathname === '/api/session/import' && req.method === 'POST') {
      try {
        const raw = await readBody(req);
        const parsed = JSON.parse(raw || '{}');
        const input = parsed.cookies || parsed.sessionData || parsed;
        let resImport = null;
        if (typeof input === 'object' && input !== null && Array.isArray(input.cookies)) {
          resImport = importStorageState(input);
        } else if (typeof input === 'string' && input.trim().startsWith('{')) {
          resImport = importStorageState(input);
        } else {
          resImport = importRawCookies(input);
        }
        if (resImport.ok) {
          sendJson({ ok: true, count: resImport.count });
        } else {
          sendJson({ error: resImport.error || 'Failed to import session' }, 400);
        }
        return;
      } catch (err) {
        sendJson({ error: 'Invalid payload: ' + err.message }, 400);
        return;
      }
    }

    // 5. History API with Filters & Rolling Time Windows (Default: 24h rolling retention)
    if (url.pathname === '/api/history' && req.method === 'GET') {
      const stateFilter = url.searchParams.get('state') || 'ALL';
      const transitionOnly = url.searchParams.get('transitionOnly') === 'true';
      let usernameFilter = url.searchParams.get('username') || 'ALL';
      const timeRange = url.searchParams.get('timeRange') || '24h';

      let withinHours = 24; // Default to full 24-hour window
      if (timeRange === '12h') withinHours = 12;
      else if (timeRange === '6h') withinHours = 6;
      else if (timeRange === '1h') withinHours = 1;
      else if (timeRange === 'ALL') withinHours = undefined;

      const limitParam = url.searchParams.get('limit');
      const limit = (limitParam && limitParam !== 'all' && limitParam !== '0') ? parseInt(limitParam, 10) : undefined;

      if (usernameFilter === 'CURRENT') {
        const cfg = loadDaemonConfig();
        usernameFilter = cfg.targetUsername || 'ALL';
      }

      const events = readDaemonEvents({
        stateFilter,
        transitionOnly,
        usernameFilter,
        withinHours,
        limit
      });

      const formatted = events.map((e) => ({
        ...e,
        timeFormatted: formatDhakaDateTime(e.timestampUtc, { includeSeconds: true })
      }));
      sendJson(formatted);
      return;
    }

    // 6. Update Target Username API
    if ((url.pathname === '/api/settings/target' || url.pathname === '/api/target') && req.method === 'POST') {
      try {
        const rawBody = await readBody(req);
        const parsed = JSON.parse(rawBody || '{}');
        const input = parsed.username || '';
        const clean = normalizeUsername(input);

        if (!clean || !validateUsername(clean)) {
          sendJson({ error: `Invalid Instagram handle: "${input}". Handles must be 1-30 characters using letters, numbers, periods, or underscores.` }, 400);
          return;
        }

        const targetUrl = buildProfileUrl(clean);
        saveDaemonConfig({ targetUsername: clean, targetUrl });

        // Reset comparison baseline under Rule I
        saveDaemonState({
          currentAccount: clean,
          lastReliableState: null,
          lastReliableObservedAt: null,
          previousReliableState: null,
          lastTransitionAt: null,
          currentObservation: 'UNKNOWN'
        });

        appendDaemonAuditEvent(AuditEventType.TARGET_CHANGED, {
          newUsername: clean,
          targetUrl
        });

        appendDaemonEvent({
          username: clean,
          observedState: 'UNKNOWN',
          previousReliableState: null,
          confidence: 'HIGH',
          reason: `Target profile switched to @${clean} (baseline reset)`,
          source: 'dashboard-target-switch',
          checkDurationMs: 0,
          isTransition: false,
          notificationStatus: 'SKIPPED'
        });

        // Trigger immediate observation check for the new target
        const status = checkDaemonRunning();
        let observationResult = null;

        if (status.running && status.pid !== process.pid) {
          const ipcRes = await sendDaemonCommand('SWITCH_TARGET', { targetUsername: clean, targetUrl }, 12000);
          if (ipcRes.success && ipcRes.result) {
            observationResult = ipcRes.result;
          }
        } else {
          observationResult = await runObservationCycle(loadDaemonConfig());
          if (!status.running) {
            await closeBrowser();
          } else {
            reschedule(loadDaemonConfig());
          }
        }

        sendJson({
          success: true,
          targetUsername: clean,
          targetUrl,
          observation: observationResult?.observation || null,
          checkDurationMs: observationResult?.checkDurationMs || 0,
          message: observationResult?.observation
            ? `Target switched to @${clean} (Observed: ${observationResult.observation.state})`
            : `Target switched to @${clean}`
        });
      } catch (err) {
        sendJson({ error: err.message }, 500);
      }
      return;
    }

    // 7. Update Scheduling Settings API (Fixed or Random Range)
    if (url.pathname === '/api/settings/schedule' && req.method === 'POST') {
      try {
        const rawBody = await readBody(req);
        const parsed = JSON.parse(rawBody || '{}');

        const validation = validateScheduleConfig(parsed);
        if (!validation.valid) {
          sendJson({ error: validation.errors.join('; ') }, 400);
          return;
        }

        const updates = {
          scheduleMode: parsed.scheduleMode
        };

        if (parsed.scheduleMode === ScheduleMode.FIXED) {
          updates.fixedIntervalMinutes = parsed.fixedIntervalMinutes;
        } else if (parsed.scheduleMode === ScheduleMode.RANDOM_RANGE) {
          updates.randomMinSeconds = parsed.randomMinSeconds;
          updates.randomMaxSeconds = parsed.randomMaxSeconds;
        }

        const updatedConfig = saveDaemonConfig(updates);
        appendDaemonAuditEvent(AuditEventType.SCHEDULE_CHANGED, updates);
        const status = checkDaemonRunning();
        let rescheduleResult = null;

        if (status.running) {
          const ipcRes = await sendDaemonCommand('RESCHEDULE', updates, 3000);
          rescheduleResult = ipcRes.result || { delaySeconds: 0 };
        } else {
          rescheduleResult = reschedule(updatedConfig);
        }

        sendJson({
          success: true,
          config: sanitizeConfigForClient(updatedConfig),
          reschedule: rescheduleResult,
          message: `Mode: ${updatedConfig.scheduleMode} (Next check in ~${rescheduleResult.delaySeconds}s)`
        });
      } catch (err) {
        sendJson({ error: err.message }, 500);
      }
      return;
    }

    // 8. Process Control APIs
    if (url.pathname === '/api/start' && req.method === 'POST') {
      const status = checkDaemonRunning();
      if (status.running) {
        sendJson({ message: `Monitoring is already running with PID ${status.pid}` });
        return;
      }

      logger.info('Server', 'Starting independent background monitoring daemon...');
      if (process.platform === 'win32') {
        const vbsPath = path.resolve('scripts/run-background.vbs');
        spawn('wscript.exe', [vbsPath], {
          cwd: path.resolve('.'),
          detached: true,
          stdio: 'ignore'
        }).unref();
      } else {
        const cliScript = path.resolve('daemon/cli.js');
        const logFd = fs.openSync(path.resolve('data/daemon.log'), 'a');
        spawn(process.execPath, [cliScript, 'start', '--foreground'], {
          cwd: path.resolve('.'),
          detached: true,
          stdio: ['ignore', logFd, logFd]
        }).unref();
      }

      // Wait up to 3 seconds for lock file
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 200));
        if (checkDaemonRunning().running) break;
      }

      sendJson({ message: 'Background monitoring daemon started successfully' });
      return;
    }

    if (url.pathname === '/api/stop' && req.method === 'POST') {
      const status = checkDaemonRunning();
      if (status.running) {
        if (status.pid === process.pid) {
          // Running in-process inside server.js
          await stopDaemon();
        } else {
          try {
            await sendDaemonCommand('STOP', {}, 2000);
          } catch {}
          await new Promise((r) => setTimeout(r, 400));
          if (checkDaemonRunning().running) {
            try {
              process.kill(status.pid, 'SIGTERM');
            } catch {}
          }
          releaseDaemonLock();
          saveDaemonState({ monitoringStatus: 'STOPPED', nextScheduledCheckAt: null });
        }
      } else {
        await stopDaemon();
      }
      sendJson({ message: 'Monitoring stopped' });
      return;
    }

    if (url.pathname === '/api/pause' && req.method === 'POST') {
      const status = checkDaemonRunning();
      if (status.running && status.pid !== process.pid) {
        await sendDaemonCommand('PAUSE', { reason: 'User paused from dashboard' }, 3000);
      } else {
        pauseMonitoring('User paused from dashboard');
      }
      sendJson({ message: 'Monitoring paused' });
      return;
    }

    if (url.pathname === '/api/resume' && req.method === 'POST') {
      const status = checkDaemonRunning();
      if (status.running && status.pid !== process.pid) {
        await sendDaemonCommand('RESUME', {}, 3000);
      } else {
        resumeMonitoring();
      }
      sendJson({ message: 'Monitoring resumed' });
      return;
    }

    if (url.pathname === '/api/check' && req.method === 'POST') {
      const status = checkDaemonRunning();
      let result = null;
      if (status.running && status.pid !== process.pid) {
        const ipcRes = await sendDaemonCommand('CHECK_NOW', {}, 12000);
        if (ipcRes.success && ipcRes.result) {
          result = ipcRes.result;
        } else {
          sendJson({
            success: false,
            error: ipcRes.error || 'Failed to dispatch check to running daemon'
          }, 500);
          return;
        }
      } else {
        const config = loadDaemonConfig();
        result = await runObservationCycle(config);
        if (!status.running) {
          await closeBrowser();
        } else {
          reschedule(config);
        }
      }
      sendJson({
        success: true,
        observation: result?.observation,
        checkDurationMs: result?.checkDurationMs || 0,
        sessionHealth: result?.sessionHealth,
        nextScheduledCheckAt: result?.nextScheduledCheckAt
      });
      return;
    }

    // 9. Telegram Alert Test API
    if (url.pathname === '/api/test-telegram' && req.method === 'POST') {
      const config = loadDaemonConfig();
      if (!config.telegramBotToken || !config.telegramChatId) {
        sendJson({ ok: false, error: 'Telegram Bot Token or Chat ID not configured.' }, 400);
        return;
      }
      const testRes = await testTelegramConnection(
        config.telegramBotToken,
        config.telegramChatId,
        config.targetUsername
      );
      sendJson(testRes);
      return;
    }

    // 10. CSV Export API (Respects 24h rolling window by default)
    if (url.pathname === '/api/export' && req.method === 'GET') {
      const stateFilter = url.searchParams.get('state') || 'ALL';
      const transitionOnly = url.searchParams.get('transitionOnly') === 'true';
      let usernameFilter = url.searchParams.get('username') || 'ALL';
      const timeRange = url.searchParams.get('timeRange') || '24h';

      let withinHours = 24;
      if (timeRange === '12h') withinHours = 12;
      else if (timeRange === '6h') withinHours = 6;
      else if (timeRange === '1h') withinHours = 1;
      else if (timeRange === 'ALL') withinHours = undefined;

      if (usernameFilter === 'CURRENT') {
        const cfg = loadDaemonConfig();
        usernameFilter = cfg.targetUsername || 'ALL';
      }
      const events = readDaemonEvents({ stateFilter, transitionOnly, usernameFilter, withinHours });

      const outputPath = path.resolve('data/history.csv');
      exportDaemonEventsToCsv(events, outputPath);
      const fileData = fs.readFileSync(outputPath, 'utf-8');

      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="instagram_visibility_history.csv"'
      });
      res.end(fileData);
      return;
    }

    sendJson({ error: 'Not Found' }, 404);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error('Server', `Port ${port} is already in use by another process.`);
      logger.error('Server', `Run 'stop.bat' or use 'gui.bat' to cleanly clear stale processes.`);
      process.exit(1);
    } else {
      logger.error('Server', `Server encountered error: ${err.message}`);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const dashboardUrl = `http://localhost:${port}/`;
    logger.info('Server', `Dashboard active on ${dashboardUrl} (bound strictly to 127.0.0.1)`);

    if (autoOpen) {
      // Attempt to open in Chrome App Mode on Windows
      const winChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
      if (process.platform === 'win32' && fs.existsSync(winChrome)) {
        exec(`"${winChrome}" --app=${dashboardUrl}`);
      } else {
        const startCmd = process.platform === 'win32' ? `start ${dashboardUrl}` : `xdg-open ${dashboardUrl}`;
        exec(startCmd);
      }
    }
  });

  return server;
}

// Auto-run if executed as script
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const autoOpen = !process.argv.includes('--no-open') && !process.env.NO_OPEN;
  const withScheduler = process.argv.includes('--with-scheduler') || process.env.WITH_SCHEDULER === 'true';
  const server = startGuiServer({ autoOpenBrowser: autoOpen });

  if (withScheduler) {
    logger.info('Server', 'Starting unified background daemon scheduler in-process...');
    startDaemon({ singleRun: false, registerSignalHandlers: false }).catch((err) => {
      logger.error('Server', 'Failed to start integrated scheduler', err.message);
    });
  }

  const cleanup = async (sig) => {
    logger.info('Server', `Received ${sig}, shutting down cleanly...`);
    try {
      if (withScheduler) await stopDaemon();
    } catch {}
    try {
      await closeBrowser();
    } catch {}
    releaseDaemonLock();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', () => cleanup('SIGINT'));
  process.once('SIGTERM', () => cleanup('SIGTERM'));
}
