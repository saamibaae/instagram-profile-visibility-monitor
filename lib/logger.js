/**
 * Structured Logger with Automatic Credential Masking
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

let currentLogLevel = LOG_LEVELS.INFO;

/**
 * Sanitizes input to mask Telegram Bot tokens or sensitive credentials.
 * @param {*} data
 * @returns {*}
 */
export function sanitizeLogData(data) {
  if (typeof data === 'string') {
    // Redact Telegram bot token: 123456789:ABCdef...
    return data.replace(/([0-9]{8,12}):([a-zA-Z0-9_-]{25,50})/g, '$1:•••••••••••••••••••••••••••••••••••');
  }
  if (data && typeof data === 'object') {
    if (Array.isArray(data)) {
      return data.map(sanitizeLogData);
    }
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      if (/token|password|secret|key/i.test(key) && typeof value === 'string') {
        sanitized[key] = value.length > 8 ? `${value.slice(0, 4)}••••${value.slice(-4)}` : '••••••••';
      } else {
        sanitized[key] = sanitizeLogData(value);
      }
    }
    return sanitized;
  }
  return data;
}

function logMessage(levelName, tag, message, details) {
  if (LOG_LEVELS[levelName] < currentLogLevel) return;
  const time = new Date().toISOString();
  const prefix = `[${time}] [${levelName}] [${tag}]`;
  const cleanMessage = sanitizeLogData(message);
  const cleanDetails = details !== undefined ? sanitizeLogData(details) : '';

  if (levelName === 'ERROR') {
    console.error(prefix, cleanMessage, cleanDetails);
  } else if (levelName === 'WARN') {
    console.warn(prefix, cleanMessage, cleanDetails);
  } else {
    console.log(prefix, cleanMessage, cleanDetails);
  }
}

export const logger = {
  setLevel(level) {
    if (LOG_LEVELS[level] !== undefined) {
      currentLogLevel = LOG_LEVELS[level];
    }
  },
  debug(tag, message, details) {
    logMessage('DEBUG', tag, message, details);
  },
  info(tag, message, details) {
    logMessage('INFO', tag, message, details);
  },
  warn(tag, message, details) {
    logMessage('WARN', tag, message, details);
  },
  error(tag, message, details) {
    logMessage('ERROR', tag, message, details);
  }
};
