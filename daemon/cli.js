#!/usr/bin/env node
/**
 * Command-Line Interface for Standalone Headless Monitor
 * Subcommands: login, start, stop, status, test-telegram, history, export
 */

import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { loadDaemonConfig, saveDaemonConfig } from './config.js';
import {
  checkDaemonRunning,
  releaseDaemonLock,
  getDaemonState,
  saveDaemonState,
  appendDaemonEvent,
  appendDaemonAuditEvent,
  readDaemonEvents,
  exportDaemonEventsToCsv
} from './storage.js';
import { getOrLaunchBrowser, closeBrowser } from './browser.js';
import { testTelegramConnection } from '../lib/telegram.js';
import { formatDhakaDateTime, formatDhakaTime } from '../lib/timestamps.js';
import {
  normalizeUsername,
  validateUsername,
  buildProfileUrl,
  validateFixedInterval,
  validateRandomRange
} from '../lib/validation.js';
import { ScheduleMode, AuditEventType } from '../lib/constants.js';
import { startDaemon, runObservationCycle } from './scheduler.js';
import { sendDaemonCommand } from './ipc.js';
import {
  importRawCookies,
  importStorageState,
  exportSessionState,
  getSessionStatus
} from './session.js';

const command = process.argv[2] || 'help';

async function handleLogin() {
  const config = loadDaemonConfig();
  console.log('====================================================');
  console.log('   INSTAGRAM AUTHENTICATION ONBOARDING (HEADED)     ');
  console.log('====================================================');
  console.log('A Chrome browser window will now open in headed mode.');
  console.log('1. Log in to your SECONDARY / burner Instagram account.');
  console.log('2. Complete any 2-factor authentication or checkpoints manually.');
  console.log('3. Once you see your Instagram home feed, return here.');
  console.log('====================================================\n');

  try {
    const { context, page } = await getOrLaunchBrowser({
      headless: false,
      userDataDir: config.browserProfileDir
    });

    console.log('Opening Instagram login page...');
    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    await new Promise((resolve) => {
      rl.question('\n>> When you are logged in and see your feed, press ENTER to save session: ', () => {
        rl.close();
        resolve();
      });
    });

    console.log('\nClosing browser and saving session cookies...');
    await closeBrowser();
    console.log('✓ Session saved successfully to data/browser_profile!');
    console.log('You can now run: npm run start\n');
  } catch (err) {
    console.error('✗ Login onboarding error:', err.message);
    await closeBrowser();
    process.exit(1);
  }
}

async function handleStart() {
  const status = checkDaemonRunning();
  if (status.running) {
    console.log(`[!] Daemon is ALREADY running with PID ${status.pid}`);
    console.log(`Use 'npm run status' or 'npm run stop'.`);
    process.exit(1);
  }

  // Check if --foreground flag passed
  const isForeground = process.argv.includes('--foreground') || process.argv.includes('-f');

  if (isForeground) {
    console.log('Starting daemon in foreground mode (Press Ctrl+C to stop)...');
    await startDaemon();
  } else {
    // Spawn background child process detached and redirect logs to data/daemon.log
    const cliScript = path.resolve('daemon/cli.js');
    const dataDir = path.resolve('data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const logPath = path.join(dataDir, 'daemon.log');
    const logFd = fs.openSync(logPath, 'a');

    console.log('Starting daemon in background (logging to data/daemon.log)...');

    let child = null;
    if (process.platform === 'win32') {
      // On Windows, use wscript to break away cleanly from PowerShell job objects
      const vbsPath = path.resolve('scripts/run-background.vbs');
      child = spawn('wscript.exe', [vbsPath], {
        cwd: path.resolve('.'),
        detached: true,
        stdio: 'ignore'
      });
      child.unref();
    } else {
      child = spawn(process.execPath, [cliScript, 'start', '--foreground'], {
        cwd: path.resolve('.'),
        detached: true,
        stdio: ['ignore', logFd, logFd]
      });
      child.unref();
    }

    // Verify daemon successfully claimed lock within 3 seconds
    let verified = false;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const s = checkDaemonRunning();
      if (s.running) {
        console.log(`✓ Daemon started successfully in background (PID: ${s.pid})`);
        console.log(`Logs are streaming to data/daemon.log.`);
        console.log(`Run 'npm run status' or 'npm run history' anytime.\n`);
        verified = true;
        break;
      }
    }

    if (!verified) {
      console.log(`[i] Daemon process launched. Run 'npm run status' to verify.`);
    }
  }
}

