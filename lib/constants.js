/**
 * Core constants for Instagram Profile Visibility Monitor
 */

export const DEFAULT_TARGET_USERNAME = 'instagram';
export const DEFAULT_TARGET_URL = `https://www.instagram.com/${DEFAULT_TARGET_USERNAME}/`;

export const DEFAULT_INTERVAL_MINUTES = 3;
export const DEFAULT_INTERVAL_MS = 180000;
export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 60;

export const CONFIG_SCHEMA_VERSION = 2;

export const ScheduleMode = Object.freeze({
  FIXED: 'FIXED',
  RANDOM_RANGE: 'RANDOM_RANGE'
});

export const FIXED_INTERVAL_MIN_MINUTES = 3;
export const FIXED_INTERVAL_MAX_MINUTES = 60;

export const RANDOM_RANGE_MIN_SECONDS = 60;
export const RANDOM_RANGE_MAX_SECONDS = 180;
export const DEFAULT_RANDOM_MIN_SECONDS = 60;
export const DEFAULT_RANDOM_MAX_SECONDS = 180;

export const SessionHealth = Object.freeze({
  OK: 'OK',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  CHALLENGED: 'CHALLENGED',
  UNKNOWN: 'UNKNOWN'
});

export const AuditEventType = Object.freeze({
  TARGET_CHANGED: 'TARGET_CHANGED',
  SCHEDULE_CHANGED: 'SCHEDULE_CHANGED',
  MONITORING_STARTED: 'MONITORING_STARTED',
  MONITORING_PAUSED: 'MONITORING_PAUSED',
  MONITORING_RESUMED: 'MONITORING_RESUMED',
  MONITORING_STOPPED: 'MONITORING_STOPPED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  ACCESS_RESTRICTED: 'ACCESS_RESTRICTED',
  PROCESS_RESTARTED: 'PROCESS_RESTARTED'
});

export const TIMEZONE = 'Asia/Dhaka'; // UTC+06:00

export const ALARM_NAME = 'INSTA_VISIBILITY_MONITOR_ALARM';
export const CHECK_TIMEOUT_MS = 30000; // 30 seconds max per observation attempt

export const ObservationState = Object.freeze({
  VISIBLE: 'VISIBLE',
  UNAVAILABLE: 'UNAVAILABLE',
  UNKNOWN: 'UNKNOWN'
});

export const MonitoringStatus = Object.freeze({
  STOPPED: 'STOPPED',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  INTERRUPTED: 'INTERRUPTED'
});

export const Confidence = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
});

export const NotificationStatus = Object.freeze({
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  DISABLED: 'DISABLED'
});

export const TransitionType = Object.freeze({
  NONE: 'NONE',
  BASELINE: 'BASELINE',
  VISIBLE_TO_UNAVAILABLE: 'VISIBLE_TO_UNAVAILABLE',
  UNAVAILABLE_TO_VISIBLE: 'UNAVAILABLE_TO_VISIBLE',
  RECOVERY_WITH_GAP: 'RECOVERY_WITH_GAP'
});

export const STORAGE_KEYS = Object.freeze({
  CONFIG: 'insta_monitor_config',
  STATE: 'insta_monitor_state',
  HISTORY: 'insta_monitor_history',
  TELEGRAM: 'insta_monitor_telegram',
  ACTIVE_TAB_ID: 'insta_monitor_active_tab_id'
});

export const DEFAULT_CONFIG = Object.freeze({
  targetUsername: DEFAULT_TARGET_USERNAME,
  targetUrl: DEFAULT_TARGET_URL,
  intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  monitoringEnabled: false,
  telegramNotificationsEnabled: true,
  browserNotificationsEnabled: true,
  historyRetentionLimit: 1000,
  autoOpenTab: true
});

export const DEFAULT_STATE = Object.freeze({
  monitoringStatus: MonitoringStatus.STOPPED,
  currentObservation: ObservationState.UNKNOWN,
  lastReliableState: null,
  lastReliableObservedAt: null,
  previousReliableState: null,
  lastTransitionAt: null,
  lastAttemptAt: null,
  lastSuccessfulCheckAt: null,
  nextScheduledCheckAt: null,
  consecutiveUnknownCount: 0,
  activeCheckId: null,
  interruptionReason: null
});
