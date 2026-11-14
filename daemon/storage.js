/**
 * Standalone File Storage, Process Lock, and Audit Manager
 * Maintains events.jsonl, audit.jsonl, state.json, and daemon lock with atomic operations.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_STATE } from '../lib/constants.js';
import { formatDhakaDateTime } from '../lib/timestamps.js';
import { logger } from '../lib/logger.js';

const DATA_DIR = path.resolve('data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const EVENTS_FILE = path.join(DATA_DIR, 'events.jsonl');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.jsonl');
const LOCK_FILE = path.join(DATA_DIR, 'daemon.lock');
const LOG_FILE = path.join(DATA_DIR, 'daemon.log');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Checks if a process with given PID is currently active.
 * @param {number} pid
 * @returns {boolean}
 */
export function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Attempts to acquire daemon lock. Throws if another instance is actively running.
 * @param {number} [pid=process.pid]
 * @param {string} [lockPath=LOCK_FILE]
 */
export function acquireDaemonLock(pid = process.pid, lockPath = LOCK_FILE) {
  ensureDir(path.dirname(lockPath));

  if (fs.existsSync(lockPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
      const alive = existing.pid && isPidAlive(existing.pid);
      const heartbeatAgeMs = existing.lastHeartbeatAt ? (Date.now() - Date.parse(existing.lastHeartbeatAt)) : (Date.now() - Date.parse(existing.startedAt || 0));

      // Self-healing lock (Item 14): Reclaim if PID is dead OR heartbeat is older than 2 minutes (PID recycling guard)
      if (alive && heartbeatAgeMs <= 120000) {
        throw new Error(`Daemon is already running with PID ${existing.pid}`);
      }
      logger.warn('Storage', `Reclaiming stale/zombie lock from PID ${existing.pid} (alive: ${alive}, heartbeat age: ${Math.round(heartbeatAgeMs / 1000)}s)`);
    } catch (err) {
      if (err.message.includes('Daemon is already running')) throw err;
    }
  }

  const payload = {
    pid,
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString()
  };

  fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2), 'utf-8');
  logger.info('Storage', `Acquired daemon lock for PID ${pid}`);
}

/**
 * Touches the daemon lock file to update lastHeartbeatAt timestamp (Item 14).
 * @param {string} [lockPath=LOCK_FILE]
 */
export function touchDaemonLock(lockPath = LOCK_FILE) {
  if (!fs.existsSync(lockPath)) return;
  try {
    const existing = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    existing.lastHeartbeatAt = new Date().toISOString();
    fs.writeFileSync(lockPath, JSON.stringify(existing, null, 2), 'utf-8');
  } catch (err) {
    logger.debug('Storage', `Lock touch skipped: ${err.message}`);
  }
}

/**
 * Releases daemon lock.
 * @param {string} [lockPath=LOCK_FILE]
 */
export function releaseDaemonLock(lockPath = LOCK_FILE) {
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
      logger.info('Storage', 'Daemon lock released cleanly');
    }
  } catch (err) {
    logger.warn('Storage', 'Error releasing lock file', err.message);
  }
}

/**
 * Checks whether the daemon is currently running.
 * @param {string} [lockPath=LOCK_FILE]
 * @returns {{ running: boolean, pid?: number, startedAt?: string }}
 */
export function checkDaemonRunning(lockPath = LOCK_FILE) {
  if (!fs.existsSync(lockPath)) return { running: false };
  try {
    const data = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    if (data.pid && isPidAlive(data.pid)) {
      return { running: true, pid: data.pid, startedAt: data.startedAt };
    }
    return { running: false, stalePid: data.pid };
  } catch {
    return { running: false };
  }
}

/**
 * Loads current daemon state from state.json.
 * @param {string} [statePath=STATE_FILE]
 * @returns {object}
 */
export function getDaemonState(statePath = STATE_FILE) {
  ensureDir(path.dirname(statePath));
  try {
    if (fs.existsSync(statePath)) {
      const raw = fs.readFileSync(statePath, 'utf-8');
      return { ...DEFAULT_STATE, ...JSON.parse(raw) };
    }
  } catch (err) {
    logger.error('Storage', 'Error reading state.json, recovering with defaults', err.message);
  }
  return { ...DEFAULT_STATE };
}

/**
 * Atomically updates state.json.
 * @param {object} updates
 * @param {string} [statePath=STATE_FILE]
 * @returns {object}
 */
