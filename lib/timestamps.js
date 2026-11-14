/**
 * Timestamp and Timezone Utilities
 * All internal timestamps are stored as ISO 8601 UTC strings.
 * User-facing display is formatted in Asia/Dhaka (UTC+06:00).
 */

import { TIMEZONE } from './constants.js';

/**
 * Returns current UTC timestamp in ISO 8601 format.
 * @returns {string}
 */
export function nowUtc() {
  return new Date().toISOString();
}

/**
 * Formats an ISO UTC timestamp into Asia/Dhaka local date and time string.
 * Example: "09 Nov 2026, 06:03 PM"
 * @param {string|Date|number|null} isoString
 * @param {object} [options]
 * @returns {string}
 */
export function formatDhakaDateTime(isoString, options = {}) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';

  const defaultOptions = {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: options.includeSeconds ? '2-digit' : undefined,
    hour12: true
  };

  try {
    return new Intl.DateTimeFormat('en-GB', { ...defaultOptions, ...options }).format(date);
  } catch {
    // Fallback if Intl fails
    return date.toISOString();
  }
}

/**
 * Formats an ISO UTC timestamp into Asia/Dhaka time only (e.g. "06:03 PM").
 * @param {string|Date|number|null} isoString
 * @param {boolean} [includeSeconds=false]
 * @returns {string}
 */
export function formatDhakaTime(isoString, includeSeconds = false) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '—';

  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
      second: includeSeconds ? '2-digit' : undefined,
      hour12: true
    }).format(date);
  } catch {
    return date.toTimeString().slice(0, 8);
  }
}

/**
 * Calculates human-readable duration between two timestamps.
 * @param {string|Date} startIso
 * @param {string|Date} endIso
 * @returns {string} e.g. "3m 12s" or "1h 4m"
 */
export function formatDuration(startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return '—';

  const diffMs = Math.max(0, end - start);
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Determines whether a scheduled check is overdue by more than a grace threshold.
 * @param {string|null} nextScheduledIso
 * @param {number} [graceThresholdMs=60000] 1 minute grace period
 * @returns {boolean}
 */
export function isCheckOverdue(nextScheduledIso, graceThresholdMs = 60000) {
  if (!nextScheduledIso) return false;
  const scheduledTime = new Date(nextScheduledIso).getTime();
  if (Number.isNaN(scheduledTime)) return false;
  return Date.now() > (scheduledTime + graceThresholdMs);
}

/**
 * Calculates monitoring gap in minutes between two timestamps.
 * @param {string} prevIso
 * @param {string} currentIso
 * @returns {number} gap in minutes (floating point)
 */
export function calculateGapMinutes(prevIso, currentIso) {
  const p = new Date(prevIso).getTime();
  const c = new Date(currentIso).getTime();
  if (Number.isNaN(p) || Number.isNaN(c)) return 0;
  return Math.max(0, (c - p) / 60000);
}
