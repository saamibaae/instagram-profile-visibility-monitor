/**
 * Lightweight File-Based Inter-Process Communication (IPC)
 * Coordinates command dispatching between Web GUI / CLI and running daemon.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from '../lib/logger.js';

const DATA_DIR = path.resolve('data');
const COMMAND_FILE = path.join(DATA_DIR, 'daemon.command');
const RESPONSE_FILE = path.join(DATA_DIR, 'daemon.response');

function ensureDir(dir = DATA_DIR) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Sends a command to the running daemon process and optionally awaits a response.
 *
 * @param {string} command - E.g. 'CHECK_NOW', 'SWITCH_TARGET', 'RESCHEDULE', 'PAUSE', 'RESUME', 'STOP'
 * @param {object} [payload={}] - Additional command parameters
 * @param {number} [timeoutMs=8000] - Milliseconds to wait for response (0 to fire-and-forget)
 * @returns {Promise<{ success: boolean, result?: any, error?: string }>}
 */
export async function sendDaemonCommand(command, payload = {}, timeoutMs = 8000, cmdFile = COMMAND_FILE, resFile = RESPONSE_FILE) {
  ensureDir(path.dirname(cmdFile));
  const id = `cmd_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  // Clean up any stale response file
  try {
    if (fs.existsSync(resFile)) fs.unlinkSync(resFile);
  } catch {}

  const cmdData = {
    id,
    command,
    payload,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };

  // Write command atomically
  const tempFile = `${cmdFile}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempFile, JSON.stringify(cmdData, null, 2), 'utf-8');
    fs.renameSync(tempFile, cmdFile);
    logger.debug('IPC', `Dispatched command ${command} (ID: ${id})`);
  } catch (err) {
    logger.error('IPC', `Failed to write command file: ${err.message}`);
    return { success: false, error: err.message };
  }

  if (timeoutMs <= 0) {
    return { success: true };
  }

  // Poll for response
  const startTime = Date.now();
  const pollInterval = 150;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollInterval));

    try {
      if (fs.existsSync(resFile)) {
        const raw = fs.readFileSync(resFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.id === id) {
          // Clean up response
          try { fs.unlinkSync(resFile); } catch {}
          return { success: true, result: parsed.result };
        }
      }
    } catch {}
  }

  // Timeout reached
  logger.warn('IPC', `Timed out waiting for response to command ${command} (ID: ${id})`);
  return { success: false, error: 'IPC_TIMEOUT' };
}

/**
 * Polls for a pending command intended for the daemon.
 * @param {string} [cmdFile=COMMAND_FILE]
 * @returns {object|null}
 */
export function pollDaemonCommand(cmdFile = COMMAND_FILE) {
  if (!fs.existsSync(cmdFile)) return null;

  try {
    const raw = fs.readFileSync(cmdFile, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.status === 'PENDING') {
      return parsed;
    }
  } catch (err) {
    logger.warn('IPC', `Failed to read command file: ${err.message}`);
  }
  return null;
}

/**
 * Acknowledges and completes a daemon command, delivering the result to the caller.
 *
 * @param {string} commandId
 * @param {any} [result={}]
 * @param {string} [resFile=RESPONSE_FILE]
 * @param {string} [cmdFile=COMMAND_FILE]
 */
export function acknowledgeDaemonCommand(commandId, result = {}, resFile = RESPONSE_FILE, cmdFile = COMMAND_FILE) {
  ensureDir(path.dirname(resFile));
  const resData = {
    id: commandId,
    status: 'COMPLETED',
    result,
    completedAt: new Date().toISOString()
  };

  // Write response atomically
  const tempRes = `${resFile}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempRes, JSON.stringify(resData, null, 2), 'utf-8');
    fs.renameSync(tempRes, resFile);
  } catch (err) {
    logger.warn('IPC', `Failed to write response file: ${err.message}`);
  }

  // Clean up command file
  try {
    if (fs.existsSync(cmdFile)) {
      fs.unlinkSync(cmdFile);
    }
  } catch {}

  logger.debug('IPC', `Acknowledged command ${commandId}`);
}

/**
 * Cleans up IPC communication files.
 * @param {string} [cmdFile=COMMAND_FILE]
 * @param {string} [resFile=RESPONSE_FILE]
 */
export function cleanupIpcFiles(cmdFile = COMMAND_FILE, resFile = RESPONSE_FILE) {
  try {
    if (fs.existsSync(cmdFile)) fs.unlinkSync(cmdFile);
  } catch {}
  try {
    if (fs.existsSync(resFile)) fs.unlinkSync(resFile);
  } catch {}
}