async function handleStop() {
  const status = checkDaemonRunning();
  if (!status.running) {
    console.log('No active daemon process found.');
    releaseDaemonLock();
    return;
  }

  console.log(`Stopping daemon process (PID: ${status.pid})...`);
  try {
    await sendDaemonCommand('STOP', {}, 1500);
  } catch {}

  let attempts = 0;
  while (attempts < 6) {
    await new Promise((r) => setTimeout(r, 400));
    if (!checkDaemonRunning().running) break;
    attempts++;
  }

  if (checkDaemonRunning().running) {
    try {
      process.kill(status.pid, 'SIGTERM');
    } catch (err) {
      console.warn(`Could not signal PID ${status.pid}: ${err.message}`);
    }
  }

  releaseDaemonLock();
  console.log('✓ Daemon stopped.');
}

function handleStatus() {
  const lock = checkDaemonRunning();
  const config = loadDaemonConfig();
  const state = getDaemonState();

  const modeDesc = config.scheduleMode === ScheduleMode.RANDOM_RANGE
    ? `RANDOM RANGE (${config.randomMinSeconds}s – ${config.randomMaxSeconds}s)`
    : `FIXED (${config.fixedIntervalMinutes || config.intervalMinutes || 3} minutes)`;

  const delayDesc = state.lastScheduledDelayMs
    ? `${Math.round(state.lastScheduledDelayMs / 1000)} seconds`
    : '—';

  console.log('\n==============================================');
  console.log('   INSTAGRAM VISIBILITY MONITOR — STATUS      ');
  console.log('==============================================');
  console.log(`Daemon Process:       ${lock.running ? `RUNNING (PID: ${lock.pid})` : 'STOPPED'}`);
  console.log(`Monitoring Status:    ${state.monitoringStatus || 'STOPPED'}`);
  console.log(`Target Profile:       @${config.targetUsername}`);
  console.log(`Target URL:           ${config.targetUrl}`);
  console.log(`Schedule Mode:        ${modeDesc}`);
  console.log(`Last Selected Delay:  ${delayDesc}`);
  console.log(`Session Health:       ${state.sessionHealth || 'OK'}`);
  console.log(`Telegram Alerts:      ${config.telegramNotificationsEnabled ? 'ENABLED' : 'DISABLED'}`);
  console.log('----------------------------------------------');
  console.log(`Current Observation:  ${state.currentObservation || 'UNKNOWN'}`);
  console.log(`Last Reliable State:  ${state.lastReliableState || '—'}`);
  console.log(`Last Check Attempt:   ${formatDhakaTime(state.lastAttemptAt, true)}`);
  console.log(`Last Successful Check:${formatDhakaTime(state.lastSuccessfulCheckAt, true)}`);
  console.log(`Next Scheduled Check: ${formatDhakaTime(state.nextScheduledCheckAt)}`);
  console.log(`Last Transition:      ${state.lastTransitionAt ? formatDhakaDateTime(state.lastTransitionAt) : 'None'}`);
  console.log('==============================================\n');
}