export function saveDaemonState(updates, statePath = STATE_FILE) {
  ensureDir(path.dirname(statePath));
  const current = getDaemonState(statePath);
  const next = { ...current, ...updates };

  const tmpPath = `${statePath}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmpPath, statePath);
  return next;
}

let memoryEventsCache = null;
let lastEventsFileMtime = 0;
let lastEventsFileSize = 0;

/**
 * Appends an observation event to events.jsonl and syncs with in-memory cache.
 * @param {object} event
 * @param {string} [eventsPath=EVENTS_FILE]
 * @returns {object}
 */
export function appendDaemonEvent(event, eventsPath = EVENTS_FILE) {
  ensureDir(path.dirname(eventsPath));

  const fullEvent = {
    id: event.id || `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    username: event.username || 'instagram',
    timestampUtc: event.timestampUtc || new Date().toISOString(),
    observedState: event.observedState,
    previousReliableState: event.previousReliableState || null,
    confidence: event.confidence || 'HIGH',
    reason: event.reason || '',
    source: event.source || 'playwright-headless-observation',
    checkDurationMs: event.checkDurationMs || 0,
    isTransition: Boolean(event.isTransition),
    notificationStatus: event.notificationStatus || 'SKIPPED'
  };

  const line = JSON.stringify(fullEvent) + '\n';
  fs.appendFileSync(eventsPath, line, 'utf-8');

  // Item 19: Also append to partitioned daily log (events_YYYY-MM-DD.jsonl)
  if (eventsPath === EVENTS_FILE) {
    try {
      const dayStr = (fullEvent.timestampUtc || new Date().toISOString()).slice(0, 10);
      const dailyFile = path.join(path.dirname(eventsPath), `events_${dayStr}.jsonl`);
      fs.appendFileSync(dailyFile, line, 'utf-8');
    } catch {}
    if (memoryEventsCache) {
      memoryEventsCache.push(fullEvent);
      if (memoryEventsCache.length > 2000) {
        memoryEventsCache = memoryEventsCache.slice(-1000);
      }
    }
    try {
      const stats = fs.statSync(eventsPath);
      lastEventsFileMtime = stats.mtimeMs;
      lastEventsFileSize = stats.size;
    } catch {}
  }

  return fullEvent;
}

/**
 * Records an observation event in the in-memory cache without writing to SSD.
 * Used for steady-state non-transition heartbeats to protect disk endurance.
 * @param {object} event
 * @returns {object}
 */
