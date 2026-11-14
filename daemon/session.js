/**
 * Cross-Platform Headless Instagram Session & Cookie Manager
 *
 * Enables headless login onboarding on Linux VPS, Docker containers, and Windows
 * without requiring an X11 or visual display server.
 *
 * Supports:
 * - Playwright storageState.json format (standard cross-platform JSON)
 * - Raw HTTP Cookie strings (sessionid=...; ds_user_id=...)
 * - Injection into Playwright contexts and HTTP fast-path requests
 */

import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../lib/logger.js';

export const SESSION_STORAGE_PATH = path.resolve('data/session_state.json');

/**
 * Parses an HTTP Cookie header string into Playwright-compatible cookie objects.
 *
 * @param {string} cookieStr - e.g. "sessionid=xyz; ds_user_id=123; csrftoken=abc"
 * @returns {Array<{ name: string, value: string, domain: string, path: string, secure: boolean, httpOnly: boolean, sameSite: string, expires: number }>}
 */
export function parseCookieString(cookieStr) {
  if (!cookieStr || typeof cookieStr !== 'string') return [];

  const cookies = [];
  const parts = cookieStr.split(';');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;

    const name = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();

    if (!name) continue;

    cookies.push({
      name,
      value,
      domain: '.instagram.com',
      path: '/',
      secure: true,
      httpOnly: name.toLowerCase() === 'sessionid',
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + (180 * 24 * 3600) // 180 days standard
    });
  }

  return cookies;
}

/**
 * Persists session state to disk atomically.
 *
 * @param {object} sessionData
 * @param {string} [storagePath=SESSION_STORAGE_PATH]
 */
function saveSessionFile(sessionData, storagePath = SESSION_STORAGE_PATH) {
  const dir = path.dirname(storagePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${storagePath}.tmp.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(sessionData, null, 2), 'utf-8');
  fs.renameSync(tmpPath, storagePath);
}

/**
 * Imports raw cookie string or array and persists as valid session state.
 *
 * @param {string|Array<object>} input
 * @param {string} [storagePath=SESSION_STORAGE_PATH]
 * @returns {{ ok: boolean, count: number, error?: string }}
 */
export function importRawCookies(input, storagePath = SESSION_STORAGE_PATH) {
  try {
    let cookies = [];
    if (typeof input === 'string') {
      cookies = parseCookieString(input);
    } else if (Array.isArray(input)) {
      cookies = input.map((c) => ({
        domain: '.instagram.com',
        path: '/',
        secure: true,
        sameSite: 'Lax',
        ...c
      }));
    }

    if (cookies.length === 0) {
      return { ok: false, count: 0, error: 'No valid cookies found in input' };
    }

    const payload = {
      cookies,
      origins: [],
      updatedAt: new Date().toISOString()
    };

    saveSessionFile(payload, storagePath);
    logger.info('Session', `Imported ${cookies.length} session cookies into ${path.basename(storagePath)}`);
    return { ok: true, count: cookies.length };
  } catch (err) {
    logger.error('Session', 'Failed to import raw cookies', err.message);
    return { ok: false, count: 0, error: err.message };
  }
}

/**
 * Imports standard Playwright storageState JSON (from object, string, or file path).
 *
 * @param {string|object} stateInput
 * @param {string} [storagePath=SESSION_STORAGE_PATH]
 * @returns {{ ok: boolean, count: number, error?: string }}
 */
export function importStorageState(stateInput, storagePath = SESSION_STORAGE_PATH) {
  try {
    let parsedState = null;

    if (typeof stateInput === 'string') {
      if (fs.existsSync(stateInput)) {
        const fileContent = fs.readFileSync(stateInput, 'utf-8');
        parsedState = JSON.parse(fileContent);
      } else {
        parsedState = JSON.parse(stateInput);
      }
    } else if (typeof stateInput === 'object' && stateInput !== null) {
      parsedState = stateInput;
    }

    if (!parsedState || !Array.isArray(parsedState.cookies)) {
      return { ok: false, count: 0, error: 'Invalid storageState: missing cookies array' };
    }

    const cookies = parsedState.cookies.map((c) => ({
      domain: c.domain || '.instagram.com',
      path: c.path || '/',
      secure: c.secure !== false,
      sameSite: c.sameSite || 'Lax',
      ...c
    }));

    const payload = {
      cookies,
      origins: parsedState.origins || [],
      updatedAt: new Date().toISOString()
    };

    saveSessionFile(payload, storagePath);
    logger.info('Session', `Imported ${cookies.length} cookies from storageState into ${path.basename(storagePath)}`);
    return { ok: true, count: cookies.length };
  } catch (err) {
    logger.error('Session', 'Failed to import storageState', err.message);
    return { ok: false, count: 0, error: err.message };
  }
}

/**
 * Reads and exports current session state in Playwright storageState format.
 *
 * @param {string} [storagePath=SESSION_STORAGE_PATH]
 * @returns {{ cookies: Array<object>, origins: Array<object> }}
 */
export function exportSessionState(storagePath = SESSION_STORAGE_PATH) {
  try {
    if (fs.existsSync(storagePath)) {
      const content = fs.readFileSync(storagePath, 'utf-8');
      const data = JSON.parse(content);
      return {
        cookies: Array.isArray(data.cookies) ? data.cookies : [],
        origins: Array.isArray(data.origins) ? data.origins : []
      };
    }
  } catch (err) {
    logger.warn('Session', 'Could not read session state file', err.message);
  }
  return { cookies: [], origins: [] };
}

/**
 * Returns formatted Cookie header string for HTTP fast-path checks.
 *
 * @param {string} [storagePath=SESSION_STORAGE_PATH]
 * @returns {string}
 */
export function getSessionCookiesHeader(storagePath = SESSION_STORAGE_PATH) {
  const state = exportSessionState(storagePath);
  if (!state.cookies || state.cookies.length === 0) return '';
  return state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

/**
 * Returns active session health and metadata.
 *
 * @param {string} [storagePath=SESSION_STORAGE_PATH]
 * @returns {{ hasSession: boolean, userId?: string, cookiesCount: number, updatedAt?: string }}
 */
export function getSessionStatus(storagePath = SESSION_STORAGE_PATH) {
  const state = exportSessionState(storagePath);
  const cookies = state.cookies || [];
  const sessionIdCookie = cookies.find((c) => c.name.toLowerCase() === 'sessionid');
  const dsUserCookie = cookies.find((c) => c.name.toLowerCase() === 'ds_user_id');

  let updatedAt = undefined;
  try {
    if (fs.existsSync(storagePath)) {
      const parsed = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
      updatedAt = parsed.updatedAt;
    }
  } catch {}

  return {
    hasSession: Boolean(sessionIdCookie && sessionIdCookie.value),
    userId: dsUserCookie ? dsUserCookie.value : undefined,
    cookiesCount: cookies.length,
    updatedAt
  };
}

/**
 * Injects session cookies into an active Playwright browser context.
 *
 * @param {object} context - Playwright BrowserContext
 * @param {string} [storagePath=SESSION_STORAGE_PATH]
 * @returns {Promise<boolean>}
 */
export async function injectSessionIntoContext(context, storagePath = SESSION_STORAGE_PATH) {
  if (!context || typeof context.addCookies !== 'function') return false;

  const state = exportSessionState(storagePath);
  if (state.cookies && state.cookies.length > 0) {
    try {
      await context.addCookies(state.cookies);
      logger.debug('Session', `Injected ${state.cookies.length} cookies into browser context`);
      return true;
    } catch (err) {
      logger.warn('Session', 'Failed to inject cookies into browser context', err.message);
    }
  }
  return false;
}