function handleSchedule() {
  const sub = (process.argv[3] || '').toLowerCase();
  const config = loadDaemonConfig();

  if (sub === 'fixed') {
    const mins = parseInt(process.argv[4], 10);
    if (!validateFixedInterval(mins)) {
      console.error('✗ Error: Fixed interval must be a whole integer between 3 and 60 minutes.');
      process.exit(1);
    }
    saveDaemonConfig({
      scheduleMode: ScheduleMode.FIXED,
      fixedIntervalMinutes: mins
    });
    appendDaemonAuditEvent(AuditEventType.SCHEDULE_CHANGED, {
      scheduleMode: ScheduleMode.FIXED,
      fixedIntervalMinutes: mins
    });
    console.log(`✓ Schedule updated: FIXED interval set to ${mins} minutes.`);
    console.log('  Live daemon will use the new cadence for subsequent checks.');
    return;
  }

  if (sub === 'random') {
    const minSec = parseInt(process.argv[4], 10);
    const maxSec = parseInt(process.argv[5], 10);
    const validation = validateRandomRange(minSec, maxSec);
    if (!validation.valid) {
      console.error(`✗ Error: ${validation.error}`);
      console.error('  Allowed range: 60 to 180 seconds, with minimum <= maximum.');
      process.exit(1);
    }
    saveDaemonConfig({
      scheduleMode: ScheduleMode.RANDOM_RANGE,
      randomMinSeconds: minSec,
      randomMaxSeconds: maxSec
    });
    appendDaemonAuditEvent(AuditEventType.SCHEDULE_CHANGED, {
      scheduleMode: ScheduleMode.RANDOM_RANGE,
      randomMinSeconds: minSec,
      randomMaxSeconds: maxSec
    });
    console.log(`✓ Schedule updated: RANDOM RANGE set to ${minSec}s – ${maxSec}s.`);
    console.log('  Live daemon will randomly select delays within this range for subsequent checks.');
    return;
  }

  console.log('\nCurrent Schedule Configuration:');
  console.log(`  Mode:           ${config.scheduleMode}`);
  console.log(`  Fixed Interval: ${config.fixedIntervalMinutes} minutes`);
  console.log(`  Random Range:   ${config.randomMinSeconds}s – ${config.randomMaxSeconds}s`);
  console.log('\nUsage:');
  console.log('  npm run cli schedule fixed <3-60>');
  console.log('  npm run cli schedule random <minSec 60-180> <maxSec 60-180>\n');
}

function handlePause() {
  saveDaemonState({
    monitoringStatus: 'PAUSED',
    interruptionReason: 'User paused via CLI'
  });
  appendDaemonAuditEvent(AuditEventType.MONITORING_PAUSED, { source: 'cli' });
  console.log('✓ Monitoring marked as PAUSED.');
}

function handleResume() {
  saveDaemonState({
    monitoringStatus: 'RUNNING',
    interruptionReason: null
  });
  appendDaemonAuditEvent(AuditEventType.MONITORING_RESUMED, { source: 'cli' });
  console.log('✓ Monitoring marked as RUNNING.');
}

async function handleTestTelegram() {
  const config = loadDaemonConfig();
  if (!config.telegramBotToken || !config.telegramChatId) {
    console.error('✗ Telegram bot token or chat ID is not configured in data/config.json.');
    console.log('Run: npm run cli -- config set telegramBotToken <token> telegramChatId <id>');
    process.exit(1);
  }

  console.log('Sending test message to Telegram...');
  const res = await testTelegramConnection(
    config.telegramBotToken,
    config.telegramChatId,
    config.targetUsername
  );

  if (res.ok) {
    console.log('✓ Test notification delivered successfully to your Telegram chat!');
  } else {
    console.error(`✗ Telegram delivery failed: ${res.error}`);
  }
}

function handleHistory() {
  const showAll = process.argv.includes('--all') || process.argv.includes('-a');
  const allEvents = readDaemonEvents({ withinHours: 24 });
  if (allEvents.length === 0) {
    console.log('No observation events recorded in the last 24 hours (data/events.jsonl).');
    return;
  }

  const events = showAll ? allEvents : allEvents.slice(-30);
  const totalCount = allEvents.length;

  console.log(`\nObservation Events — Last 24 Hours (Showing ${events.length} of ${totalCount} records${!showAll && totalCount > 30 ? ', pass --all to view all' : ''}):`);
  console.log('---------------------------------------------------------------------------------------------------');
  console.log('Time (Dhaka)          State          Prev State     Transition   Duration    Reason');
  console.log('---------------------------------------------------------------------------------------------------');

  for (const e of events) {
    const time = formatDhakaDateTime(e.timestampUtc, { includeSeconds: true }).padEnd(21);
    const state = (e.observedState || '').padEnd(14);
    const prev = (e.previousReliableState || '—').padEnd(14);
    const trans = (e.isTransition ? 'YES' : 'NO').padEnd(12);
    const dur = `${e.checkDurationMs || 0} ms`.padEnd(11);
    const reason = (e.reason || '').slice(0, 30);
    console.log(`${time} ${state} ${prev} ${trans} ${dur} ${reason}`);
  }
  console.log('---------------------------------------------------------------------------------------------------\n');
}