export function recordDaemonEventInMemory(event) {
  const fullEvent = {
    id: event.id || `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    username: event.username || 'instagram',
    timestampUtc: event.timestampUtc || new Date().toISOString(),
    observedState: event.observedState,
    previousReliableState: event.previousReliableState || null,
    confidence: event.confidence || 'HIGH',
    reason: event.reason || '',
    source: event.source || 'playwright-headless-observation',
    checkDurationMs: event.checkDurationMs || 0,
    isTransition: Boolean(event.isTransition),
    notificationStatus: event.notificationStatus || 'SKIPPED'
  };

  if (!memoryEventsCache) {
    // Seed from disk first if cache uninitialized
    if (fs.existsSync(EVENTS_FILE)) {
      readDaemonEvents();
    } else {
      memoryEventsCache = [];
    }
  }

  if (memoryEventsCache) {
    memoryEventsCache.push(fullEvent);
    if (memoryEventsCache.length > 2000) {
      memoryEventsCache = memoryEventsCache.slice(-1000);
    }
  }

  return fullEvent;
}

/**
 * Appends an operational audit event to audit.jsonl.
 * Separates system actions from profile observations.
 * @param {string} eventType
 * @param {object} [details={}]
 * @param {string} [auditPath=AUDIT_FILE]
 * @returns {object}
 */
export function appendDaemonAuditEvent(eventType, details = {}, auditPath = AUDIT_FILE) {
  ensureDir(path.dirname(auditPath));

  const auditRecord = {
    id: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    timestampUtc: new Date().toISOString(),
    eventType,
    details
  };

  const line = JSON.stringify(auditRecord) + '\n';
  fs.appendFileSync(auditPath, line, 'utf-8');
  logger.info('StorageAudit', `Recorded operational event: ${eventType}`, details);
  return auditRecord;
}

/**
 * Reads events from events.jsonl or in-memory cache with filtering options.
 * @param {object} [options]
 * @param {number} [options.limit]
 * @param {number} [options.withinHours] Rolling window in hours (e.g. 24)
 * @param {boolean} [options.transitionOnly]
 * @param {string} [options.stateFilter]
 * @param {string} [options.usernameFilter]
 * @param {string} [options.fromDate]
 * @param {string} [options.toDate]
 * @param {string} [eventsPath=EVENTS_FILE]
 * @returns {Array<object>}
 */
export function readDaemonEvents(options = {}, eventsPath = EVENTS_FILE) {
  try {
    let rawEvents = [];

    if (!fs.existsSync(eventsPath)) {
      if (eventsPath === EVENTS_FILE && memoryEventsCache && memoryEventsCache.length > 0) {
        rawEvents = memoryEventsCache;
      } else {
        return [];
      }
    } else if (eventsPath === EVENTS_FILE) {
      // For default EVENTS_FILE, use in-memory cache when file is unchanged
      try {
        const stats = fs.statSync(eventsPath);
        if (memoryEventsCache && stats.mtimeMs === lastEventsFileMtime && stats.size === lastEventsFileSize) {
          rawEvents = memoryEventsCache;
        } else {
          const content = fs.readFileSync(eventsPath, 'utf-8');
          const lines = content.split('\n').filter((l) => l.trim().length > 0);
          rawEvents = [];
          for (const l of lines) {
            try { rawEvents.push(JSON.parse(l)); } catch {}
          }
          memoryEventsCache = rawEvents;
          lastEventsFileMtime = stats.mtimeMs;
          lastEventsFileSize = stats.size;
        }
      } catch {
        rawEvents = memoryEventsCache || [];
      }
    } else {
      // Custom path (e.g. unit tests) - read directly from disk
      const content = fs.readFileSync(eventsPath, 'utf-8');
      const lines = content.split('\n').filter((l) => l.trim().length > 0);
      for (const l of lines) {
        try { rawEvents.push(JSON.parse(l)); } catch {}
      }
    }

    let events = rawEvents;

    // Filter by rolling time window (e.g. last 24 hours)
    if (typeof options.withinHours === 'number' && options.withinHours > 0) {
      const cutoffMs = Date.now() - (options.withinHours * 60 * 60 * 1000);
      events = events.filter((e) => {
        const t = Date.parse(e.timestampUtc);
        return Number.isNaN(t) || t >= cutoffMs;
      });
    }

    if (options.usernameFilter && options.usernameFilter !== 'ALL') {
      const u = options.usernameFilter.toLowerCase();
      events = events.filter((e) => (e.username || '').toLowerCase() === u);
    }
    if (options.transitionOnly) {
      events = events.filter((e) => e.isTransition === true);
    }
    if (options.stateFilter && options.stateFilter !== 'ALL') {
      events = events.filter((e) => e.observedState === options.stateFilter);
    }
    if (options.fromDate) {
      const fromMs = Date.parse(options.fromDate);
      if (!Number.isNaN(fromMs)) {
        events = events.filter((e) => Date.parse(e.timestampUtc) >= fromMs);
      }
    }
    if (options.toDate) {
      const toMs = Date.parse(options.toDate);
      if (!Number.isNaN(toMs)) {
        events = events.filter((e) => Date.parse(e.timestampUtc) <= toMs);
      }
    }
    if (options.limit && typeof options.limit === 'number' && options.limit > 0) {
      events = events.slice(-options.limit);
    }

    return events;
  } catch (err) {
    logger.error('Storage', 'Failed to read events.jsonl', err.message);
    return [];
  }
}

/**
 * Prunes events from events.jsonl that are strictly older than the specified rolling time window (default 24 hours).
 * Guarantees that ALL records within the rolling window are preserved without arbitrary count limits.
 *
 * @param {string} [eventsPath=EVENTS_FILE]
 * @param {number} [windowHours=24] Rolling window in hours. Defaults to 24.
 * @returns {{ totalBefore: number, keptCount: number, prunedCount: number }}
 */
export function pruneDaemonEventsOlderThanWindow(eventsPath = EVENTS_FILE, windowHours = 24) {
  if (!fs.existsSync(eventsPath)) {
    return { totalBefore: 0, keptCount: 0, prunedCount: 0 };
  }

  try {
    const content = fs.readFileSync(eventsPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const totalBefore = lines.length;
    if (totalBefore === 0) {
      return { totalBefore: 0, keptCount: 0, prunedCount: 0 };
    }

    const cutoffMs = Date.now() - (windowHours * 60 * 60 * 1000);
    const keptLines = [];
    let prunedCount = 0;

    for (const l of lines) {
      try {
        const parsed = JSON.parse(l);
        const eventTimeMs = Date.parse(parsed.timestampUtc);
        // Keep if event is within the window (>= cutoffMs) or if invalid timestamp (safety first)
        if (Number.isNaN(eventTimeMs) || eventTimeMs >= cutoffMs) {
          keptLines.push(l);
        } else {
          prunedCount++;
        }
      } catch {
        // Keep corrupted lines to prevent data loss
        keptLines.push(l);
      }
    }

    // Only rewrite file if we actually pruned older events
    if (prunedCount > 0) {
      const tempPath = `${eventsPath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, keptLines.join('\n') + (keptLines.length > 0 ? '\n' : ''), 'utf-8');
      fs.renameSync(tempPath, eventsPath);
      logger.info('Storage', `Pruned ${prunedCount} events older than ${windowHours}h (${keptLines.length} kept in rolling window)`);

      if (eventsPath === EVENTS_FILE) {
        memoryEventsCache = null;
        lastEventsFileMtime = 0;
        lastEventsFileSize = 0;
      }
    }

    return { totalBefore, keptCount: keptLines.length, prunedCount };
  } catch (err) {
    logger.error('Storage', 'Failed during rolling window history retention cleanup', err.message);
    return { error: err.message };
  }
}