function handleExport() {
  const showAll = process.argv.includes('--all');
  const events = showAll ? readDaemonEvents() : readDaemonEvents({ withinHours: 24 });
  const outputPath = path.resolve('data/history.csv');
  exportDaemonEventsToCsv(events, outputPath);
  console.log(`✓ Exported ${events.length} records (${showAll ? 'all recorded history' : 'last 24 hours'}) to ${outputPath}`);
}

async function handleTarget() {
  const newTarget = process.argv[3];
  const cfg = loadDaemonConfig();

  if (!newTarget) {
    console.log(`Current Target Profile: @${cfg.targetUsername}`);
    console.log(`Target URL:             ${cfg.targetUrl}`);
    console.log(`\nUsage to switch target: npm run target <username_or_url>`);
    return;
  }

  const clean = normalizeUsername(newTarget);
  if (!validateUsername(clean)) {
    console.error(`✗ Error: "${newTarget}" is not a valid Instagram username.`);
    console.error(`Instagram handles must be 1-30 characters, using letters, numbers, periods, or underscores.`);
    process.exit(1);
  }

  const targetUrl = buildProfileUrl(clean);
  saveDaemonConfig({
    targetUsername: clean,
    targetUrl
  });

  // Reset baseline for the new target according to Rule I
  saveDaemonState({
    currentAccount: clean,
    lastReliableState: null,
    lastReliableObservedAt: null,
    previousReliableState: null,
    lastTransitionAt: null,
    currentObservation: 'UNKNOWN'
  });

  appendDaemonEvent({
    username: clean,
    observedState: 'UNKNOWN',
    previousReliableState: null,
    confidence: 'HIGH',
    reason: `Target profile switched to @${clean} via CLI (baseline reset)`,
    source: 'cli-target-switch',
    checkDurationMs: 0,
    isTransition: false,
    notificationStatus: 'SKIPPED'
  });

  console.log(`✓ Target profile switched successfully to: @${clean}`);
  console.log(`  Target URL: ${targetUrl}`);
  console.log(`  Comparison baseline reset according to Rule I.`);

  // Trigger immediate observation check
  const status = checkDaemonRunning();
  let observationResult = null;
  if (status.running) {
    console.log(`  Daemon is running (PID: ${status.pid}). Triggering immediate check via IPC...`);
    const ipcRes = await sendDaemonCommand('SWITCH_TARGET', { targetUsername: clean, targetUrl }, 12000);
    if (ipcRes.success && ipcRes.result) {
      observationResult = ipcRes.result;
    }
  } else {
    console.log('  Running initial baseline observation check directly...');
    observationResult = await runObservationCycle(loadDaemonConfig());
    await closeBrowser();
  }

  if (observationResult?.observation) {
    const obs = observationResult.observation;
    console.log(`✓ Initial observation: ${obs.state} (${obs.confidence} confidence, duration: ${observationResult.checkDurationMs || 0}ms)`);
    console.log(`  Reason: ${obs.reason || 'Baseline check complete'}\n`);
  } else {
    console.log(`  Initial check scheduled.\n`);
  }
}

async function handleCheck() {
  const cfg = loadDaemonConfig();
  console.log(`Executing observation check for @${cfg.targetUsername}...`);

  const status = checkDaemonRunning();
  let observationResult = null;

  if (status.running) {
    console.log(`Daemon is running (PID: ${status.pid}). Dispatching check command via IPC...`);
    const ipcRes = await sendDaemonCommand('CHECK_NOW', {}, 12000);
    if (ipcRes.success && ipcRes.result) {
      observationResult = ipcRes.result;
    } else {
      console.error(`✗ Check failed or timed out: ${ipcRes.error || 'Unknown error'}`);
      return;
    }
  } else {
    console.log('Daemon is stopped. Launching browser to run check directly...');
    observationResult = await runObservationCycle(cfg);
    await closeBrowser();
  }

  if (observationResult?.observation) {
    const obs = observationResult.observation;
    console.log(`\n==============================================`);
    console.log(`   OBSERVATION RESULT: @${obs.targetUsername}`);
    console.log(`==============================================`);
    console.log(`Observed State:       ${obs.state}`);
    console.log(`Confidence:           ${obs.confidence}`);
    console.log(`Check Duration:       ${observationResult.checkDurationMs || 0} ms`);
    console.log(`Reason:               ${obs.reason || 'Verified'}`);
    console.log(`Timestamp:            ${formatDhakaDateTime(obs.observedAt, { includeSeconds: true })}`);
    console.log(`==============================================\n`);
  } else {
    console.log('Check finished without observation output.');
  }
}

function handleConfig() {
  const sub = process.argv[3];
  if (sub === 'set') {
    const updates = {};
    for (let i = 4; i < process.argv.length; i += 2) {
      const key = process.argv[i];
      let val = process.argv[i + 1];
      if (key && val !== undefined) {
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (/^\d+$/.test(val)) val = parseInt(val, 10);
        updates[key] = val;
      }
    }
    const updated = saveDaemonConfig(updates);
    console.log('✓ Configuration updated:');
    console.log(JSON.stringify(updated, null, 2));
  } else {
    const cfg = loadDaemonConfig();
    console.log(JSON.stringify(cfg, null, 2));
  }
}

async function handleSession() {
  const sub = process.argv[3];
  if (sub === 'status') {
    const status = getSessionStatus();
    console.log('\nInstagram Secondary Account Session Status:');
    console.log(`  Authenticated: ${status.hasSession ? 'YES' : 'NO'}`);
    if (status.userId) console.log(`  User ID:       ${status.userId}`);
    console.log(`  Cookies Count: ${status.cookiesCount}`);
    if (status.updatedAt) console.log(`  Updated At:    ${status.updatedAt}`);
    console.log('');
  } else if (sub === 'import') {
    const input = process.argv[4];
    if (!input) {
      console.error('Usage: npm run cli session import <filepath | cookie-string>');
      process.exit(1);
    }
    let res = null;
    if (input.endsWith('.json') || fs.existsSync(input)) {
      res = importStorageState(input);
    } else {
      res = importRawCookies(input);
    }
    if (res.ok) {
      console.log(`✓ Successfully imported ${res.count} session cookies!`);
    } else {
      console.error(`✗ Import failed: ${res.error}`);
      process.exit(1);
    }
  } else if (sub === 'export') {
    const state = exportSessionState();
    console.log(JSON.stringify(state, null, 2));
  } else {
    console.log('Usage: npm run cli session [status | import <path|string> | export]');
  }
}

function showHelp() {
  console.log(`
Instagram Profile Visibility Monitor — Headless CLI

Commands:
  target [username]        View or switch the target Instagram profile to monitor
  check                    Run an immediate observation check on the active target profile
  schedule fixed <mins>    Set fixed monitoring interval (3 to 60 minutes)
  schedule random <min> <max> Set random range interval (60 to 180 seconds)
  session status           Check headless session health and cookie status
  session import <data>    Import session from Playwright storageState.json or cookie string
  session export           Export active session state in standard Playwright JSON format
  login                    Launch browser in headed mode to sign in manually to secondary account
  start [--foreground]     Start the background observation daemon
  pause                    Pause active monitoring
  resume                   Resume paused monitoring
  stop                     Stop the running background observation daemon
  status                   Show current daemon execution state, mode, and observation
  test:telegram            Send a test notification to your configured Telegram chat
  history                  Display recent observation events from data/events.jsonl
  export                   Export all event history to data/history.csv
  config [set k v]         View or update daemon configuration

Examples:
  npm run target cristiano
  npm run cli session import "sessionid=xyz; ds_user_id=123"
  npm run cli schedule fixed 5
  npm run cli schedule random 60 120
  npm run start
  npm run status
  npm run stop
`);
}

// Route command
switch (command) {
  case 'session':
    await handleSession();
    break;
  case 'target':
    await handleTarget();
    break;
  case 'check':
    await handleCheck();
    break;
  case 'schedule':
    handleSchedule();
    break;
  case 'pause':
    handlePause();
    break;
  case 'resume':
    handleResume();
    break;
  case 'login':
    handleLogin();
    break;
  case 'start':
    handleStart();
    break;
  case 'stop':
    handleStop();
    break;
  case 'status':
    handleStatus();
    break;
  case 'test:telegram':
  case 'test-telegram':
    handleTestTelegram();
    break;
  case 'history':
    handleHistory();
    break;
  case 'export':
    handleExport();
    break;
  case 'config':
    handleConfig();
    break;
  default:
    showHelp();
    break;
}