/**
 * Prunes expired daily partition files (Item 19).
 * Deletes whole files via instant metadata-only unlink without rewriting files.
 * @param {string} [dataDir=DATA_DIR]
 * @param {number} [maxAgeDays=2]
 * @returns {Array<string>} Array of unlinked partition file names
 */
export function pruneExpiredDailyPartitions(dataDir = DATA_DIR, maxAgeDays = 2) {
  if (!fs.existsSync(dataDir)) return [];
  const cutoffTime = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  const cutoffDateStr = new Date(cutoffTime).toISOString().slice(0, 10);
  const unlinked = [];

  try {
    const files = fs.readdirSync(dataDir);
    for (const file of files) {
      const match = file.match(/^events_(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (match) {
        const fileDateStr = match[1];
        if (fileDateStr < cutoffDateStr) {
          const filePath = path.join(dataDir, file);
          try {
            fs.unlinkSync(filePath);
            unlinked.push(file);
            logger.info('Storage', `Pruned expired daily partition: ${file}`);
          } catch {}
        }
      }
    }
  } catch (err) {
    logger.warn('Storage', `Daily partition pruning warning: ${err.message}`);
  }

  return unlinked;
}

/**
 * Reads operational audit events from audit.jsonl.
 * @param {object} [options]
 * @param {number} [options.limit=50]
 * @param {string} [auditPath=AUDIT_FILE]
 * @returns {Array<object>}
 */
export function readDaemonAuditEvents(options = {}, auditPath = AUDIT_FILE) {
  if (!fs.existsSync(auditPath)) return [];
  try {
    const content = fs.readFileSync(auditPath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    let audits = [];

    for (const l of lines) {
      try {
        audits.push(JSON.parse(l));
      } catch {}
    }

    const limit = options.limit || 50;
    return audits.slice(-limit);
  } catch (err) {
    logger.error('Storage', 'Failed to read audit.jsonl', err.message);
    return [];
  }
}

/**
 * Rotates daemon log if file size exceeds threshold.
 * @param {string} [logPath=LOG_FILE]
 * @param {number} [maxSizeBytes=5242880] 5MB default
 */
export function rotateDaemonLog(logPath = LOG_FILE, maxSizeBytes = 5 * 1024 * 1024) {
  try {
    if (!fs.existsSync(logPath)) return;
    const stats = fs.statSync(logPath);
    if (stats.size > maxSizeBytes) {
      const rotatedPath = `${logPath}.1`;
      if (fs.existsSync(rotatedPath)) {
        fs.unlinkSync(rotatedPath);
      }
      fs.renameSync(logPath, rotatedPath);
      fs.writeFileSync(logPath, `--- Log rotated at ${new Date().toISOString()} ---\n`, 'utf-8');
      logger.info('Storage', `Daemon log rotated successfully (${stats.size} bytes)`);
    }
  } catch (err) {
    logger.warn('Storage', 'Failed to rotate daemon log', err.message);
  }
}

/**
 * Exports history events to a standard CSV file.
 * @param {Array<object>} events
 * @param {string} outputPath
 */
export function exportDaemonEventsToCsv(events, outputPath) {
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

  const escapeCell = (val) => {
    if (val === null || val === undefined) return '""';
    let str = String(val);
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }
    return `"${str.replace(/"/g, '""')}"`;
  };

  const rows = [headers.map(escapeCell).join(',')];

  for (const e of events) {
    rows.push([
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
    ].join(','));
  }

  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, rows.join('\r\n'), 'utf-8');
  logger.info('Storage', `Exported ${events.length} events to ${outputPath}`);
}
